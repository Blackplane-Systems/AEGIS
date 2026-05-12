import { describe, expect, it, vi } from 'vitest';
import { createAegisConfig } from '../../core/src';
import {
  ActuationRequest,
  ActuationSafetyGate,
  EventLoop,
  EventPriority,
  EvictionPolicy,
  OfflineQueue,
  Reversibility,
  RuntimeEvent,
  StateStore,
  StructuredAuditLog,
  assertLittleLawStability,
  createAuditRecord,
  reconcile,
  reconstructSpanChain,
  verifyChain,
} from './index';

function event(id: string, priority: EventPriority, createdAt = 0): RuntimeEvent {
  return { id, priority, createdAt, kind: id, payload: {} };
}

describe('offline queue', () => {
  it('handles overflow policies', async () => {
    const dropOldest = new OfflineQueue<RuntimeEvent>(1, EvictionPolicy.DROP_OLDEST);
    dropOldest.enqueue(event('old', EventPriority.TELEMETRY));
    expect(dropOldest.enqueue(event('new', EventPriority.TELEMETRY)).evicted?.id).toBe('old');

    const dropLowest = new OfflineQueue<RuntimeEvent>(1, EvictionPolicy.DROP_LOWEST_PRI);
    dropLowest.enqueue(event('low', EventPriority.HOUSEKEEPING));
    expect(dropLowest.enqueue(event('high', EventPriority.SAFETY_ALERT)).evicted?.id).toBe('low');
    expect(dropLowest.dequeue()?.id).toBe('high');

    const rejectNew = new OfflineQueue<RuntimeEvent>(1, EvictionPolicy.REJECT_NEW);
    rejectNew.enqueue(event('kept', EventPriority.TELEMETRY));
    expect(rejectNew.enqueue(event('rejected', EventPriority.SAFETY_ALERT)).accepted).toBe(false);

    const blockProducer = new OfflineQueue<RuntimeEvent>(1, EvictionPolicy.BLOCK_PRODUCER);
    blockProducer.enqueue(event('kept', EventPriority.TELEMETRY));
    const blocked = blockProducer.enqueue(event('blocked', EventPriority.TELEMETRY));
    expect(blocked.backpressure?.blocked).toBe(true);
    const resolved = vi.fn();
    blocked.backpressure?.promise.then(resolved);
    blockProducer.dequeue();
    await blocked.backpressure?.promise;
    expect(resolved).toHaveBeenCalled();
  });

  it('orders by priority and warns on Little Law instability', () => {
    const queue = new OfflineQueue<RuntimeEvent>(3);
    queue.enqueue(event('telemetry', EventPriority.TELEMETRY, 1));
    queue.enqueue(event('safety', EventPriority.SAFETY_ALERT, 2));
    queue.enqueue(event('actuation', EventPriority.ACTUATION_REQUEST, 3));
    expect(queue.dequeue()?.id).toBe('safety');
    expect(queue.dequeue()?.id).toBe('actuation');
    const warn = vi.fn();
    expect(assertLittleLawStability(10, 9, warn)).toBe(false);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('arrival rate 10'));
  });
});

describe('event loop and state store', () => {
  it('processes higher-priority events first and supports state CRUD', async () => {
    const store = new StateStore<{ trust: number }>();
    store.set('device-1', { trust: 0.5 });
    store.setField('device-1', 'trust', 0.8);
    expect(store.getField('device-1', 'trust')).toBe(0.8);
    expect(store.has('device-1')).toBe(true);

    const queue = new OfflineQueue<RuntimeEvent>(10);
    const loop = new EventLoop(queue, [
      {
        name: 'recorder',
        handle(runtimeEvent, context) {
          context.stateStore.setField(runtimeEvent.id, 'seen', true);
        },
      },
    ]);
    loop.submit(event('low', EventPriority.TELEMETRY, 1));
    loop.submit(event('high', EventPriority.SAFETY_ALERT, 2));
    await loop.runUntilIdle();
    expect(loop.processed.map((item) => item.id)).toEqual(['high', 'low']);
    expect(store.delete('device-1')).toBe(true);
  });

  it('drains safety and actuation queues during shutdown', async () => {
    const queue = new OfflineQueue<RuntimeEvent>(10);
    const loop = new EventLoop(queue);
    loop.submit(event('housekeeping', EventPriority.HOUSEKEEPING));
    loop.submit(event('actuation', EventPriority.ACTUATION_REQUEST));
    loop.submit(event('safety', EventPriority.SAFETY_ALERT));
    const drained = await loop.shutdown();
    expect(drained.map((item) => item.id)).toEqual(['safety', 'actuation']);
    expect(loop.processed.map((item) => item.id)).toEqual(['safety', 'actuation']);
  });
});

describe('state reconciliation', () => {
  it('merges with LWW, CRITICAL cloud overrides, tie-breaking, and empty states', () => {
    const result = reconcile(
      {
        temp: { value: 10, updatedAt: '2026-01-01T00:00:10.000Z' },
        valve: { value: 'open', updatedAt: '2026-01-01T00:00:10.000Z', safetyClass: 'CRITICAL' },
        tied: { value: 'local', updatedAt: '2026-01-01T00:00:00.000Z' },
      },
      {
        temp: { value: 9, updatedAt: '2026-01-01T00:00:00.000Z' },
        valve: { value: 'closed', updatedAt: '2026-01-01T00:00:00.000Z', safetyClass: 'CRITICAL' },
        tied: { value: 'cloud', updatedAt: '2026-01-01T00:00:00.000Z' },
        cloudOnly: { value: true, updatedAt: '2026-01-01T00:00:00.000Z' },
      },
    );
    expect(result.mergedState.temp?.value).toBe(10);
    expect(result.mergedState.valve?.value).toBe('closed');
    expect(result.mergedState.tied?.value).toBe('cloud');
    expect(result.mergedState.cloudOnly?.value).toBe(true);
    expect(result.conflicts.map((conflict) => conflict.reason)).toEqual([
      'CRITICAL_CLOUD_OVERRIDE',
      'TIMESTAMP_TIE_CLOUD',
    ]);
    expect(reconcile({}, {}).mergedState).toEqual({});
  });
});

describe('actuation safety gate', () => {
  const baseActuation: ActuationRequest = {
    id: 'act-1',
    deviceId: 'device-1',
    command: 'open_valve',
    criticality: 'CRITICAL',
    trust: 0.9,
    preconditionsMet: true,
    conflicts: [],
    approvals: ['a', 'b', 'c'],
    issuedAt: 1000,
    reversibility: Reversibility.FULLY_REVERSIBLE,
    inverse: {
      id: 'rollback-1',
      deviceId: 'device-1',
      command: 'close_valve',
      criticality: 'CRITICAL',
      trust: 0.9,
      preconditionsMet: true,
      conflicts: [],
      approvals: ['a', 'b', 'c'],
      issuedAt: 2000,
      reversibility: Reversibility.FULLY_REVERSIBLE,
    },
  };

  it('blocks each independent gate and enforces quorum maths', () => {
    const gate = new ActuationSafetyGate(
      createAegisConfig({ actuation: { minTrust: 0.75, cooldownMs: 100, quorumN: 4, quorumF: 1 } }),
    );
    expect(gate.quorumRequired(4, 1)).toBe(3);
    expect(gate.approved(baseActuation).approved).toBe(true);
    expect(gate.approved({ ...baseActuation, id: 'act-2', issuedAt: 1050 }).gates.rate).toBe(false);
    expect(
      gate.approved({ ...baseActuation, id: 'act-3', trust: 0.1, issuedAt: 1200 }).gates.trust,
    ).toBe(false);
    expect(
      gate.approved({ ...baseActuation, id: 'act-4', preconditionsMet: false, issuedAt: 1200 })
        .gates.precondition,
    ).toBe(false);
    expect(
      gate.approved({ ...baseActuation, id: 'act-5', conflicts: ['lock'], issuedAt: 1200 }).gates
        .conflict,
    ).toBe(false);
    expect(
      gate.approved({ ...baseActuation, id: 'act-6', approvals: ['a'], issuedAt: 1200 }).gates
        .quorum,
    ).toBe(false);
  });

  it('issues rollback inverse or escalates irreversible actions', () => {
    const gate = new ActuationSafetyGate();
    gate.approved(baseActuation);
    const rollback = gate.rollback('act-1');
    expect(rollback.rollbackEvent?.priority).toBe(EventPriority.ROLLBACK);
    expect(rollback.rollbackEvent?.actuation.command).toBe('close_valve');
    expect(rollback.rollbackEvent?.auditMark).toBe(true);

    const irreversible: ActuationRequest = {
      id: 'act-irrev',
      deviceId: 'device-1',
      criticality: 'CRITICAL',
      trust: 0.9,
      preconditionsMet: true,
      conflicts: [],
      approvals: ['a', 'b', 'c'],
      command: 'burn_fuse',
      issuedAt: 3000,
      reversibility: Reversibility.IRREVERSIBLE,
    };
    gate.approved(irreversible);
    expect(gate.rollback('act-irrev')).toEqual({ issued: false, escalation: true });
  });
});

describe('structured audit log', () => {
  it('detects tampering, preserves append-only snapshots, and reconstructs spans', () => {
    const log = new StructuredAuditLog();
    const root = createAuditRecord({
      deviceId: 'device-1',
      type: 'POLICY_EVALUATION',
      data: { action: 'ADVISORY' },
      timestamp: '2026-01-01T00:00:00.000Z',
      span: { trace_id: 'trace', span_id: 'root' },
    });
    const child = createAuditRecord({
      deviceId: 'device-1',
      type: 'ACTUATION_DECISION',
      data: { approved: true },
      timestamp: '2026-01-01T00:00:01.000Z',
      span: { trace_id: 'trace', span_id: 'child', parent_id: 'root' },
    });
    log.append(root);
    log.append(child);
    const blocks = log.blocks();
    expect(verifyChain(blocks)).toBeNull();
    const tampered = structuredClone(blocks);
    tampered[1]!.record.data.approved = false;
    expect(verifyChain(tampered)).toBe(1);
    expect(log.forDevice('device-1', 1)).toHaveLength(1);
    expect(reconstructSpanChain(blocks, 'trace').map((span) => span.span_id)).toEqual([
      'root',
      'child',
    ]);
  });
});
