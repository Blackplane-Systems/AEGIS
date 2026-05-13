import { createAegisConfig } from '../../core/src';
import { RetePolicyEngine, Rule } from '../../policy/src';
import { createAuditRecord } from '../../runtime/src';
import { generateEd25519KeyPair } from '../../trust/src';
import { describe, expect, it } from 'vitest';
import {
  SignedAuditLog,
  enforceLeastPrivilegeAdapter,
  generateStrideAnalysis,
  signPolicyRule,
  verifyPolicyRule,
  verifySignedAuditChain,
} from './index';

describe('STRIDE and least privilege', () => {
  it('generates entries for every plane/category and blocks actuation-capable adapters', () => {
    const entries = generateStrideAnalysis();
    expect(entries).toHaveLength(30);
    expect(entries.some((entry) => entry.control.startsWith('TODO'))).toBe(true);
    expect(enforceLeastPrivilegeAdapter({ decode: () => undefined })).toBe(true);
    expect(() => enforceLeastPrivilegeAdapter({ actuate: () => undefined })).toThrow(
      /least-privilege/,
    );
  });
});

describe('policy signing and strict mode', () => {
  it('rejects unsigned policy rules in STRICT mode and verifies signed rules', () => {
    const keys = generateEd25519KeyPair();
    const rule: Omit<Rule, 'signature'> = {
      id: 'signed',
      when: { type: 'TRUST', op: '>=', value: 0.8 },
      then: { kind: 'EXECUTE' },
    };
    expect(
      () =>
        new RetePolicyEngine(
          [rule],
          createAegisConfig({ policy: { maxEventAgeMs: 1000, strictSignedRules: true } }),
        ),
    ).toThrow(/unsigned/);
    const signed = signPolicyRule(rule, keys.privateKeyPem);
    expect(verifyPolicyRule(signed, keys.publicKeyPem)).toBe(true);
    expect(
      new RetePolicyEngine(
        [signed],
        createAegisConfig({ policy: { maxEventAgeMs: 1000, strictSignedRules: true } }),
      ).evaluate({
        trust: 1,
      }),
    ).toHaveLength(1);
  });
});

describe('signed audit log', () => {
  it('detects tampered signed audit blocks', () => {
    const keys = generateEd25519KeyPair();
    const log = new SignedAuditLog(keys.privateKeyPem);
    log.append(createAuditRecord({ deviceId: 'd1', type: 'TRUST_UPDATE', data: { trust: 1 } }));
    const blocks = log.blocks();
    expect(verifySignedAuditChain(blocks, keys.publicKeyPem)).toBeNull();
    const tampered = structuredClone(blocks);
    tampered[0]!.block.record.data.trust = 0;
    expect(verifySignedAuditChain(tampered, keys.publicKeyPem)).toBe(0);
  });
});
