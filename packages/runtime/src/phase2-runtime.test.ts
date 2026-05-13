import { createPrivateKey, sign } from 'crypto';
import { describe, expect, it } from 'vitest';
import { KaplanMeier } from '../../analytics/src';
import { generateEd25519KeyPair } from '../../trust/src';
import { TrustState } from '../../trust/src/state-machine';
import {
  ActuationSafetyGate,
  CommandValidator,
  Reversibility,
  SafetyEnvelope,
  StagedRollout,
  commandSigningPayload,
} from './index';

describe('SafetyEnvelope and actuation CBF gate', () => {
  it('passes safe commands and projects unsafe commands to satisfy the CBF constraint', () => {
    const envelope = new SafetyEnvelope({ alpha: 0.5, deltaT: 1, h: (x) => 100 - x });
    const safe = envelope.check(80, 85);
    expect(safe.safe).toBe(true);
    expect(safe.projected).toBe(85);
    const unsafe = envelope.check(80, 99);
    expect(unsafe.safe).toBe(false);
    expect(unsafe.projected).toBeCloseTo(90);
    expect(unsafe.nextBarrier).toBeGreaterThanOrEqual(unsafe.requiredBarrier - 1e-6);

    const gate = new ActuationSafetyGate(undefined, envelope);
    const decision = gate.approved({
      id: 'critical-cbf',
      deviceId: 'd1',
      command: 'raise_pressure',
      criticality: 'CRITICAL',
      trust: 1,
      preconditionsMet: true,
      conflicts: [],
      approvals: ['a', 'b', 'c'],
      issuedAt: 0,
      reversibility: Reversibility.FULLY_REVERSIBLE,
      continuousCurrent: 80,
      continuousDesired: 99,
    });
    expect(decision.approved).toBe(false);
    expect(decision.gates.cbf).toBe(false);
    expect(decision.projectedCommand).toBeCloseTo(90);
  });
});

describe('CommandValidator replay prevention', () => {
  it('rejects replay, out-of-order seq, expired timestamp, duplicate nonce, and accepts valid commands', () => {
    const keys = generateEd25519KeyPair();
    const validator = new CommandValidator({ skewToleranceMs: 30_000 });
    const now = new Date('2026-01-01T00:00:00.000Z');
    const base = {
      deviceId: 'device-1',
      seq: 1,
      timestamp: now.toISOString(),
      nonce: 'n1',
      payload: { command: 'open' },
    };
    const signed = {
      ...base,
      signature: sign(
        null,
        Buffer.from(commandSigningPayload(base)),
        createPrivateKey(keys.privateKeyPem),
      ).toString('base64'),
    };
    expect(validator.validate(signed, keys.publicKeyPem, now).accepted).toBe(true);
    expect(validator.validate(signed, keys.publicKeyPem, now).reason).toBe('OUT_OF_ORDER_SEQ');

    const duplicateNoncePayload = { ...base, seq: 2 };
    const duplicateNonce = {
      ...duplicateNoncePayload,
      signature: sign(
        null,
        Buffer.from(commandSigningPayload(duplicateNoncePayload)),
        createPrivateKey(keys.privateKeyPem),
      ).toString('base64'),
    };
    expect(validator.validate(duplicateNonce, keys.publicKeyPem, now).reason).toBe(
      'DUPLICATE_NONCE',
    );

    const expiredPayload = { ...base, seq: 3, nonce: 'n3', timestamp: '2025-12-31T23:59:00.000Z' };
    const expired = {
      ...expiredPayload,
      signature: sign(
        null,
        Buffer.from(commandSigningPayload(expiredPayload)),
        createPrivateKey(keys.privateKeyPem),
      ).toString('base64'),
    };
    expect(validator.validate(expired, keys.publicKeyPem, now).reason).toBe('EXPIRED_TIMESTAMP');
  });
});

describe('StagedRollout', () => {
  it('enforces canary size and halts with rollback on stage-2 failure rate', () => {
    const rollout = new StagedRollout({
      stages: [
        { fraction: 0.3, window_ms: 1000, health_threshold: 0.1 },
        { fraction: 0.5, window_ms: 1000, health_threshold: 0.1 },
      ],
      failureThreshold: 0.1,
    });
    expect(() => rollout.assertCanaryInvariant(200, 1)).toThrow(/Canary too small/);
    const fleet = Array.from({ length: 100 }, (_, index) => ({
      id: `d${index}`,
      state: TrustState.VALIDATED,
      trust: 0.9,
      version: '1.0.0',
    }));
    expect(
      rollout.runStage({
        fleet,
        stageIndex: 0,
        targetVersion: '2.0.0',
        failures: [],
        postTrust: {},
      }).halted,
    ).toBe(false);
    const failures = Array.from({ length: 15 }, (_, index) => `d${index}`);
    const stage2 = rollout.runStage({
      fleet,
      stageIndex: 1,
      targetVersion: '2.0.0',
      failures,
      postTrust: {},
    });
    expect(stage2.halted).toBe(true);
    expect(stage2.reason).toBe('FAILURE_RATE');
    expect(stage2.rolledBack.length).toBeGreaterThan(0);
  });

  it('halts when new firmware survival median is worse', () => {
    const rollout = new StagedRollout({
      stages: [{ fraction: 1, window_ms: 1, health_threshold: 0.1 }],
    });
    const fleet = Array.from({ length: 30 }, (_, index) => ({
      id: `s${index}`,
      state: TrustState.VALIDATED,
      trust: 0.9,
      version: '1.0.0',
    }));
    const oldSurvival = new KaplanMeier([
      { time: 5, event: true },
      { time: 8, event: false },
    ]);
    const newSurvival = new KaplanMeier([
      { time: 1, event: true },
      { time: 2, event: true },
    ]);
    expect(
      rollout.runStage({
        fleet,
        stageIndex: 0,
        targetVersion: '2.0.0',
        failures: [],
        postTrust: {},
        oldSurvival,
        newSurvival,
      }).reason,
    ).toBe('SURVIVAL_GATE');
  });
});
