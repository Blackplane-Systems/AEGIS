import { UniversalIngressEnvelope, EdgeTransport } from './types';

/** Supported logical channel frame formats. */
export type ChannelFrameFormat = 'JSON' | 'JSON_LINES' | 'RS485_MULTIPLEX_JSON';

/** Channel definition for LAN, serial bus, LoRa gateway, MQTT bridge, or cloud ingress. */
export interface GatewayChannelDefinition {
  readonly id: string;
  readonly transport: EdgeTransport;
  readonly segmentId: string;
  readonly frameFormat: ChannelFrameFormat;
  readonly defaultSecurityMode?: UniversalIngressEnvelope['security']['mode'];
  readonly maxFrameBytes: number;
  readonly requireDeviceIdentityInPayload: boolean;
}

/** Frame parsing result for multi-device streams. */
export interface ChannelFrameParseResult {
  readonly channelId: string;
  readonly envelopes: readonly UniversalIngressEnvelope[];
}

/** Parses mixed edge channels including RS485-style multi-device JSON streams. */
export class MultiChannelProcessor {
  private readonly channels = new Map<string, GatewayChannelDefinition>();

  public constructor(channels: readonly GatewayChannelDefinition[] = []) {
    for (const channel of channels) {
      this.register(channel);
    }
  }

  /** Registers or replaces a channel definition. */
  public register(channel: GatewayChannelDefinition): void {
    if (channel.id.length === 0) {
      throw new Error('Channel id is required');
    }
    this.channels.set(channel.id, channel);
  }

  /** Parses one raw channel frame into universal ingress envelopes. */
  public parse(channelId: string, frame: string | Buffer): ChannelFrameParseResult {
    const channel = this.channels.get(channelId);
    if (channel === undefined) {
      throw new Error(`Unknown channel: ${channelId}`);
    }
    const text = Buffer.isBuffer(frame) ? frame.toString('utf8') : frame;
    if (Buffer.byteLength(text, 'utf8') > channel.maxFrameBytes) {
      throw new Error(`Frame exceeds ${channel.maxFrameBytes} bytes`);
    }
    const records =
      channel.frameFormat === 'JSON_LINES'
        ? text
            .split(/\r?\n/)
            .map((line) => line.trim())
            .filter((line) => line.length > 0)
            .map((line) => JSON.parse(line) as Record<string, unknown>)
        : [JSON.parse(text) as Record<string, unknown>];
    return {
      channelId,
      envelopes: records.map((record) => toEnvelope(channel, record)),
    };
  }

  /** Lists configured channels. */
  public list(): readonly GatewayChannelDefinition[] {
    return [...this.channels.values()].sort((left, right) => left.id.localeCompare(right.id));
  }
}

function toEnvelope(
  channel: GatewayChannelDefinition,
  record: Record<string, unknown>,
): UniversalIngressEnvelope {
  const deviceId = stringField(record.deviceId ?? record.device_id ?? record.id, 'deviceId');
  if (channel.requireDeviceIdentityInPayload && deviceId.length === 0) {
    throw new Error('Channel frame requires device identity');
  }
  const security =
    record.security !== null &&
    typeof record.security === 'object' &&
    !Array.isArray(record.security)
      ? (record.security as UniversalIngressEnvelope['security'])
      : { mode: channel.defaultSecurityMode ?? 'OPEN_BROADCAST' };
  return {
    deviceId,
    transport: channel.transport,
    eventKind: eventKind(record.eventKind ?? record.event_kind ?? record.kind),
    timestamp: stringOrNow(record.timestamp),
    sequenceId: sequenceId(record.sequenceId ?? record.sequence_id ?? record.seq),
    payload: record.payload ?? {
      capability: record.capability,
      value: record.value,
      metadata: record.metadata,
    },
    security,
    metadata: {
      channelId: channel.id,
      segmentId: channel.segmentId,
      ...(record.metadata !== null &&
      typeof record.metadata === 'object' &&
      !Array.isArray(record.metadata)
        ? (record.metadata as Record<string, unknown>)
        : {}),
    },
  };
}

function stringField(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`Channel frame requires ${field}`);
  }
  return value;
}

function stringOrNow(value: unknown): string {
  return typeof value === 'string' ? value : new Date().toISOString();
}

function sequenceId(value: unknown): string | number {
  if (typeof value === 'string' || typeof value === 'number') {
    return value;
  }
  throw new Error('Channel frame requires sequenceId');
}

function eventKind(value: unknown): UniversalIngressEnvelope['eventKind'] {
  if (
    value === 'TELEMETRY' ||
    value === 'SENSOR_EVENT' ||
    value === 'TRUST_UPDATE' ||
    value === 'COMMAND' ||
    value === 'HOUSEKEEPING'
  ) {
    return value;
  }
  return 'TELEMETRY';
}
