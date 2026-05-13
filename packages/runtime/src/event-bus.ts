/** Async publish/subscribe handler used by the runtime event bus. */
export type EventBusHandler<TEvent> = (event: TEvent) => Promise<void> | void;

/** Delivery summary returned after publishing to all subscribers. */
export interface EventBusPublishResult {
  readonly delivered: number;
  readonly failed: number;
  readonly errors: readonly Error[];
}

/** Bounded in-memory event bus with subscriber failure isolation. */
export class EventBus<TEvent> {
  private readonly handlers = new Set<EventBusHandler<TEvent>>();
  private readonly log: TEvent[] = [];

  public constructor(private readonly maxLogSize = 500) {
    if (!Number.isInteger(maxLogSize) || maxLogSize <= 0) {
      throw new Error('EventBus maxLogSize must be a positive integer');
    }
  }

  /** Subscribes a handler and returns an unsubscribe callback. */
  public subscribe(handler: EventBusHandler<TEvent>): () => void {
    this.handlers.add(handler);
    return () => this.unsubscribe(handler);
  }

  /** Removes a previously subscribed handler. */
  public unsubscribe(handler: EventBusHandler<TEvent>): void {
    this.handlers.delete(handler);
  }

  /** Publishes an event to all subscribers while preserving a bounded recent-event log. */
  public async publish(event: TEvent): Promise<EventBusPublishResult> {
    this.appendLog(event);
    const results = await Promise.allSettled(
      [...this.handlers].map(async (handler) => handler(event)),
    );
    const errors = results
      .filter((result): result is PromiseRejectedResult => result.status === 'rejected')
      .map((result) =>
        result.reason instanceof Error ? result.reason : new Error(String(result.reason)),
      );
    return {
      delivered: results.length - errors.length,
      failed: errors.length,
      errors,
    };
  }

  /** Returns up to count recent events in publish order. */
  public getRecentLogs(count = this.maxLogSize): readonly TEvent[] {
    return this.log.slice(-Math.max(0, count));
  }

  /** Returns the number of subscribed handlers. */
  public subscriberCount(): number {
    return this.handlers.size;
  }

  private appendLog(event: TEvent): void {
    this.log.push(event);
    if (this.log.length > this.maxLogSize) {
      this.log.splice(0, this.log.length - this.maxLogSize);
    }
  }
}
