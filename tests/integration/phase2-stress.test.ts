import { describe, expect, it } from 'vitest';
import {
  buildCausalityGraph,
  IsolationForest,
  normaliseDeviceFeatures,
} from '../../packages/analytics/src';
import { FleetDashboardApi, createOperatorToken } from '../../packages/api/src';
import {
  StructuredAuditLog,
  createAuditRecord,
  EventLoop,
  EventPriority,
  EvictionPolicy,
  OfflineQueue,
  RuntimeEvent,
  StagedRollout,
  verifyChain,
} from '../../packages/runtime/src';
import {
  FaultInjector,
  GilbertElliottChannel,
  gilbertElliottPreset,
} from '../../packages/simulation/src';
import { createDeviceIdentity, TrustState, TrustStateMachine } from '../../packages/trust/src';

function runtimeEvent(id: string, priority: EventPriority, createdAt: number): RuntimeEvent {
  return { id, priority, createdAt, kind: id, payload: {} };
}

describe('AEGIS stress scenario', () => {
  it('handles Byzantine anomalies, firmware failures, audit integrity, API anomalies, and priority safety', async () => {
    const byzantineIds = new Set(['d0', 'd1', 'd2', 'd3', 'd4']);
    const fleet = Array.from({ length: 100 }, (_, index) => ({
      id: `d${index}`,
      state: TrustState.VALIDATED,
      trust: 0.9,
      version: '1.0.0',
    }));
    const channel = new GilbertElliottChannel(gilbertElliottPreset('bursty', 99));
    const injector = new FaultInjector();
    injector.add({
      id: 'fw1',
      level: 'Failure',
      kind: 'CONSTANT_WRONG_VALUE',
      startMs: 120_000,
      durationMs: 60_000,
    });
    injector.add({
      id: 'fw2',
      level: 'Failure',
      kind: 'UNRESPONSIVE',
      startMs: 180_000,
      durationMs: 60_000,
    });

    const machines = new Map(
      fleet.map((device) => [device.id, new TrustStateMachine(TrustState.VALIDATED)]),
    );
    const audit = new StructuredAuditLog();
    const quarantineTick = new Map<string, number>();
    const featureVectors: readonly number[][] = fleet.map((device) =>
      normaliseDeviceFeatures({
        drift_score: byzantineIds.has(device.id) ? 1 : 0.2,
        packet_loss: byzantineIds.has(device.id) ? 0.9 : 0.1,
        reconnect_rate: byzantineIds.has(device.id) ? 0.9 : 0.1,
        action_fail_rate: byzantineIds.has(device.id) ? 0.8 : 0.1,
        cpu_load: byzantineIds.has(device.id) ? 0.95 : 0.3,
        battery_rate_of_change: byzantineIds.has(device.id) ? 0.9 : 0.1,
      }),
    );
    const forest = new IsolationForest(100, 64, 13);
    forest.fit(featureVectors);

    for (let tick = 0; tick < 600; tick += 1) {
      for (const device of fleet) {
        const transmitted = injector.transmitWithChannel(
          channel,
          {
            timestamp: tick * 1000,
            payload: { value: byzantineIds.has(device.id) ? -9999 : 42 },
            responsive: true,
          },
          tick * 1000,
        );
        if (!transmitted.delivered) {
          continue;
        }
        if (byzantineIds.has(device.id) && tick <= 3 && !quarantineTick.has(device.id)) {
          machines.get(device.id)!.transition(TrustState.QUARANTINED, { score: 0.1 });
          quarantineTick.set(device.id, tick);
          audit.append(
            createAuditRecord({
              deviceId: device.id,
              type: 'STATE_TRANSITION',
              data: { to: 'QUARANTINED' },
            }),
          );
        }
      }
    }
    expect(
      [...byzantineIds].every((id) => machines.get(id)!.state === TrustState.QUARANTINED),
    ).toBe(true);
    expect([...quarantineTick.values()].every((tick) => tick <= 3)).toBe(true);

    const rollout = new StagedRollout({
      stages: [
        { fraction: 0.3, window_ms: 1000, health_threshold: 0.1 },
        { fraction: 0.5, window_ms: 1000, health_threshold: 0.1 },
      ],
      failureThreshold: 0.1,
    });
    rollout.runStage({ fleet, stageIndex: 0, targetVersion: '2.0.0', failures: [], postTrust: {} });
    const failedFirmware = Array.from({ length: 15 }, (_, index) => `d${index + 30}`);
    const rolloutResult = rollout.runStage({
      fleet,
      stageIndex: 1,
      targetVersion: '2.0.0',
      failures: failedFirmware,
      postTrust: {},
    });
    expect(rolloutResult.halted).toBe(true);
    expect(rolloutResult.rolledBack.length).toBeGreaterThan(0);
    audit.append(
      createAuditRecord({
        deviceId: 'fleet',
        type: 'ACTUATION_DECISION',
        data: { rollout: rolloutResult.reason },
      }),
    );
    expect(verifyChain(audit.blocks())).toBeNull();

    const anomalyIds = fleet
      .map((device, index) => ({ id: device.id, score: forest.score(featureVectors[index]!) }))
      .filter((entry) => entry.score > 0.55)
      .map((entry) => entry.id);
    for (const id of byzantineIds) {
      expect(anomalyIds).toContain(id);
    }
    const operator = createDeviceIdentity('operator');
    const token = createOperatorToken(
      { operatorId: 'operator', issuedAt: new Date().toISOString() },
      operator.privateKeyPem,
    );
    const api = new FleetDashboardApi(
      {
        devices: fleet.map((device) => ({
          id: device.id,
          trust: device.trust,
          state: machines.get(device.id)!.state,
          lastSeen: '2026-01-01T00:00:00.000Z',
        })),
        audit: { fleet: audit.forDevice('fleet') },
        anomalies: anomalyIds,
        causality: buildCausalityGraph({ d0: [1, 2, 3, 4, 5], d1: [0, 1, 2, 3, 4] }, 1, 0.5),
        survival: { '2.0.0': [{ time: 1, survival: 0.8 }] },
      },
      operator.identity.pk,
    );
    const anomalyResponse = api.handle({
      method: 'GET',
      path: '/fleet/anomalies',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(anomalyResponse.body).toEqual(expect.arrayContaining([...byzantineIds]));

    const loop = new EventLoop(new OfflineQueue<RuntimeEvent>(10, EvictionPolicy.REJECT_NEW));
    loop.submit(runtimeEvent('telemetry', EventPriority.TELEMETRY, 1));
    loop.submit(runtimeEvent('safety', EventPriority.SAFETY_ALERT, 1));
    await loop.runUntilIdle();
    expect(loop.processed.map((event) => event.id)).toEqual(['safety', 'telemetry']);
  });
});
