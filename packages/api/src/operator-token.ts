import { createPrivateKey, createPublicKey, sign, verify } from 'crypto';

/** Signed operator token payload. */
export interface OperatorTokenPayload {
  readonly operatorId: string;
  readonly issuedAt: string;
}

/** Creates a compact Ed25519-signed operator token. */
export function createOperatorToken(payload: OperatorTokenPayload, privateKeyPem: string): string {
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = sign(
    null,
    Buffer.from(encodedPayload),
    createPrivateKey(privateKeyPem),
  ).toString('base64url');
  return `${encodedPayload}.${signature}`;
}

/** Verifies a signed operator token. */
export function verifyOperatorToken(
  token: string,
  publicKeyPem: string,
): OperatorTokenPayload | null {
  const [encodedPayload, signature] = token.split('.');
  if (encodedPayload === undefined || signature === undefined) {
    return null;
  }
  const ok = verify(
    null,
    Buffer.from(encodedPayload),
    createPublicKey(publicKeyPem),
    Buffer.from(signature, 'base64url'),
  );
  return ok
    ? (JSON.parse(
        Buffer.from(encodedPayload, 'base64url').toString('utf8'),
      ) as OperatorTokenPayload)
    : null;
}
