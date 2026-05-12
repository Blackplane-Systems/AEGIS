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

function mqttReliability(qos: 0 | 1 | 2): Reliability {
  if (qos === 0) {
    return Reliability.AT_MOST_ONCE;
  }
  if (qos === 1) {
    return Reliability.AT_LEAST_ONCE;
  }
  return Reliability.EXACTLY_ONCE;
}
