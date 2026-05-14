import { randomBytes } from 'node:crypto';
import { createDeviceIdentity, DeviceIdentity } from '../../trust/src';
import { createGatewayCredential } from './profiles';
import { sha256Hex } from './security';
import {
  DeviceProfile,
  GatewayDeviceCredential,
  RegistrationAuthority,
  EdgeTransport,
} from './types';

/** First-time registration request for a device or upstream service workflow. */
export interface DeviceRegistrationRequest {
  readonly deviceId: string;
  readonly profile: DeviceProfile;
  readonly password?: string;
  readonly externalProof?: Record<string, unknown>;
  readonly capabilities?: readonly string[];
  readonly scope?: readonly string[];
  readonly requestedTransports?: readonly EdgeTransport[];
}

/** Result returned to the provisioning channel after registration. */
export interface DeviceRegistrationResult {
  readonly deviceId: string;
  readonly authority: RegistrationAuthority;
  readonly identity: DeviceIdentity;
  readonly privateKeyPem: string;
  readonly credential: GatewayDeviceCredential;
  readonly issuedSecrets: {
    readonly hmacSecret?: string;
    readonly aesKey?: string;
  };
}

/** External authenticator for enterprise-owned onboarding flows. */
export interface RegistrationAuthenticator {
  authenticate(request: DeviceRegistrationRequest): Promise<{
    readonly approved: boolean;
    readonly reason?: string;
    readonly capabilities?: readonly string[];
    readonly scope?: readonly string[];
  }>;
}

/** Registration policy for local, external, or federated first-time onboarding. */
export interface DeviceRegistrationPolicy {
  readonly authority: RegistrationAuthority;
  readonly requireDeviceId: boolean;
  readonly passwordSha256?: string;
  readonly externalAuthenticator?: RegistrationAuthenticator;
}

/** Device registration service that issues identity material and gateway credentials. */
export class DeviceRegistrationService {
  private readonly registered = new Map<string, DeviceRegistrationResult>();

  public constructor(
    private readonly policy: DeviceRegistrationPolicy,
    private readonly onCredential?: (credential: GatewayDeviceCredential) => void,
  ) {}

  /** Registers a device using local password, external proof, or federated approval. */
  public async register(request: DeviceRegistrationRequest): Promise<DeviceRegistrationResult> {
    if (this.policy.requireDeviceId && request.deviceId.trim().length === 0) {
      throw new Error('Registration requires a device id');
    }
    if (this.registered.has(request.deviceId)) {
      throw new Error(`Device already registered: ${request.deviceId}`);
    }
    const external = await this.authorize(request);
    const capabilities = external.capabilities ?? request.capabilities ?? [];
    const scope = external.scope ?? request.scope ?? ['telemetry:write'];
    const issued = createDeviceIdentity(request.deviceId, capabilities, scope);
    const hmacSecret = randomBytes(32).toString('base64');
    const aesKey = randomBytes(32).toString('base64');
    const credential = createGatewayCredential(request.deviceId, request.profile, {
      hmacSecret,
      aesKey,
      publicKeyPem: issued.identity.pk,
    });
    const narrowedCredential =
      request.requestedTransports === undefined
        ? credential
        : {
            ...credential,
            allowedTransports: credential.allowedTransports.filter((transport) =>
              request.requestedTransports!.includes(transport),
            ),
          };
    const result: DeviceRegistrationResult = {
      deviceId: request.deviceId,
      authority: this.policy.authority,
      identity: issued.identity,
      privateKeyPem: issued.privateKeyPem,
      credential: narrowedCredential,
      issuedSecrets: { hmacSecret, aesKey },
    };
    this.registered.set(request.deviceId, result);
    this.onCredential?.(narrowedCredential);
    return result;
  }

  /** Returns a prior registration without exposing one-time secret material. */
  public lookup(
    deviceId: string,
  ): Omit<DeviceRegistrationResult, 'issuedSecrets' | 'privateKeyPem'> | undefined {
    const result = this.registered.get(deviceId);
    if (result === undefined) {
      return undefined;
    }
    const { issuedSecrets: _issuedSecrets, privateKeyPem: _privateKeyPem, ...safe } = result;
    return safe;
  }

  private async authorize(request: DeviceRegistrationRequest): Promise<{
    readonly capabilities?: readonly string[];
    readonly scope?: readonly string[];
  }> {
    if (this.policy.passwordSha256 !== undefined) {
      if (
        request.password === undefined ||
        sha256Hex(request.password) !== this.policy.passwordSha256
      ) {
        throw new Error('Registration password rejected');
      }
    }
    if (this.policy.externalAuthenticator !== undefined) {
      const external = await this.policy.externalAuthenticator.authenticate(request);
      if (!external.approved) {
        throw new Error(external.reason ?? 'External registration rejected');
      }
      return {
        ...(external.capabilities === undefined ? {} : { capabilities: external.capabilities }),
        ...(external.scope === undefined ? {} : { scope: external.scope }),
      };
    }
    return {};
  }
}
