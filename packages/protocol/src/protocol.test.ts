import { describe, expect, it } from 'vitest';
import {
  BleAdapter,
  BacnetIpAdapter,
  CanBusFrameAdapter,
  CoapMessageAdapter,
  Dnp3Adapter,
  EthernetIpAdapter,
  EspNowFrameAdapter,
  HttpWebhookAdapter,
  LoraPacketAdapter,
  ModbusTcpAdapter,
  OpcUaPubSubAdapter,
  ProfinetObservationAdapter,
  MqttAdapter,
  NetworkControlPlaneAdapter,
  RawSerialAdapter,
  Reliability,
  UdpDatagramAdapter,
  WebSocketDeviceAdapter,
  applyFieldMap,
  classifyProtocolObservation,
  composeReliability,
  getProtocolProfile,
  listProtocolProfiles,
  recommendedControlsForProtocols,
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

  it('normalises UDP, LoRa, ESP-NOW, and network control-plane observations', () => {
    const udp = new UdpDatagramAdapter().normalise({
      deviceId: 'udp-node-1',
      timestamp: '2026-01-01T00:00:00.000Z',
      sequenceId: 'u1',
      payload: { capability: 'presence', value: true },
    });
    const lora = new LoraPacketAdapter().normalise({
      device_id: 'lora-node-1',
      timestamp: '2026-01-01T00:00:01.000Z',
      sequence_id: 'l1',
      capability: 'soil',
      value: 0.4,
      metadata: { rssi: -110 },
    });
    const espnow = new EspNowFrameAdapter().normalise({
      device_id: 'esp-peer-1',
      timestamp: '2026-01-01T00:00:02.000Z',
      sequence_id: 'e1',
      capability: 'relay',
      value: 'closed',
    });
    const igmp = new NetworkControlPlaneAdapter('pi-gateway').normalise({
      protocol: 'igmp',
      deviceId: 'camera-1',
      timestamp: '2026-01-01T00:00:03.000Z',
      sequenceId: 'i1',
      groupAddress: '239.10.10.10',
      interfaceId: 'wlan0',
    });

    expect(udp.sourceProtocol).toBe('udp_datagram');
    expect(lora.payload).toMatchObject({ capability: 'soil', metadata: { rssi: -110 } });
    expect(espnow.sourceProtocol).toBe('esp_now');
    expect(igmp.payload).toMatchObject({
      capability: 'network_control_observation',
      controlProtocol: 'IGMP',
      metadata: { observerId: 'pi-gateway', groupAddress: '239.10.10.10' },
    });
  });

  it('normalises industrial and building automation gateway payloads', () => {
    const modbus = new ModbusTcpAdapter().normalise({
      unitId: 11,
      timestamp: '2026-01-01T00:00:04.000Z',
      transactionId: 'm1',
      functionCode: 3,
      registers: [120, 121],
    });
    const opcua = new OpcUaPubSubAdapter().normalise({
      publisherId: 'line-a',
      nodeId: 'ns=2;s=Pump.Speed',
      timestamp: '2026-01-01T00:00:05.000Z',
      sequenceId: 'o1',
      value: 1440,
    });
    const bacnet = new BacnetIpAdapter().normalise({
      deviceInstance: 2001,
      objectId: 'analogInput:1',
      timestamp: '2026-01-01T00:00:06.000Z',
      sequenceId: 'b1',
      value: 18.5,
    });
    const can = new CanBusFrameAdapter().normalise(Buffer.from([0x12, 0x34, 0xaa]));
    const coap = new CoapMessageAdapter().normalise({
      deviceId: 'coap-node-1',
      path: '/sensors/temp',
      timestamp: '2026-01-01T00:00:07.000Z',
      sequenceId: 'c1',
      value: 23,
    });
    const dnp3 = new Dnp3Adapter().normalise({
      outstation: 'substation-7',
      pointIndex: 42,
      timestamp: '2026-01-01T00:00:08.000Z',
      sequenceId: 'd1',
      value: true,
    });
    const profinet = new ProfinetObservationAdapter().normalise({
      stationName: 'drive-1',
      timestamp: '2026-01-01T00:00:09.000Z',
      sequenceId: 'p1',
      service: 'dcp-identify',
    });
    const ethernetIp = new EthernetIpAdapter().normalise({
      deviceId: 'cip-1',
      timestamp: '2026-01-01T00:00:10.000Z',
      sequenceId: 'eip1',
      service: 'read-tag',
      value: 9,
    });

    expect(modbus.payload).toMatchObject({
      capability: 'modbus_registers',
      value: [120, 121],
      metadata: { functionCode: 3, unitId: 11 },
    });
    expect(opcua.payload).toMatchObject({
      capability: 'opcua_datavalue',
      metadata: { nodeId: 'ns=2;s=Pump.Speed' },
    });
    expect(bacnet.sourceProtocol).toBe('bacnet_ip');
    expect(can.payload).toMatchObject({ capability: 'can_frame', value: '1234aa' });
    expect(coap.payload).toMatchObject({ capability: 'coap_resource' });
    expect(dnp3.payload).toMatchObject({ capability: 'dnp3_point' });
    expect(profinet.sourceProtocol).toBe('profinet');
    expect(ethernetIp.sourceProtocol).toBe('ethernet_ip');
  });

  it('classifies protocol observations and aggregates controls for readiness checks', () => {
    expect(getProtocolProfile('modbus')).toMatchObject({ id: 'modbus_tcp' });
    expect(listProtocolProfiles().map((profile) => profile.id)).toEqual(
      expect.arrayContaining(['coap', 'modbus_tcp', 'opcua_pubsub', 'bacnet_ip', 'can_bus']),
    );
    expect(
      classifyProtocolObservation({
        port: 502,
        payload: { unitId: 1, functionCode: 3 },
      }),
    ).toMatchObject({ profile: { id: 'modbus_tcp' }, confidence: expect.any(Number) });
    expect(recommendedControlsForProtocols(['modbus_tcp', 'bacnet_ip'])).toEqual(
      expect.arrayContaining(['OT segment isolation', 'write-property policy']),
    );
  });
});
