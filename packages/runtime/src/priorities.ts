/** Runtime event priorities; larger numbers are processed first. */
export enum EventPriority {
  HOUSEKEEPING = 1,
  TELEMETRY = 2,
  SENSOR_EVENT = 3,
  TRUST_UPDATE = 4,
  ACTUATION_REQUEST = 5,
  ROLLBACK = 5.5,
  SAFETY_ALERT = 6,
}

/** Item that can be ordered by the runtime priority queue. */
export interface Prioritized {
  readonly priority: EventPriority;
  readonly createdAt: number;
}

/** Returns negative when a should be processed before b. */
export function comparePriority(a: Prioritized, b: Prioritized): number {
  if (a.priority !== b.priority) {
    return b.priority - a.priority;
  }
  return a.createdAt - b.createdAt;
}
