import { describe, expect, it } from 'vitest';
import {
  BleAdapter,
  HttpWebhookAdapter,
  MqttAdapter,
  RawSerialAdapter,
  Reliability,
  WebSocketDeviceAdapter,
  applyFieldMap,
  composeReliability,
} from './index';

describe('protocol adapters', () => {
  it('decodes and normalises MQTT payloads for all QoS reliability levels', () => {
    const adapter = new MqttAdapter(2);
    const event = adapter.normalise(
      JSON.stringify({
        deviceId: 'device-1',
        timestamp: '2026-01-01T00:00:00.000Z',
        payload: { temp: 21 },
        sequenceId: 7,
      }),
    );
    expect(event).toEqual({
      deviceId: 'device-1',
      timestamp: '2026-01-01T00:00:00.000Z',
      payload: { temp: 21 },
      sourceProtocol: 'mqtt',
      sequenceId: 7,
    });
    expect(new MqttAdapter(0).spec.reliability).toBe(Reliability.AT_MOST_ONCE);
    expect(new MqttAdapter(1).spec.reliability).toBe(Reliability.AT_LEAST_ONCE);
    expect(new MqttAdapter(2).spec.reliability).toBe(Reliability.EXACTLY_ONCE);
  });

  it('rejects invalid payloads', () => {
    const adapter = new HttpWebhookAdapter();
    expect(() => adapter.normalise('[]')).toThrow(/Decoded payload/);
    expect(() =>
      adapter.normalise({ deviceId: '', timestamp: 'bad', payload: {}, sequenceId: 1 }),
    ).toThrow(/deviceId/);
  });

  it('composes reliability as the lattice meet', () => {
    expect(
      composeReliability([
        Reliability.EXACTLY_ONCE,
        Reliability.AT_LEAST_ONCE,
        Reliability.EXACTLY_ONCE,
      ]),
    ).toBe(Reliability.AT_LEAST_ONCE);
  });

  it('maps nested native fields into canonical fields', () => {
    const mapped = applyFieldMap(
      {
        meta: { id: 'device-2', ts: 1_767_225_600_000, seq: 'abc' },
        data: { pressure: 42 },
      },
      {
        deviceId: 'meta.id',
        timestamp: 'meta.ts',
        payload: 'data',
        sequenceId: 'meta.seq',
      },
      'test',
    );
    expect(mapped.deviceId).toBe('device-2');
    expect(mapped.timestamp).toBe('2026-01-01T00:00:00.000Z');
    expect(mapped.payload).toEqual({ pressure: 42 });
  });

  it('supports raw serial line-delimited JSON', () => {
    const adapter = new RawSerialAdapter();
    const event = adapter.normalise(
      '{"deviceId":"serial-1","timestamp":"2026-01-01T00:00:00.000Z","payload":{"ok":true},"sequenceId":1}\n',
    );
    expect(event.sourceProtocol).toBe('raw_serial');
  });

  it('normalises gateway-style WebSocket telemetry', () => {
    const adapter = new WebSocketDeviceAdapter();
    const event = adapter.normalise({
      device_id: 'ws-device-1',
      timestamp: '2026-01-01T00:00:00.000Z',
      id: 'msg-1',
      capability: 'temperature',
      value: 22.4,
      metadata: { room: 'lab' },
    });
    expect(event).toEqual({
      deviceId: 'ws-device-1',
      timestamp: '2026-01-01T00:00:00.000Z',
      sourceProtocol: 'websocket',
      sequenceId: 'msg-1',
      payload: {
        capability: 'temperature',
        value: 22.4,
        metadata: { room: 'lab' },
      },
    });
  });

  it('normalises simulated BLE telemetry', () => {
    const adapter = new BleAdapter();
    const event = adapter.normalise({
      device_id: 'ble-device-1',
      timestamp: '2026-01-01T00:00:00.000Z',
      sequence_id: 12,
      value: -72,
      metadata: { rssi: -72 },
    });
    expect(event.sourceProtocol).toBe('ble');
    expect(event.payload).toEqual({
      capability: 'ble_signal',
      value: -72,
      metadata: { rssi: -72 },
    });
  });
});
