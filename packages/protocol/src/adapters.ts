import { randomUUID } from 'node:crypto';
import { ProtocolAdapter, decodeJson, isRecordPayload } from './adapter';
import { AdapterSpec, FieldMap, Reliability } from './types';

const DEFAULT_FIELD_MAP: FieldMap = {
  deviceId: 'deviceId',
  timestamp: 'timestamp',
  payload: 'payload',
  sequenceId: 'sequenceId',
};

/** MQTT adapter supporting QoS 0, 1, and 2 reliability mappings. */
export class MqttAdapter extends ProtocolAdapter<Record<string, unknown>> {
  public constructor(qos: 0 | 1 | 2, fieldMap: FieldMap = DEFAULT_FIELD_MAP) {
    super({
      transport: 'mqtt',
      reliability: mqttReliability(qos),
      max_latency_ms: 250,
      field_map: fieldMap,
      security_level: 'SIGNED',
      buffer_capacity: 1024,
      decode_fn: decodeJson,
      validate_fn: isRecordPayload,
    });
  }
}

/** HTTP webhook adapter for JSON webhook events. */
export class HttpWebhookAdapter extends ProtocolAdapter<Record<string, unknown>> {
  public constructor(fieldMap: FieldMap = DEFAULT_FIELD_MAP) {
    super({
      transport: 'http_webhook',
      reliability: Reliability.AT_LEAST_ONCE,
      max_latency_ms: 500,
      field_map: fieldMap,
      security_level: 'SIGNED',
      buffer_capacity: 2048,
      decode_fn: decodeJson,
      validate_fn: isRecordPayload,
    });
  }
}

/** Raw serial line-delimited JSON adapter. */
export class RawSerialAdapter extends ProtocolAdapter<Record<string, unknown>> {
  public constructor(fieldMap: FieldMap = DEFAULT_FIELD_MAP) {
    const spec: AdapterSpec<Record<string, unknown>> = {
      transport: 'raw_serial',
      reliability: Reliability.AT_MOST_ONCE,
      max_latency_ms: 100,
      field_map: fieldMap,
      security_level: 'NONE',
      buffer_capacity: 256,
      decode_fn: (raw) => {
        const line = Buffer.isBuffer(raw) ? raw.toString('utf8') : String(raw);
        return decodeJson(line.trim());
      },
      validate_fn: isRecordPayload,
    };
    super(spec);
  }
}

/** WebSocket device adapter for browser/device telemetry streams. */
export class WebSocketDeviceAdapter extends ProtocolAdapter<Record<string, unknown>> {
  public constructor(fieldMap: FieldMap = DEFAULT_FIELD_MAP) {
    super({
      transport: 'websocket',
      reliability: Reliability.AT_LEAST_ONCE,
      max_latency_ms: 150,
      field_map: fieldMap,
      security_level: 'SIGNED',
      buffer_capacity: 1024,
      decode_fn: decodeBridgeStylePayload('ws'),
      validate_fn: isRecordPayload,
    });
  }
}

/** Simulated BLE adapter for gateway-discovered low-power device telemetry. */
export class BleAdapter extends ProtocolAdapter<Record<string, unknown>> {
  public constructor(fieldMap: FieldMap = DEFAULT_FIELD_MAP) {
    super({
      transport: 'ble',
      reliability: Reliability.AT_MOST_ONCE,
      max_latency_ms: 1000,
      field_map: fieldMap,
      security_level: 'NONE',
      buffer_capacity: 256,
      decode_fn: decodeBridgeStylePayload('ble'),
      validate_fn: isRecordPayload,
    });
  }
}

/** UDP datagram adapter for local broadcast or unicast JSON telemetry. */
export class UdpDatagramAdapter extends ProtocolAdapter<Record<string, unknown>> {
  public constructor(fieldMap: FieldMap = DEFAULT_FIELD_MAP) {
    super({
      transport: 'udp_datagram',
      reliability: Reliability.AT_MOST_ONCE,
      max_latency_ms: 100,
      field_map: fieldMap,
      security_level: 'NONE',
      buffer_capacity: 512,
      decode_fn: decodeJson,
      validate_fn: isRecordPayload,
    });
  }
}

/** LoRa gateway packet adapter for constrained long-range node telemetry. */
export class LoraPacketAdapter extends ProtocolAdapter<Record<string, unknown>> {
  public constructor(fieldMap: FieldMap = DEFAULT_FIELD_MAP) {
    super({
      transport: 'lora',
      reliability: Reliability.AT_MOST_ONCE,
      max_latency_ms: 5000,
      field_map: fieldMap,
      security_level: 'ENCRYPTED',
      buffer_capacity: 256,
      decode_fn: decodeBridgeStylePayload('lora'),
      validate_fn: isRecordPayload,
    });
  }
}

/** ESP-NOW frame adapter for low-latency peer telemetry bridged into AEGIS. */
export class EspNowFrameAdapter extends ProtocolAdapter<Record<string, unknown>> {
  public constructor(fieldMap: FieldMap = DEFAULT_FIELD_MAP) {
    super({
      transport: 'esp_now',
      reliability: Reliability.AT_MOST_ONCE,
      max_latency_ms: 50,
      field_map: fieldMap,
      security_level: 'SIGNED',
      buffer_capacity: 512,
      decode_fn: decodeBridgeStylePayload('espnow'),
      validate_fn: isRecordPayload,
    });
  }
}

/** Control-plane observation adapter for ARP, IGMP, DHCP, SLAAC, OSPF, and similar signals. */
export class NetworkControlPlaneAdapter extends ProtocolAdapter<Record<string, unknown>> {
  public constructor(observerId = 'network-observer') {
    super({
      transport: 'network_control',
      reliability: Reliability.AT_MOST_ONCE,
      max_latency_ms: 100,
      field_map: {
        deviceId: 'deviceId',
        timestamp: 'timestamp',
        payload: 'payload',
        sequenceId: 'sequenceId',
      },
      security_level: 'NONE',
      buffer_capacity: 4096,
      decode_fn: (raw) => decodeControlPlaneObservation(raw, observerId),
      validate_fn: isRecordPayload,
    });
  }
}

function mqttReliability(qos: 0 | 1 | 2): Reliability {
  if (qos === 0) {
    return Reliability.AT_MOST_ONCE;
  }
  if (qos === 1) {
    return Reliability.AT_LEAST_ONCE;
  }
  return Reliability.EXACTLY_ONCE;
}

function decodeBridgeStylePayload(prefix: 'ble' | 'ws' | 'lora' | 'espnow') {
  return (raw: unknown): Record<string, unknown> => {
    const message = decodeJson(raw);
    const deviceId =
      stringValue(message.deviceId ?? message.device_id) ?? `${prefix}-${randomId()}`;
    const timestamp = message.timestamp ?? new Date().toISOString();
    const sequenceId = message.sequenceId ?? message.sequence_id ?? message.id ?? randomUUID();
    return {
      deviceId,
      timestamp,
      sequenceId,
      payload: {
        capability: message.capability ?? (prefix === 'ble' ? 'ble_signal' : 'telemetry'),
        value: message.value,
        metadata: message.metadata ?? {},
      },
    };
  };
}

function decodeControlPlaneObservation(raw: unknown, observerId: string): Record<string, unknown> {
  const message = decodeJson(raw);
  const protocol = String(message.protocol ?? message.controlProtocol ?? 'unknown').toUpperCase();
  const timestamp = message.timestamp ?? new Date().toISOString();
  const sequenceId = message.sequenceId ?? message.sequence_id ?? message.id ?? randomUUID();
  const subject =
    stringValue(message.deviceId ?? message.device_id ?? message.subjectDeviceId) ?? observerId;
  return {
    deviceId: subject,
    timestamp,
    sequenceId,
    payload: {
      capability: 'network_control_observation',
      controlProtocol: protocol,
      value: message.value ?? message.event ?? protocol,
      metadata: {
        observerId,
        sourceAddress: message.sourceAddress ?? message.src,
        destinationAddress: message.destinationAddress ?? message.dst,
        groupAddress: message.groupAddress,
        interfaceId: message.interfaceId,
        vlanId: message.vlanId,
        routeMetric: message.routeMetric,
        ...(message.metadata !== null &&
        typeof message.metadata === 'object' &&
        !Array.isArray(message.metadata)
          ? (message.metadata as Record<string, unknown>)
          : {}),
      },
    },
  };
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function randomId(): string {
  return randomUUID().slice(0, 8);
}
