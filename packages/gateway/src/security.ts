import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  createHash,
  timingSafeEqual,
  verify,
} from 'node:crypto';
import {
  EdgeTransport,
  GatewayConfig,
  GatewayDeviceCredential,
  IngressSecurityMode,
  UniversalIngressEnvelope,
} from './types';

/** Device credential lookup with transport and security-mode enforcement. */
export class GatewayCredentialRegistry {
  private readonly credentials: Map<string, GatewayDeviceCredential>;

  public constructor(credentials: readonly GatewayDeviceCredential[]) {
    this.credentials = new Map(credentials.map((credential) => [credential.deviceId, credential]));
  }

  /** Returns a credential by device id. */
  public get(deviceId: string): GatewayDeviceCredential | undefined {
    return this.credentials.get(deviceId);
  }

  /** Adds or replaces a device credential after registration. */
  public upsert(credential: GatewayDeviceCredential): void {
    this.credentials.set(credential.deviceId, credential);
  }

  /** Lists credentials without exposing key material. */
  public listPublic(): readonly Omit<GatewayDeviceCredential, 'aesKey' | 'hmacSecret'>[] {
    return [...this.credentials.values()].map(
      ({ aesKey: _aesKey, hmacSecret: _hmacSecret, ...safe }) => safe,
    );
  }
}

/** Stable SHA-256 digest for operator tokens and tests. */
export function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

/** Returns true when an admin token matches the configured SHA-256 digest. */
export function verifyAdminToken(
  token: string | undefined,
  expectedSha256: string | undefined,
): boolean {
  if (expectedSha256 === undefined) {
    return false;
  }
  if (token === undefined) {
    return false;
  }
  return constantTimeEqual(sha256Hex(token), expectedSha256);
}

/** Signs an ingress envelope with HMAC-SHA256 for constrained devices. */
export function signHmacEnvelope(
  envelope: Omit<UniversalIngressEnvelope, 'security'> & {
    readonly security: { readonly mode: 'HMAC_SHA256'; readonly nonce: string };
  },
  secret: string,
): string {
  return createHmac('sha256', keyBytes(secret)).update(signingInput(envelope)).digest('base64');
}

/** Encrypts a JSON payload with AES-256-GCM and returns envelope-ready fields. */
export function encryptAesGcmPayload(
  payload: unknown,
  key: string,
  iv = Buffer.alloc(12, 7),
): { readonly payload: string; readonly iv: string; readonly authTag: string } {
  const cipher = createCipheriv('aes-256-gcm', keyBytes(key, 32), iv);
  const encrypted = Buffer.concat([
    cipher.update(Buffer.from(JSON.stringify(payload), 'utf8')),
    cipher.final(),
  ]);
  return {
    payload: encrypted.toString('base64'),
    iv: iv.toString('base64'),
    authTag: cipher.getAuthTag().toString('base64'),
  };
}

/** Validates ingress security and returns the decrypted payload if applicable. */
export function verifyIngressSecurity(
  envelope: UniversalIngressEnvelope,
  config: GatewayConfig,
  registry: GatewayCredentialRegistry,
): { readonly payload: unknown; readonly plaintextAccepted: boolean } {
  const credential = registry.get(envelope.deviceId);
  if (envelope.security.mode === 'OPEN_BROADCAST') {
    return verifyPlaintext(envelope, config);
  }
  if (credential === undefined) {
    throw new Error(`Unknown secured device: ${envelope.deviceId}`);
  }
  enforceCredentialPolicy(credential, envelope.transport, envelope.security.mode);
  if (config.requireNonceForSecureIngress && envelope.security.nonce === undefined) {
    throw new Error('Secure ingress requires a nonce');
  }
  if (envelope.security.mode === 'HMAC_SHA256') {
    verifyHmac(envelope, credential);
    return { payload: envelope.payload, plaintextAccepted: false };
  }
  if (envelope.security.mode === 'ED25519') {
    verifyEd25519(envelope, credential);
    return { payload: envelope.payload, plaintextAccepted: false };
  }
  return { payload: decryptAesPayload(envelope, credential), plaintextAccepted: false };
}

function verifyPlaintext(
  envelope: UniversalIngressEnvelope,
  config: GatewayConfig,
): { readonly payload: unknown; readonly plaintextAccepted: boolean } {
  if (!config.allowPlaintextFrom.includes(envelope.transport)) {
    throw new Error(`Plaintext ingress is disabled for ${envelope.transport}`);
  }
  if (envelope.eventKind === 'COMMAND') {
    throw new Error('Plaintext command ingress is not allowed');
  }
  return { payload: envelope.payload, plaintextAccepted: true };
}

function enforceCredentialPolicy(
  credential: GatewayDeviceCredential,
  transport: EdgeTransport,
  mode: IngressSecurityMode,
): void {
  if (!credential.allowedTransports.includes(transport)) {
    throw new Error(`${credential.deviceId} is not allowed to use ${transport}`);
  }
  if (!credential.allowedSecurityModes.includes(mode)) {
    throw new Error(`${credential.deviceId} is not allowed to use ${mode}`);
  }
}

function verifyHmac(envelope: UniversalIngressEnvelope, credential: GatewayDeviceCredential): void {
  if (credential.hmacSecret === undefined) {
    throw new Error(`No HMAC secret registered for ${credential.deviceId}`);
  }
  const provided = envelope.security.signature;
  if (provided === undefined) {
    throw new Error('HMAC ingress requires a signature');
  }
  const expected = createHmac('sha256', keyBytes(credential.hmacSecret))
    .update(signingInput(envelope))
    .digest('base64');
  if (!constantTimeEqual(expected, provided)) {
    throw new Error('Invalid HMAC signature');
  }
}

function verifyEd25519(
  envelope: UniversalIngressEnvelope,
  credential: GatewayDeviceCredential,
): void {
  if (credential.publicKeyPem === undefined) {
    throw new Error(`No public key registered for ${credential.deviceId}`);
  }
  const signature = envelope.security.signature;
  if (signature === undefined) {
    throw new Error('Ed25519 ingress requires a signature');
  }
  const valid = verify(
    null,
    Buffer.from(signingInput(envelope), 'utf8'),
    credential.publicKeyPem,
    Buffer.from(signature, 'base64'),
  );
  if (!valid) {
    throw new Error('Invalid Ed25519 signature');
  }
}

function decryptAesPayload(
  envelope: UniversalIngressEnvelope,
  credential: GatewayDeviceCredential,
): unknown {
  if (credential.aesKey === undefined) {
    throw new Error(`No AES key registered for ${credential.deviceId}`);
  }
  if (
    typeof envelope.payload !== 'string' ||
    envelope.security.iv === undefined ||
    envelope.security.authTag === undefined
  ) {
    throw new Error('AES-GCM ingress requires base64 payload, iv, and authTag');
  }
  const decipher = createDecipheriv(
    'aes-256-gcm',
    keyBytes(credential.aesKey, 32),
    Buffer.from(envelope.security.iv, 'base64'),
  );
  decipher.setAuthTag(Buffer.from(envelope.security.authTag, 'base64'));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(envelope.payload, 'base64')),
    decipher.final(),
  ]);
  return JSON.parse(decrypted.toString('utf8')) as unknown;
}

function signingInput(envelope: UniversalIngressEnvelope): string {
  return stableStringify({
    broadcast: envelope.broadcast ?? false,
    deviceId: envelope.deviceId,
    eventKind: envelope.eventKind,
    localOnly: envelope.localOnly ?? false,
    metadata: envelope.metadata ?? {},
    payload: envelope.payload,
    sequenceId: envelope.sequenceId,
    timestamp: envelope.timestamp,
    transport: envelope.transport,
    security: {
      keyId: envelope.security.keyId,
      mode: envelope.security.mode,
      nonce: envelope.security.nonce,
      iv: envelope.security.iv,
      authTag: envelope.security.authTag,
    },
  });
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  }
  if (value !== null && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter((entry) => entry[1] !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function constantTimeEqual(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left);
  const rightBytes = Buffer.from(right);
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
}

function keyBytes(value: string, expectedLength?: number): Buffer {
  const base64 = Buffer.from(value, 'base64');
  if (expectedLength === undefined || base64.length === expectedLength) {
    return base64;
  }
  const hex = Buffer.from(value, 'hex');
  if (hex.length === expectedLength) {
    return hex;
  }
  const utf8 = Buffer.from(value, 'utf8');
  if (expectedLength === undefined || utf8.length === expectedLength) {
    return utf8;
  }
  throw new Error(`Key must decode to ${expectedLength} bytes`);
}
