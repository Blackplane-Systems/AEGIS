import { createHash, randomUUID } from 'crypto';

/** Audit record categories produced by AEGIS modules. */
export type AuditRecordType =
  | 'ACTUATION_DECISION'
  | 'POLICY_EVALUATION'
  | 'TRUST_UPDATE'
  | 'STATE_TRANSITION';

/** OpenTelemetry-aligned span event. */
export interface AuditSpanEvent {
  readonly name: string;
  readonly timestamp: string;
  readonly attributes?: Record<string, unknown>;
}

/** OpenTelemetry-aligned span structure. */
export interface AuditSpan {
  readonly trace_id: string;
  readonly span_id: string;
  readonly parent_id?: string;
  readonly attributes: Record<string, unknown>;
  readonly events: readonly AuditSpanEvent[];
  readonly status: 'OK' | 'ERROR' | 'UNSET';
}

/** Structured append-only audit record. */
export interface AuditRecord {
  readonly id: string;
  readonly deviceId: string;
  readonly type: AuditRecordType;
  readonly timestamp: string;
  readonly data: Record<string, unknown>;
  readonly span: AuditSpan;
}

/** Merkle block in the audit chain. */
export interface AuditBlock {
  readonly index: number;
  readonly record: AuditRecord;
  readonly ts: string;
  readonly prev_hash: string;
  readonly hash: string;
}

/** Append-only structured audit log backed by a SHA-256 Merkle chain. */
export class StructuredAuditLog {
  private readonly chain: AuditBlock[] = [];

  /** Appends a record and returns the immutable Merkle block. */
  public append(record: AuditRecord): AuditBlock {
    const index = this.chain.length;
    const ts = record.timestamp;
    const prev_hash = this.chain[index - 1]?.hash ?? 'GENESIS';
    const block: AuditBlock = {
      index,
      record: structuredClone(record),
      ts,
      prev_hash,
      hash: hashBlock(index, record, ts, prev_hash),
    };
    this.chain.push(block);
    return structuredClone(block);
  }

  /** Returns a cloned chain snapshot. */
  public blocks(): readonly AuditBlock[] {
    return structuredClone(this.chain);
  }

  /** Returns latest records for a device. */
  public forDevice(deviceId: string, limit = Number.POSITIVE_INFINITY): readonly AuditRecord[] {
    return this.chain
      .filter((block) => block.record.deviceId === deviceId)
      .slice(-limit)
      .map((block) => structuredClone(block.record));
  }
}

/** Creates a complete audit record with span defaults. */
export function createAuditRecord(
  input: Omit<AuditRecord, 'id' | 'timestamp' | 'span'> & {
    readonly timestamp?: string;
    readonly span?: Partial<AuditSpan>;
  },
): AuditRecord {
  const timestamp = input.timestamp ?? new Date().toISOString();
  const traceId = input.span?.trace_id ?? randomUUID().replace(/-/g, '');
  const span: AuditSpan = {
    trace_id: traceId,
    span_id: input.span?.span_id ?? randomUUID().replace(/-/g, '').slice(0, 16),
    attributes: input.span?.attributes ?? {},
    events: input.span?.events ?? [],
    status: input.span?.status ?? 'OK',
  };
  if (input.span?.parent_id !== undefined) {
    return {
      id: randomUUID(),
      deviceId: input.deviceId,
      type: input.type,
      timestamp,
      data: input.data,
      span: {
        ...span,
        parent_id: input.span.parent_id,
      },
    };
  }
  return {
    id: randomUUID(),
    deviceId: input.deviceId,
    type: input.type,
    timestamp,
    data: input.data,
    span,
  };
}

/** Verifies a Merkle chain and returns the first tampered block index, or null. */
export function verifyChain(blocks: readonly AuditBlock[]): number | null {
  for (let index = 0; index < blocks.length; index += 1) {
    const block = blocks[index];
    if (block === undefined) {
      return index;
    }
    const expectedPrev = index === 0 ? 'GENESIS' : blocks[index - 1]?.hash;
    if (block.index !== index || block.prev_hash !== expectedPrev) {
      return index;
    }
    if (block.hash !== hashBlock(block.index, block.record, block.ts, block.prev_hash)) {
      return index;
    }
  }
  return null;
}

/** Reconstructs span causality for one trace_id. */
export function reconstructSpanChain(
  blocks: readonly AuditBlock[],
  traceId: string,
): readonly AuditSpan[] {
  const spans = blocks
    .map((block) => block.record.span)
    .filter((span) => span.trace_id === traceId)
    .sort((a, b) => (a.parent_id === b.span_id ? 1 : b.parent_id === a.span_id ? -1 : 0));
  return structuredClone(spans);
}

function hashBlock(index: number, record: AuditRecord, ts: string, prevHash: string): string {
  return createHash('sha256')
    .update(`${index}|${JSON.stringify(record)}|${ts}|${prevHash}`)
    .digest('hex');
}
