import { CanonicalEvent } from '../../protocol/src';
import { BackendConnector, BackendDeliveryResult, BackendScope } from './types';

/** In-memory backend connector used for local deployments, tests, and offline spooling. */
export class MemoryBackendConnector implements BackendConnector {
  public readonly events: CanonicalEvent[] = [];

  public constructor(
    public readonly id: string,
    public readonly scope: BackendScope = 'LOCAL',
    private failNextPush = false,
  ) {}

  public async push(event: CanonicalEvent): Promise<void> {
    if (this.failNextPush) {
      this.failNextPush = false;
      throw new Error(`${this.id} simulated failure`);
    }
    this.events.push(event);
  }

  public failOnce(): void {
    this.failNextPush = true;
  }
}

/** HTTP JSON backend connector for cloud or remote management integration. */
export class HttpBackendConnector implements BackendConnector {
  public readonly scope: BackendScope = 'REMOTE';

  public constructor(
    public readonly id: string,
    private readonly url: string,
    private readonly headers: Record<string, string> = {},
  ) {}

  public async push(event: CanonicalEvent): Promise<void> {
    const response = await fetch(this.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...this.headers },
      body: JSON.stringify(event),
    });
    if (!response.ok) {
      throw new Error(`${this.id} returned HTTP ${response.status}`);
    }
  }
}

interface PendingBackendEvent {
  readonly connector: BackendConnector;
  readonly event: CanonicalEvent;
}

/** Fanout layer that can deliver locally, remotely, and queue failed backend writes. */
export class BackendFanout {
  private readonly pending: PendingBackendEvent[] = [];

  public constructor(private readonly connectors: readonly BackendConnector[] = []) {}

  /** Sends an event to configured backends, optionally skipping remote destinations. */
  public async publish(
    event: CanonicalEvent,
    options: { readonly localOnly: boolean },
  ): Promise<readonly BackendDeliveryResult[]> {
    const eligible = this.connectors.filter(
      (connector) => !options.localOnly || connector.scope === 'LOCAL',
    );
    const results: BackendDeliveryResult[] = [];
    for (const connector of eligible) {
      try {
        await connector.push(event);
        results.push({ backendId: connector.id, delivered: true, queued: false });
      } catch (error) {
        this.pending.push({ connector, event });
        results.push({
          backendId: connector.id,
          delivered: false,
          queued: true,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    return results;
  }

  /** Retries queued backend writes and keeps failures pending. */
  public async flushPending(): Promise<readonly BackendDeliveryResult[]> {
    const retry = this.pending.splice(0, this.pending.length);
    const results: BackendDeliveryResult[] = [];
    for (const item of retry) {
      try {
        await item.connector.push(item.event);
        results.push({ backendId: item.connector.id, delivered: true, queued: false });
      } catch (error) {
        this.pending.push(item);
        results.push({
          backendId: item.connector.id,
          delivered: false,
          queued: true,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    return results;
  }

  /** Returns the number of queued backend writes. */
  public pendingCount(): number {
    return this.pending.length;
  }
}
