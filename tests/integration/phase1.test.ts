import { describe, expect, it } from 'vitest';
import { MqttAdapter } from '../../packages/protocol/src';
import {
  ActuationRequest,
  ActuationSafetyGate,
  Reversibility,
  StructuredAuditLog,
  createAuditRecord,
  reconcile,
  verifyChain,
} from '../../packages/runtime/src';
import {
  BUILT_IN_LTL_TEMPLATES,
  RetePolicyEngine,
  resolveConflicts,
} from '../../packages/policy/src';
import {
  TrustScore,
  TrustScoreEngine,
  TrustState,
  TrustStateMachine,
  createDeviceIdentity,
  getPermittedActions,
} from '../../packages/trust/src';

describe('Phase 1 integration', () => {
  it('enrolls, attests, receives sensor data, evaluates policy, approves actuation, and verifies audit', () => {
    const { identity } = createDeviceIdentity('device-1', ['sense', 'actuate'], ['cell-a']);
    expect(identity.pk).toContain('BEGIN PUBLIC KEY');

    const machine = new TrustStateMachine();
    machine.transition(TrustState.PROVISIONED, { score: 0.5 });

    const trustScore: TrustScore = {
      identity: 1,
      attestation: 1,
      behavioural: 0.9,
      sensorIntegrity: 0.9,
      connectivity: 1,
      policyCompliance: 1,
      runtimeHealth: 0.9,
    };
    const trust = new TrustScoreEngine().compositeScore(trustScore);
    machine.transition(TrustState.VALIDATED, { score: trust, attested: true });

    const event = new MqttAdapter(1).normalise(
      JSON.stringify({
        deviceId: 'device-1',
        timestamp: '2026-01-01T00:00:00.000Z',
        payload: { pressure: 50 },
        sequenceId: 1,
      }),
    );
    const policyEngine = new RetePolicyEngine(BUILT_IN_LTL_TEMPLATES);
    const policyMatches = policyEngine.evaluate({
      trust,
      timestamp: event.timestamp,
      payload: event.payload,
      command: 'open_valve',
    });
    const decision = resolveConflicts(policyMatches.map((match) => match.action));
    expect(decision.kind).not.toBe('BLOCK');

    const actuation: ActuationRequest = {
      id: 'act-1',
      deviceId: 'device-1',
      command: 'open_valve',
      criticality: 'CRITICAL',
      trust,
      preconditionsMet: true,
      conflicts: [],
      approvals: ['op-a', 'op-b', 'op-c'],
      issuedAt: Date.parse(event.timestamp),
      reversibility: Reversibility.FULLY_REVERSIBLE,
      inverse: {
        id: 'act-1-rollback',
        deviceId: 'device-1',
        command: 'close_valve',
        criticality: 'CRITICAL',
        trust,
        preconditionsMet: true,
        conflicts: [],
        approvals: ['op-a', 'op-b', 'op-c'],
        issuedAt: Date.parse(event.timestamp) + 1,
        reversibility: Reversibility.FULLY_REVERSIBLE,
      },
    };
    const gateDecision = new ActuationSafetyGate().approved(actuation);
    expect(gateDecision.approved).toBe(true);

    const audit = new StructuredAuditLog();
    audit.append(
      createAuditRecord({
        deviceId: 'device-1',
        type: 'STATE_TRANSITION',
        data: { to: machine.state },
      }),
    );
    audit.append(
      createAuditRecord({
        deviceId: 'device-1',
        type: 'POLICY_EVALUATION',
        data: { matches: policyMatches.length, decision },
      }),
    );
    audit.append(
      createAuditRecord({
        deviceId: 'device-1',
        type: 'ACTUATION_DECISION',
        data: { approved: gateDecision.approved },
      }),
    );
    expect(verifyChain(audit.blocks())).toBeNull();
  });

  it('blocks actuation when device is quarantined', () => {
    expect(getPermittedActions(TrustState.QUARANTINED)).not.toContain('request_actuation');
  });

  it('blocks CRITICAL actuation without quorum', () => {
    const gate = new ActuationSafetyGate();
    const result = gate.approved({
      id: 'act-no-quorum',
      deviceId: 'device-1',
      command: 'open_valve',
      criticality: 'CRITICAL',
      trust: 0.9,
      preconditionsMet: true,
      conflicts: [],
      approvals: ['op-a'],
      issuedAt: 0,
      reversibility: Reversibility.FULLY_REVERSIBLE,
    });
    expect(result.approved).toBe(false);
    expect(result.gates.quorum).toBe(false);
  });

  it('reconciles after a 60-second partition with CRITICAL cloud overrides and normal LWW', () => {
    const local = {
      pressure: { value: 45, updatedAt: '2026-01-01T00:01:00.000Z' },
      valve: {
        value: 'open',
        updatedAt: '2026-01-01T00:01:00.000Z',
        safetyClass: 'CRITICAL' as const,
      },
    };
    const cloud = {
      pressure: { value: 40, updatedAt: '2026-01-01T00:00:00.000Z' },
      valve: {
        value: 'closed',
        updatedAt: '2026-01-01T00:00:30.000Z',
        safetyClass: 'CRITICAL' as const,
      },
    };
    const result = reconcile(local, cloud);
    expect(result.mergedState.pressure?.value).toBe(45);
    expect(result.mergedState.valve?.value).toBe('closed');
    expect(result.conflicts[0]?.reason).toBe('CRITICAL_CLOUD_OVERRIDE');
  });
});
