import { CanonicalEvent, FieldMap } from './types';

/** Applies a field_map to native fields and returns a canonical runtime event. */
export function applyFieldMap(
  native: Record<string, unknown>,
  fieldMap: FieldMap,
  sourceProtocol: string,
): CanonicalEvent {
  const deviceId = readPath(native, fieldMap.deviceId);
  const timestamp = readPath(native, fieldMap.timestamp);
  const payload = readPath(native, fieldMap.payload);
  const sequenceId = readPath(native, fieldMap.sequenceId);

  if (typeof deviceId !== 'string' || deviceId.length === 0) {
    throw new Error('Canonical event requires a deviceId');
  }
  if (typeof timestamp !== 'string' && typeof timestamp !== 'number') {
    throw new Error('Canonical event requires a timestamp');
  }
  if (typeof sequenceId !== 'string' && typeof sequenceId !== 'number') {
    throw new Error('Canonical event requires a sequenceId');
  }
  return {
    deviceId,
    timestamp: normaliseTimestamp(timestamp),
    payload: toRecord(payload),
    sourceProtocol,
    sequenceId,
  };
}

/** Reads a dot-delimited path from an object. */
export function readPath(record: Record<string, unknown>, path: string): unknown {
  return path.split('.').reduce<unknown>((current, segment) => {
    if (current !== null && typeof current === 'object' && segment in current) {
      return (current as Record<string, unknown>)[segment];
    }
    return undefined;
  }, record);
}

function normaliseTimestamp(value: string | number): string {
  const date = typeof value === 'number' ? new Date(value) : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid timestamp: ${value}`);
  }
  return date.toISOString();
}

function toRecord(value: unknown): Record<string, unknown> {
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return { value };
}
