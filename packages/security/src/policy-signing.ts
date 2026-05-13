import { createPrivateKey, createPublicKey, sign, verify } from 'crypto';
import { Rule } from '../../policy/src';

/** Stable policy payload covered by signatures. */
export function policySigningPayload(rule: Omit<Rule, 'signature'>): string {
  return JSON.stringify(rule);
}

/** Signs a policy rule with an Ed25519 operator key. */
export function signPolicyRule(rule: Omit<Rule, 'signature'>, privateKeyPem: string): Rule {
  return {
    ...rule,
    signature: sign(
      null,
      Buffer.from(policySigningPayload(rule)),
      createPrivateKey(privateKeyPem),
    ).toString('base64'),
  };
}

/** Verifies a signed policy rule. */
export function verifyPolicyRule(rule: Rule, publicKeyPem: string): boolean {
  if (rule.signature === undefined) {
    return false;
  }
  const { signature, ...unsigned } = rule;
  return verify(
    null,
    Buffer.from(policySigningPayload(unsigned)),
    createPublicKey(publicKeyPem),
    Buffer.from(signature, 'base64'),
  );
}
