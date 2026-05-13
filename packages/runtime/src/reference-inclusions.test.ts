import { describe, expect, it } from 'vitest';
import { DeviceDiscoveryRegistry, DigitalTwinManager, EventBus } from './index';

describe('reference inclusion runtime modules', () => {
  it('publishes to all event bus subscribers while isolating handler failures', async () => {
    const bus = new EventBus<{ readonly id: number }>(2);
    const received: number[] = [];
    bus.subscribe((event) => {
      received.push(event.id);
    });
    bus.subscribe(() => {
      throw new Error('subscriber failed');
    });

    const result = await bus.publish({ id: 1 });

    expect(received).toEqual([1]);
    expect(result.delivered).toBe(1);
    expect(result.failed).toBe(1);
    expect(result.errors[0]?.message).toBe('subscriber failed');
    expect(bus.subscriberCount()).toBe(2);
  });

  it('keeps a bounded recent event log and supports unsubscribe callbacks', async () => {
    const bus = new EventBus<{ readonly id: number }>(2);
    const received: number[] = [];
    const unsubscribe = bus.subscribe((event) => {
      received.push(event.id);
    });

    await bus.publish({ id: 1 });
    await bus.publish({ id: 2 });
    await bus.publish({ id: 3 });
    unsubscribe();
    await bus.publish({ id: 4 });

    expect(received).toEqual([1, 2, 3]);
    expect(bus.getRecentLogs()).toEqual([{ id: 3 }, { id: 4 }]);
    expect(bus.subscriberCount()).toBe(0);
  });

  it('auto-registers devices and merges protocols, capabilities, and metadata', () => {
    const registry = new DeviceDiscoveryRegistry();
    registry.discover({
      deviceId: 'device-1',
      protocol: 'websocket',
      capability: 'temperature',
      metadata: { room: 'lab' },
      observedAt: '2026-01-01T00:00:00.000Z',
    });
    const updated = registry.discover({
      deviceId: 'device-1',
      protocol: 'ble',
      capability: 'ble_signal',
      metadata: { rssi: -70 },
      observedAt: '2026-01-01T00:00:05.000Z',
    });

    expect(updated).toEqual({
      deviceId: 'device-1',
      protocols: ['ble', 'websocket'],
      capabilities: ['ble_signal', 'temperature'],
      metadata: { room: 'lab', rssi: -70 },
      firstSeen: '2026-01-01T00:00:00.000Z',
      lastSeen: '2026-01-01T00:00:05.000Z',
    });
  });

  it('maintains latest digital twin state and bounded history', () => {
    const twin = new DigitalTwinManager(2);
    twin.update({
      deviceId: 'device-1',
      capability: 'temperature',
      value: 20,
      timestamp: '2026-01-01T00:00:00.000Z',
    });
    twin.update({
      deviceId: 'device-1',
      capability: 'temperature',
      value: 21,
      timestamp: '2026-01-01T00:00:01.000Z',
    });
    twin.update({
      deviceId: 'device-1',
      capability: 'humidity',
      value: 45,
      timestamp: '2026-01-01T00:00:02.000Z',
    });

    expect(twin.getCapability('device-1', 'temperature')?.value).toBe(21);
    expect(twin.getState('device-1')).toMatchObject({
      temperature: { value: 21 },
      humidity: { value: 45 },
    });
    expect(twin.getHistory('device-1').map((entry) => entry.value)).toEqual([21, 45]);
    expect(twin.getHistory('device-1', 'temperature').map((entry) => entry.value)).toEqual([21]);
  });
});
