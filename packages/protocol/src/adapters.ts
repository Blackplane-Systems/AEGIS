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

/** CoAP adapter for constrained UDP resource observations and commands. */
export class CoapMessageAdapter extends ProtocolAdapter<Record<string, unknown>> {
  public constructor(fieldMap: FieldMap = DEFAULT_FIELD_MAP) {
    super({
      transport: 'coap',
      reliability: Reliability.AT_LEAST_ONCE,
      max_latency_ms: 750,
      field_map: fieldMap,
      security_level: 'ENCRYPTED',
      buffer_capacity: 512,
      decode_fn: decodeIndustrialPayload('coap', 'coap_resource'),
      validate_fn: isRecordPayload,
    });
  }
}

/** Modbus TCP adapter for PLC register observations represented by a gateway. */
export class ModbusTcpAdapter extends ProtocolAdapter<Record<string, unknown>> {
  public constructor(fieldMap: FieldMap = DEFAULT_FIELD_MAP) {
    super({
      transport: 'modbus_tcp',
      reliability: Reliability.AT_LEAST_ONCE,
      max_latency_ms: 200,
      field_map: fieldMap,
      security_level: 'NONE',
      buffer_capacity: 512,
      decode_fn: decodeIndustrialPayload('modbus_tcp', 'modbus_registers'),
      validate_fn: isRecordPayload,
    });
  }
}

/** Modbus RTU adapter for serial bus frames represented by an edge gateway. */
export class ModbusRtuAdapter extends ProtocolAdapter<Record<string, unknown>> {
  public constructor(fieldMap: FieldMap = DEFAULT_FIELD_MAP) {
    super({
      transport: 'modbus_rtu',
      reliability: Reliability.AT_MOST_ONCE,
      max_latency_ms: 500,
      field_map: fieldMap,
      security_level: 'NONE',
      buffer_capacity: 256,
      decode_fn: decodeIndustrialPayload('modbus_rtu', 'modbus_rtu_frame'),
      validate_fn: isRecordPayload,
    });
  }
}

/** OPC UA PubSub adapter for DataValue-style gateway events. */
export class OpcUaPubSubAdapter extends ProtocolAdapter<Record<string, unknown>> {
  public constructor(fieldMap: FieldMap = DEFAULT_FIELD_MAP) {
    super({
      transport: 'opcua_pubsub',
      reliability: Reliability.AT_LEAST_ONCE,
      max_latency_ms: 250,
      field_map: fieldMap,
      security_level: 'MUTUAL_TLS',
      buffer_capacity: 2048,
      decode_fn: decodeIndustrialPayload('opcua_pubsub', 'opcua_datavalue'),
      validate_fn: isRecordPayload,
    });
  }
}

/** BACnet/IP adapter for building automation object observations. */
export class BacnetIpAdapter extends ProtocolAdapter<Record<string, unknown>> {
  public constructor(fieldMap: FieldMap = DEFAULT_FIELD_MAP) {
    super({
      transport: 'bacnet_ip',
      reliability: Reliability.AT_MOST_ONCE,
      max_latency_ms: 500,
      field_map: fieldMap,
      security_level: 'NONE',
      buffer_capacity: 1024,
      decode_fn: decodeIndustrialPayload('bacnet_ip', 'bacnet_object'),
      validate_fn: isRecordPayload,
    });
  }
}

/** CAN bus adapter for frames bridged by a local interface or microcontroller. */
export class CanBusFrameAdapter extends ProtocolAdapter<Record<string, unknown>> {
  public constructor(fieldMap: FieldMap = DEFAULT_FIELD_MAP) {
    super({
      transport: 'can_bus',
      reliability: Reliability.AT_MOST_ONCE,
      max_latency_ms: 25,
      field_map: fieldMap,
      security_level: 'NONE',
      buffer_capacity: 2048,
      decode_fn: decodeIndustrialPayload('can_bus', 'can_frame'),
      validate_fn: isRecordPayload,
    });
  }
}

/** Zigbee adapter for coordinator-normalized cluster traffic. */
export class ZigbeeFrameAdapter extends ProtocolAdapter<Record<string, unknown>> {
  public constructor(fieldMap: FieldMap = DEFAULT_FIELD_MAP) {
    super({
      transport: 'zigbee',
      reliability: Reliability.AT_LEAST_ONCE,
      max_latency_ms: 1000,
      field_map: fieldMap,
      security_level: 'SIGNED',
      buffer_capacity: 1024,
      decode_fn: decodeIndustrialPayload('zigbee', 'zigbee_cluster'),
      validate_fn: isRecordPayload,
    });
  }
}

/** DNP3 adapter for outstation point events represented by a gateway. */
export class Dnp3Adapter extends ProtocolAdapter<Record<string, unknown>> {
  public constructor(fieldMap: FieldMap = DEFAULT_FIELD_MAP) {
    super({
      transport: 'dnp3',
      reliability: Reliability.AT_LEAST_ONCE,
      max_latency_ms: 500,
      field_map: fieldMap,
      security_level: 'SIGNED',
      buffer_capacity: 1024,
      decode_fn: decodeIndustrialPayload('dnp3', 'dnp3_point'),
      validate_fn: isRecordPayload,
    });
  }
}

/** PROFINET observation adapter for passive IO or DCP metadata. */
export class ProfinetObservationAdapter extends ProtocolAdapter<Record<string, unknown>> {
  public constructor(fieldMap: FieldMap = DEFAULT_FIELD_MAP) {
    super({
      transport: 'profinet',
      reliability: Reliability.AT_LEAST_ONCE,
      max_latency_ms: 100,
      field_map: fieldMap,
      security_level: 'NONE',
      buffer_capacity: 1024,
      decode_fn: decodeIndustrialPayload('profinet', 'profinet_io'),
      validate_fn: isRecordPayload,
    });
  }
}

/** EtherNet/IP adapter for CIP object events represented by a gateway. */
export class EthernetIpAdapter extends ProtocolAdapter<Record<string, unknown>> {
  public constructor(fieldMap: FieldMap = DEFAULT_FIELD_MAP) {
    super({
      transport: 'ethernet_ip',
      reliability: Reliability.AT_LEAST_ONCE,
      max_latency_ms: 250,
      field_map: fieldMap,
      security_level: 'NONE',
      buffer_capacity: 1024,
      decode_fn: decodeIndustrialPayload('ethernet_ip', 'cip_object'),
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

function decodeIndustrialPayload(protocol: string, capability: string) {
  return (raw: unknown): Record<string, unknown> => {
    const message = decodeFlexibleRecord(raw);
    const deviceId =
      stringValue(
        message.deviceId ??
          message.device_id ??
          message.unitId ??
          message.slaveId ??
          message.nodeId ??
          message.publisherId ??
          message.deviceInstance ??
          message.arbitrationId ??
          message.ieeeAddress ??
          message.stationName,
      ) ?? `${protocol}-${randomId()}`;
    const timestamp = message.timestamp ?? new Date().toISOString();
    const sequenceId =
      message.sequenceId ??
      message.sequence_id ??
      message.transactionId ??
      message.invokeId ??
      message.counter ??
      message.id ??
      randomUUID();
    return {
      deviceId,
      timestamp,
      sequenceId,
      payload: {
        capability: message.capability ?? capability,
        value:
          message.value ??
          message.registers ??
          message.points ??
          message.data ??
          message.payload ??
          message.frame,
        metadata: compactRecord({
          protocol,
          path: message.path,
          method: message.method,
          unitId: message.unitId,
          slaveId: message.slaveId,
          functionCode: message.functionCode,
          register: message.register,
          nodeId: message.nodeId,
          publisherId: message.publisherId,
          objectId: message.objectId,
          deviceInstance: message.deviceInstance,
          arbitrationId: message.arbitrationId ?? message.canId,
          clusterId: message.clusterId,
          endpoint: message.endpoint,
          outstation: message.outstation,
          pointIndex: message.pointIndex,
          stationName: message.stationName,
          service: message.service,
          sourceAddress: message.sourceAddress,
          destinationAddress: message.destinationAddress,
          byteLength: message.byteLength,
          ...(message.metadata !== null &&
          typeof message.metadata === 'object' &&
          !Array.isArray(message.metadata)
            ? (message.metadata as Record<string, unknown>)
            : {}),
        }),
      },
    };
  };
}

function decodeFlexibleRecord(raw: unknown): Record<string, unknown> {
  if (Buffer.isBuffer(raw)) {
    const text = raw.toString('utf8').trim();
    if (text.startsWith('{') || text.startsWith('[')) {
      return decodeJson(text);
    }
    return {
      frame: raw.toString('hex'),
      byteLength: raw.byteLength,
    };
  }
  if (typeof raw === 'string') {
    const text = raw.trim();
    if (text.startsWith('{') || text.startsWith('[')) {
      return decodeJson(text);
    }
    return { frame: text, byteLength: Buffer.byteLength(text) };
  }
  return decodeJson(raw);
}

function compactRecord(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter((entry) => entry[1] !== undefined));
}

function stringValue(value: unknown): string | undefined {
  if (typeof value === 'string' && value.length > 0) {
    return value;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }
  return undefined;
}

function randomId(): string {
  return randomUUID().slice(0, 8);
}
