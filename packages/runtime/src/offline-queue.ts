import { EventPriority, Prioritized, comparePriority } from './priorities';

/** Overflow policies for bounded offline queues. */
export enum EvictionPolicy {
  DROP_OLDEST = 'DROP_OLDEST',
  DROP_LOWEST_PRI = 'DROP_LOWEST_PRI',
  BLOCK_PRODUCER = 'BLOCK_PRODUCER',
  REJECT_NEW = 'REJECT_NEW',
}

/** Backpressure signal returned when BLOCK_PRODUCER cannot accept a new item. */
export interface BackpressureSignal {
  readonly blocked: true;
  readonly promise: Promise<void>;
}

/** Result of an enqueue operation. */
export interface EnqueueResult<T> {
  readonly accepted: boolean;
  readonly evicted?: T;
  readonly backpressure?: BackpressureSignal;
}

/** Bounded priority queue with configurable overflow behavior. */
export class OfflineQueue<T extends Prioritized> {
  private readonly items: T[] = [];
  private readonly blockedResolvers: Array<() => void> = [];

  public constructor(
    public readonly maxSize: number,
    public readonly policy: EvictionPolicy = EvictionPolicy.REJECT_NEW,
  ) {
    if (maxSize <= 0) {
      throw new Error('OfflineQueue maxSize must be positive');
    }
  }

  /** Number of queued items. */
  public get size(): number {
    return this.items.length;
  }

  /** Returns a snapshot ordered by strict priority. */
  public snapshot(): readonly T[] {
    return [...this.items].sort(comparePriority);
  }

  /** Enqueues an item according to the configured overflow policy. */
  public enqueue(item: T): EnqueueResult<T> {
    if (this.items.length < this.maxSize) {
      this.items.push(item);
      return { accepted: true };
    }

    switch (this.policy) {
      case EvictionPolicy.DROP_OLDEST: {
        const evicted = this.items.shift();
        this.items.push(item);
        return evicted === undefined ? { accepted: true } : { accepted: true, evicted };
      }
      case EvictionPolicy.DROP_LOWEST_PRI:
        return this.dropLowestPriority(item);
      case EvictionPolicy.BLOCK_PRODUCER:
        return { accepted: false, backpressure: this.createBackpressureSignal() };
      case EvictionPolicy.REJECT_NEW:
        return { accepted: false };
    }
  }

  /** Dequeues the highest-priority item and releases one blocked producer. */
  public dequeue(): T | undefined {
    if (this.items.length === 0) {
      return undefined;
    }
    const ordered = this.snapshot();
    const next = ordered[0];
    if (next === undefined) {
      return undefined;
    }
    const index = this.items.indexOf(next);
    this.items.splice(index, 1);
    this.releaseOneProducer();
    return next;
  }

  /** Returns all items of the selected priorities in processing order, removing them from the queue. */
  public drainPriorities(priorities: readonly EventPriority[]): T[] {
    const accepted = new Set(priorities);
    const drained: T[] = [];
    for (;;) {
      const next = this.snapshot().find((item) => accepted.has(item.priority));
      if (next === undefined) {
        break;
      }
      const index = this.items.indexOf(next);
      this.items.splice(index, 1);
      drained.push(next);
      this.releaseOneProducer();
    }
    return drained;
  }

  private dropLowestPriority(item: T): EnqueueResult<T> {
    let lowestIndex = 0;
    for (let index = 1; index < this.items.length; index += 1) {
      if (comparePriority(this.items[index]!, this.items[lowestIndex]!) > 0) {
        lowestIndex = index;
      }
    }
    const lowest = this.items[lowestIndex]!;
    if (comparePriority(item, lowest) >= 0) {
      return { accepted: false };
    }
    const [evicted] = this.items.splice(lowestIndex, 1);
    this.items.push(item);
    return evicted === undefined ? { accepted: true } : { accepted: true, evicted };
  }

  private createBackpressureSignal(): BackpressureSignal {
    let resolve!: () => void;
    const promise = new Promise<void>((done) => {
      resolve = done;
    });
    this.blockedResolvers.push(resolve);
    return { blocked: true, promise };
  }

  private releaseOneProducer(): void {
    const resolve = this.blockedResolvers.shift();
    resolve?.();
  }
}

/** Emits a runtime warning if Little's Law stability condition is violated. */
export function assertLittleLawStability(
  arrivalRate: number,
  serviceRate: number,
  warn: (message: string) => void = console.warn,
): boolean {
  if (arrivalRate >= serviceRate) {
    warn(`OfflineQueue unstable: arrival rate ${arrivalRate} >= service rate ${serviceRate}`);
    return false;
  }
  return true;
}
