import { applyFieldMap } from './field-map';
import { AdapterSpec, CanonicalEvent } from './types';

/** Abstract protocol adapter contract for decode, validate, and normalise. */
export abstract class ProtocolAdapter<TDecoded = unknown> {
  public readonly spec: AdapterSpec<TDecoded>;

  public constructor(spec: AdapterSpec<TDecoded>) {
    this.spec = spec;
  }

  /** Decodes a native payload into an adapter-specific object. */
  public decode(raw: Buffer | string | unknown): TDecoded {
    return this.spec.decode_fn(raw);
  }

  /** Validates a decoded adapter payload. */
  public validate(decoded: TDecoded): boolean {
    return this.spec.validate_fn(decoded);
  }

  /** Decodes, validates, and maps a native payload into a CanonicalEvent. */
  public normalise(raw: Buffer | string | unknown): CanonicalEvent {
    const decoded = this.decode(raw);
    if (!this.validate(decoded)) {
      throw new Error(`${this.spec.transport} payload failed validation`);
    }
    return applyFieldMap(toRecord(decoded), this.spec.field_map, this.spec.transport);
  }
}

/** Parses a JSON string or Buffer into a record. */
export function decodeJson(raw: Buffer | string | unknown): Record<string, unknown> {
  if (Buffer.isBuffer(raw)) {
    return toRecord(JSON.parse(raw.toString('utf8')));
  }
  if (typeof raw === 'string') {
    return toRecord(JSON.parse(raw));
  }
  return toRecord(raw);
}

/** Basic decoded-record validation helper. */
export function isRecordPayload(decoded: unknown): decoded is Record<string, unknown> {
  return decoded !== null && typeof decoded === 'object' && !Array.isArray(decoded);
}

function toRecord(decoded: unknown): Record<string, unknown> {
  if (!isRecordPayload(decoded)) {
    throw new Error('Decoded payload must be an object');
  }
  return decoded;
}
