/** Reliability lattice ordered AT_MOST_ONCE <= AT_LEAST_ONCE <= EXACTLY_ONCE. */
export enum Reliability {
  AT_MOST_ONCE = 'AT_MOST_ONCE',
  AT_LEAST_ONCE = 'AT_LEAST_ONCE',
  EXACTLY_ONCE = 'EXACTLY_ONCE',
}

/** Canonical event shape consumed by the AEGIS runtime. */
export interface CanonicalEvent {
  readonly deviceId: string;
  readonly timestamp: string;
  readonly payload: Record<string, unknown>;
  readonly sourceProtocol: string;
  readonly sequenceId: string | number;
}

/** Adapter schema from Phase 1 section 3.2. */
export interface AdapterSpec<TDecoded = unknown> {
  readonly transport: string;
  readonly reliability: Reliability;
  readonly max_latency_ms: number;
  readonly field_map: FieldMap;
  readonly security_level: 'NONE' | 'SIGNED' | 'ENCRYPTED' | 'MUTUAL_TLS';
  readonly buffer_capacity: number;
  readonly decode_fn: (raw: Buffer | string | unknown) => TDecoded;
  readonly validate_fn: (decoded: TDecoded) => boolean;
}

/** Maps canonical fields to native payload paths. */
export interface FieldMap {
  readonly deviceId: string;
  readonly timestamp: string;
  readonly payload: string;
  readonly sequenceId: string;
}

const RELIABILITY_ORDER: Record<Reliability, number> = {
  [Reliability.AT_MOST_ONCE]: 0,
  [Reliability.AT_LEAST_ONCE]: 1,
  [Reliability.EXACTLY_ONCE]: 2,
};

/** Returns the meet/greatest lower bound of a chain of reliability stages. */
export function composeReliability(stages: readonly Reliability[]): Reliability {
  if (stages.length === 0) {
    throw new Error('composeReliability requires at least one stage');
  }
  return stages.reduce((lowest, stage) =>
    RELIABILITY_ORDER[stage] < RELIABILITY_ORDER[lowest] ? stage : lowest,
  );
}
