import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, sign } from 'crypto';
import { AegisConfig, createAegisConfig } from '../../core/src';

/** Serialized Ed25519 key pair used for device identity. */
export interface Ed25519KeyPair {
  readonly publicKeyPem: string;
  readonly privateKeyPem: string;
}

/** Development self-signed X.509v3 certificate metadata and PEM body. */
export interface DeviceCertificate {
  readonly pem: string;
  readonly serialNumber: string;
  readonly subject: string;
  readonly issuer: string;
  readonly notBefore: string;
  readonly notAfter: string;
  readonly fingerprint: string;
  readonly version: 3;
}

/** Device identity enrolled into an AEGIS trust domain. */
export interface DeviceIdentity {
  readonly pk: string;
  readonly cert: DeviceCertificate;
  readonly capabilities: readonly string[];
  readonly scope: readonly string[];
  readonly enrolledAt: string;
}

/** Certificate issuance parameters for development fleets. */
export interface CertificateRequest {
  readonly deviceId: string;
  readonly keyPair: Ed25519KeyPair;
  readonly issuer?: string;
  readonly now?: Date;
  readonly validityMs?: number;
}

/** Rotation decision input for certificate lifecycle checks. */
export interface RotationInput {
  readonly identity: DeviceIdentity;
  readonly trust: number;
  readonly forced?: boolean;
  readonly now?: Date;
  readonly config?: AegisConfig;
}

/** Generates a serialisable Ed25519 key pair using Node's built-in crypto provider. */
export function generateEd25519KeyPair(): Ed25519KeyPair {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  return {
    publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
    privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
  };
}

/** Issues a minimal self-signed X.509v3 Ed25519 certificate for development and tests. */
export function issueSelfSignedCertificate(request: CertificateRequest): DeviceCertificate {
  const now = request.now ?? new Date();
  const notAfterDate = new Date(
    now.getTime() + (request.validityMs ?? createAegisConfig().identity.certificateValidityMs),
  );
  const issuer = request.issuer ?? 'AEGIS Dev Fleet CA';
  const privateKey = createPrivateKey(request.keyPair.privateKeyPem);
  const publicKey = createPublicKey(request.keyPair.publicKeyPem);
  const serial = createHash('sha256')
    .update(`${request.deviceId}:${now.toISOString()}:${request.keyPair.publicKeyPem}`)
    .digest()
    .subarray(0, 16);
  serial[0] = serial[0]! & 0x7f;
  const tbs = derSequence([
    derExplicit(0, derInteger(Buffer.from([2]))),
    derInteger(serial),
    derAlgorithmEd25519(),
    derName(issuer),
    derSequence([derTime(now), derTime(notAfterDate)]),
    derName(request.deviceId),
    publicKey.export({ type: 'spki', format: 'der' }) as Buffer,
    derExplicit(3, derExtensions()),
  ]);
  const signature = sign(null, tbs, privateKey);
  const der = derSequence([tbs, derAlgorithmEd25519(), derBitString(signature)]);
  const pem = toPem('CERTIFICATE', der);
  return {
    pem,
    serialNumber: serial.toString('hex'),
    subject: request.deviceId,
    issuer,
    notBefore: now.toISOString(),
    notAfter: notAfterDate.toISOString(),
    fingerprint: createHash('sha256').update(der).digest('hex'),
    version: 3,
  };
}

/** Creates a complete device identity with generated keys and development certificate. */
export function createDeviceIdentity(
  deviceId: string,
  capabilities: readonly string[] = [],
  scope: readonly string[] = [],
  config: AegisConfig = createAegisConfig(),
  now = new Date(),
): { readonly identity: DeviceIdentity; readonly privateKeyPem: string } {
  const keyPair = generateEd25519KeyPair();
  const cert = issueSelfSignedCertificate({
    deviceId,
    keyPair,
    now,
    validityMs: config.identity.certificateValidityMs,
  });
  return {
    identity: {
      pk: keyPair.publicKeyPem,
      cert,
      capabilities,
      scope,
      enrolledAt: now.toISOString(),
    },
    privateKeyPem: keyPair.privateKeyPem,
  };
}

/** Returns true when the certificate metadata is valid at the supplied instant. */
export function isCertificateValid(cert: DeviceCertificate, at = new Date()): boolean {
  const now = at.getTime();
  return (
    Date.parse(cert.notBefore) <= now && now < Date.parse(cert.notAfter) && cert.pem.length > 0
  );
}

/** Returns true when age, trust, or operator force requires certificate rotation. */
export function shouldRotateCertificate(input: RotationInput): boolean {
  const config = input.config ?? createAegisConfig();
  const now = input.now ?? new Date();
  const ageMs = now.getTime() - Date.parse(input.identity.enrolledAt);
  return (
    input.forced === true ||
    ageMs > config.identity.maxCertificateAgeMs ||
    input.trust < config.trustThresholds.rotationMinTrust
  );
}

function derLength(length: number): Buffer {
  if (length < 0x80) {
    return Buffer.from([length]);
  }
  const bytes: number[] = [];
  let remaining = length;
  while (remaining > 0) {
    bytes.unshift(remaining & 0xff);
    remaining >>= 8;
  }
  return Buffer.from([0x80 | bytes.length, ...bytes]);
}

function der(tag: number, content: Buffer): Buffer {
  return Buffer.concat([Buffer.from([tag]), derLength(content.length), content]);
}

function derSequence(parts: readonly Buffer[]): Buffer {
  return der(0x30, Buffer.concat(parts));
}

function derSet(parts: readonly Buffer[]): Buffer {
  return der(0x31, Buffer.concat(parts));
}

function derExplicit(tag: number, content: Buffer): Buffer {
  return der(0xa0 + tag, content);
}

function derInteger(value: Buffer): Buffer {
  const normalized =
    value[0] !== undefined && (value[0] & 0x80) !== 0
      ? Buffer.concat([Buffer.from([0]), value])
      : value;
  return der(0x02, normalized);
}

function derBoolean(value: boolean): Buffer {
  return der(0x01, Buffer.from([value ? 0xff : 0x00]));
}

function derBitString(value: Buffer): Buffer {
  return der(0x03, Buffer.concat([Buffer.from([0]), value]));
}

function derOctetString(value: Buffer): Buffer {
  return der(0x04, value);
}

function derUtf8(value: string): Buffer {
  return der(0x0c, Buffer.from(value, 'utf8'));
}

function derOid(oid: string): Buffer {
  const parts = oid.split('.').map((part) => Number.parseInt(part, 10));
  const first = parts[0];
  const second = parts[1];
  if (first === undefined || second === undefined) {
    throw new Error(`Invalid OID: ${oid}`);
  }
  const bytes = [first * 40 + second];
  for (const part of parts.slice(2)) {
    const stack = [part & 0x7f];
    let value = part >> 7;
    while (value > 0) {
      stack.unshift((value & 0x7f) | 0x80);
      value >>= 7;
    }
    bytes.push(...stack);
  }
  return der(0x06, Buffer.from(bytes));
}

function derAlgorithmEd25519(): Buffer {
  return derSequence([derOid('1.3.101.112')]);
}

function derName(commonName: string): Buffer {
  return derSequence([derSet([derSequence([derOid('2.5.4.3'), derUtf8(commonName)])])]);
}

function derTime(date: Date): Buffer {
  const year = date.getUTCFullYear();
  const pad = (value: number, size = 2) => value.toString().padStart(size, '0');
  if (year >= 2050) {
    return der(
      0x18,
      Buffer.from(
        `${pad(year, 4)}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}${pad(
          date.getUTCHours(),
        )}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z`,
        'ascii',
      ),
    );
  }
  return der(
    0x17,
    Buffer.from(
      `${pad(year % 100)}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}${pad(
        date.getUTCHours(),
      )}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z`,
      'ascii',
    ),
  );
}

function derExtensions(): Buffer {
  const basicConstraints = derSequence([
    derOid('2.5.29.19'),
    derBoolean(true),
    derOctetString(derSequence([derBoolean(false)])),
  ]);
  return derSequence([basicConstraints]);
}

function toPem(label: string, derBody: Buffer): string {
  const body = derBody
    .toString('base64')
    .match(/.{1,64}/g)!
    .join('\n');
  return `-----BEGIN ${label}-----\n${body}\n-----END ${label}-----\n`;
}
