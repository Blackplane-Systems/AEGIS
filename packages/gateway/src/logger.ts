/** Gateway log event categories retained for replay and operator audit. */
export type GatewayLogType =
  | 'INGRESS_ACCEPTED'
  | 'INGRESS_REJECTED'
  | 'REGISTRATION_ACCEPTED'
  | 'REGISTRATION_REJECTED'
  | 'BACKEND_DELIVERY'
  | 'BASELINE_DEVIATION'
  | 'ATTACK_LEARNED'
  | 'NETWORK_FINDING'
  | 'NETWORK_ACTION';

/** Structured gateway log record. */
export interface GatewayLogRecord {
  readonly id: string;
  readonly type: GatewayLogType;
  readonly timestamp: string;
  readonly deviceId?: string;
  readonly channelId?: string;
  readonly transport?: string;
  readonly message: string;
  readonly attributes?: Record<string, unknown>;
}

/** Query for recent gateway logs or replay windows. */
export interface GatewayLogQuery {
  readonly type?: GatewayLogType;
  readonly deviceId?: string;
  readonly channelId?: string;
  readonly since?: string;
  readonly until?: string;
  readonly limit?: number;
}

/** Bounded append-only gateway logger with deterministic replay queries. */
export class StructuredGatewayLogger {
  private readonly records: GatewayLogRecord[] = [];
  private nextId = 0;

  public constructor(private readonly maxRecords = 5_000) {
    if (!Number.isInteger(maxRecords) || maxRecords <= 0) {
      throw new Error('StructuredGatewayLogger maxRecords must be a positive integer');
    }
  }

  /** Appends a structured gateway log record. */
  public append(
    record: Omit<GatewayLogRecord, 'id' | 'timestamp'> & { readonly timestamp?: string },
  ): GatewayLogRecord {
    const full: GatewayLogRecord = {
      id: `gateway-log-${this.nextId++}`,
      timestamp: record.timestamp ?? new Date().toISOString(),
      type: record.type,
      message: record.message,
      ...(record.deviceId === undefined ? {} : { deviceId: record.deviceId }),
      ...(record.channelId === undefined ? {} : { channelId: record.channelId }),
      ...(record.transport === undefined ? {} : { transport: record.transport }),
      ...(record.attributes === undefined ? {} : { attributes: record.attributes }),
    };
    this.records.push(full);
    if (this.records.length > this.maxRecords) {
      this.records.splice(0, this.records.length - this.maxRecords);
    }
    return full;
  }

  /** Queries retained log records in append order. */
  public query(query: GatewayLogQuery = {}): readonly GatewayLogRecord[] {
    const since = query.since === undefined ? Number.NEGATIVE_INFINITY : Date.parse(query.since);
    const until = query.until === undefined ? Number.POSITIVE_INFINITY : Date.parse(query.until);
    const filtered = this.records.filter((record) => {
      const time = Date.parse(record.timestamp);
      return (
        (query.type === undefined || record.type === query.type) &&
        (query.deviceId === undefined || record.deviceId === query.deviceId) &&
        (query.channelId === undefined || record.channelId === query.channelId) &&
        time >= since &&
        time <= until
      );
    });
    return filtered.slice(-(query.limit ?? filtered.length));
  }

  /** Replays retained log records for diagnostics or downstream reconstruction. */
  public replay(query: GatewayLogQuery = {}): readonly GatewayLogRecord[] {
    return this.query(query);
  }
}
