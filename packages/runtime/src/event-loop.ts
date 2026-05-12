import { OfflineQueue } from './offline-queue';
import { EventPriority, Prioritized } from './priorities';
import { StateStore } from './state-store';

/** Runtime event consumed through async message-passing. */
export interface RuntimeEvent<TPayload = unknown> extends Prioritized {
  readonly id: string;
  readonly kind: string;
  readonly payload: TPayload;
}

/** Component participant in the EventLoop || PolicyEngine || SafetyInterlock model. */
export interface RuntimeComponent {
  readonly name: string;
  handle(event: RuntimeEvent, context: EventLoopContext): Promise<void> | void;
}

/** Context shared with runtime components. */
export interface EventLoopContext {
  readonly stateStore: StateStore;
  readonly emit: (event: RuntimeEvent) => void;
}

/** Priority-queue event loop backed by OfflineQueue and async component handlers. */
export class EventLoop {
  private readonly processedEvents: RuntimeEvent[] = [];
  private shuttingDown = false;

  public constructor(
    private readonly queue: OfflineQueue<RuntimeEvent>,
    private readonly components: readonly RuntimeComponent[] = [],
    private readonly stateStore: StateStore = new StateStore(),
  ) {}

  /** Processed events in the order they were handled. */
  public get processed(): readonly RuntimeEvent[] {
    return [...this.processedEvents];
  }

  /** Submits an event unless shutdown has started. */
  public submit(event: RuntimeEvent): boolean {
    if (this.shuttingDown) {
      return false;
    }
    return this.queue.enqueue(event).accepted;
  }

  /** Processes one highest-priority event. */
  public async tick(): Promise<RuntimeEvent | undefined> {
    const event = this.queue.dequeue();
    if (event === undefined) {
      return undefined;
    }
    await this.dispatch(event);
    return event;
  }

  /** Processes events until the queue is empty. */
  public async runUntilIdle(): Promise<readonly RuntimeEvent[]> {
    while (await this.tick()) {
      // tick handles one message at a time.
    }
    return this.processed;
  }

  /** Drains safety and actuation work before exit. */
  public async shutdown(): Promise<readonly RuntimeEvent[]> {
    this.shuttingDown = true;
    const drained = this.queue.drainPriorities([
      EventPriority.SAFETY_ALERT,
      EventPriority.ROLLBACK,
      EventPriority.ACTUATION_REQUEST,
    ]);
    for (const event of drained) {
      await this.dispatch(event);
    }
    return drained;
  }

  private async dispatch(event: RuntimeEvent): Promise<void> {
    this.processedEvents.push(event);
    const context: EventLoopContext = {
      stateStore: this.stateStore,
      emit: (next) => {
        this.queue.enqueue(next);
      },
    };
    for (const component of this.components) {
      await component.handle(event, context);
    }
  }
}
