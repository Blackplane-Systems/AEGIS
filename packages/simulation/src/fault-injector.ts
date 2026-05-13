import { GilbertElliottChannel } from './gilbert-elliott';

/** Avizienis taxonomy level. */
export type FaultLevel = 'Fault' | 'Error' | 'Failure';

/** Device event shape used by the fault injector. */
export interface SimulatedEvent {
  readonly timestamp: number;
  readonly payload: Record<string, unknown>;
  readonly ack?: boolean;
  readonly responsive?: boolean;
}

/** Fault injection definition. */
export interface FaultInjection {
  readonly id: string;
  readonly level: FaultLevel;
  readonly kind:
    | 'CORRUPT_SENSOR'
    | 'DEGRADE_BATTERY'
    | 'DROP_ACK'
    | 'STALE_TIMESTAMP'
    | 'UNRESPONSIVE'
    | 'CONSTANT_WRONG_VALUE';
  readonly startMs: number;
  readonly durationMs: number;
}

/** Observable fault injection engine with automatic time-bound restore. */
export class FaultInjector {
  private readonly injections: FaultInjection[] = [];

  /** Registers one bounded injection. */
  public add(injection: FaultInjection): void {
    this.injections.push(injection);
  }

  /** Applies active injections to an event at the supplied simulated time. */
  public apply(event: SimulatedEvent, nowMs: number): SimulatedEvent {
    let next = structuredClone(event);
    for (const injection of this.injections.filter((item) => isActive(item, nowMs))) {
      next = applyInjection(next, injection);
    }
    return next;
  }

  /** Applies channel delivery and then device fault injections. */
  public transmitWithChannel<T extends SimulatedEvent>(
    channel: GilbertElliottChannel,
    event: T,
    nowMs: number,
  ): { readonly delivered: boolean; readonly event?: SimulatedEvent } {
    const result = channel.transmit(event);
    if (!result.delivered) {
      return { delivered: false };
    }
    return { delivered: true, event: this.apply(event, nowMs) };
  }
}

function isActive(injection: FaultInjection, nowMs: number): boolean {
  return nowMs >= injection.startMs && nowMs < injection.startMs + injection.durationMs;
}

function applyInjection(event: SimulatedEvent, injection: FaultInjection): SimulatedEvent {
  switch (injection.kind) {
    case 'CORRUPT_SENSOR':
      return {
        ...event,
        payload: Object.fromEntries(
          Object.entries(event.payload).map(([key, value]) => [
            key,
            key === 'value' && typeof value === 'number' ? Math.trunc(value) ^ 1 : value,
          ]),
        ),
      };
    case 'DEGRADE_BATTERY':
      return {
        ...event,
        payload: {
          ...event.payload,
          battery_rate_of_change: Number(event.payload.battery_rate_of_change ?? 0) + 0.5,
        },
      };
    case 'DROP_ACK':
      return { ...event, ack: false };
    case 'STALE_TIMESTAMP':
      return { ...event, timestamp: event.timestamp - 60_000 };
    case 'UNRESPONSIVE':
      return { ...event, responsive: false };
    case 'CONSTANT_WRONG_VALUE':
      return { ...event, payload: { ...event.payload, value: -9999 } };
  }
}
