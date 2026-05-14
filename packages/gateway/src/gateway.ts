import { CanonicalEvent } from '../../protocol/src';
import {
  DeviceDiscoveryRegistry,
  DigitalTwinManager,
  EventBus,
  TwinObservation,
} from '../../runtime/src';
import { BackendFanout } from './backend';
import { createGatewayConfig } from './config';
import { GatewayReplayGuard } from './replay';
import { GatewayCredentialRegistry, verifyIngressSecurity } from './security';
import {
  BackendConnector,
  GatewayConfig,
  GatewayIngressResult,
  UniversalIngressEnvelope,
} from './types';

/** Runtime event emitted by the optional gateway process. */
export interface GatewayRuntimeEvent {
  readonly type: 'INGRESS_ACCEPTED' | 'INGRESS_REJECTED';
  readonly deviceId: string;
  readonly transport: string;
  readonly timestamp: string;
  readonly reason?: string;
}

/** Optional production gateway for heterogeneous edge transports and backend fanout. */
export class EdgeGateway {
  private readonly config: GatewayConfig;
  private readonly credentials: GatewayCredentialRegistry;
  private readonly replayGuard: GatewayReplayGuard;
  private readonly fanout: BackendFanout;
  private readonly events: EventBus<GatewayRuntimeEvent>;
  private readonly discovery = new DeviceDiscoveryRegistry();
  private readonly twins = new DigitalTwinManager();

  public constructor(config: GatewayConfig, backends: readonly BackendConnector[] = []) {
    this.config = createGatewayConfig(config);
    this.credentials = new GatewayCredentialRegistry(this.config.credentials);
    this.replayGuard = new GatewayReplayGuard(this.config.replayWindowMs);
    this.fanout = new BackendFanout(backends);
    this.events = new EventBus<GatewayRuntimeEvent>(this.config.eventLogSize);
  }

  /** Accepts one universal edge envelope and routes it into local state and optional backends. */
  public async ingest(
    envelope: UniversalIngressEnvelope,
    nowMs = Date.parse(envelope.timestamp),
  ): Promise<GatewayIngressResult> {
    try {
      const security = verifyIngressSecurity(envelope, this.config, this.credentials);
      const replay = this.replayGuard.check(
        envelope.deviceId,
        envelope.sequenceId,
        envelope.security.nonce,
        Number.isNaN(nowMs) ? Date.now() : nowMs,
      );
      if (!replay.accepted) {
        throw new Error(replay.reason ?? 'replay_rejected');
      }
      const event = this.toCanonicalEvent(envelope, security.payload, security.plaintextAccepted);
      const capability = capabilityFromPayload(security.payload);
      this.discovery.discover({
        deviceId: envelope.deviceId,
        protocol: envelope.transport,
        ...(capability === undefined ? {} : { capability }),
        ...(envelope.metadata === undefined ? {} : { metadata: envelope.metadata }),
        observedAt: event.timestamp,
      });
      this.updateTwin(envelope.eventKind, event, security.payload);
      await this.events.publish({
        type: 'INGRESS_ACCEPTED',
        deviceId: envelope.deviceId,
        transport: envelope.transport,
        timestamp: event.timestamp,
      });
      const backendResults = await this.fanout.publish(event, {
        localOnly: envelope.localOnly === true || this.config.mode === 'LOCAL_ONLY',
      });
      return {
        accepted: true,
        event,
        plaintextAccepted: security.plaintextAccepted,
        backendQueued: backendResults.filter((result) => result.queued).length,
        backendDelivered: backendResults.filter((result) => result.delivered).length,
      };
    } catch (error) {
      await this.events.publish({
        type: 'INGRESS_REJECTED',
        deviceId: envelope.deviceId,
        transport: envelope.transport,
        timestamp: new Date().toISOString(),
        reason: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /** Retries failed backend writes. */
  public async flushBackends(): Promise<readonly unknown[]> {
    return this.fanout.flushPending();
  }

  /** Returns gateway health suitable for authenticated operator APIs. */
  public health(): Record<string, unknown> {
    return {
      status: 'ok',
      mode: this.config.mode,
      devices: this.discovery.list().length,
      pendingBackends: this.fanout.pendingCount(),
      replayTokens: this.replayGuard.tokenCount(),
    };
  }

  /** Lists discovered devices without exposing credentials. */
  public devices(): readonly unknown[] {
    return this.discovery.list();
  }

  /** Returns recent gateway events. */
  public recentEvents(limit = 100): readonly GatewayRuntimeEvent[] {
    return this.events.getRecentLogs(limit);
  }

  /** Returns latest digital twin state for one device. */
  public twinState(deviceId: string): Record<string, unknown> {
    return this.twins.getState(deviceId);
  }

  /** Returns public credential metadata. */
  public credentialSummary(): readonly unknown[] {
    return this.credentials.listPublic();
  }

  private toCanonicalEvent(
    envelope: UniversalIngressEnvelope,
    payload: unknown,
    plaintextAccepted: boolean,
  ): CanonicalEvent {
    return {
      deviceId: envelope.deviceId,
      timestamp: new Date(envelope.timestamp).toISOString(),
      sequenceId: envelope.sequenceId,
      sourceProtocol: envelope.transport,
      payload: toPayloadRecord(payload, {
        eventKind: envelope.eventKind,
        broadcast: envelope.broadcast ?? false,
        plaintextAccepted,
        ...(envelope.metadata === undefined ? {} : { metadata: envelope.metadata }),
      }),
    };
  }

  private updateTwin(eventKind: string, event: CanonicalEvent, originalPayload: unknown): void {
    if (!['TELEMETRY', 'SENSOR_EVENT'].includes(eventKind)) {
      return;
    }
    const observation = twinObservation(event, originalPayload);
    if (observation !== undefined) {
      this.twins.update(observation);
    }
  }
}

function capabilityFromPayload(payload: unknown): string | undefined {
  if (payload !== null && typeof payload === 'object' && !Array.isArray(payload)) {
    const capability = (payload as Record<string, unknown>).capability;
    return typeof capability === 'string' ? capability : undefined;
  }
  return undefined;
}

function twinObservation(event: CanonicalEvent, payload: unknown): TwinObservation | undefined {
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
    return undefined;
  }
  const record = payload as Record<string, unknown>;
  const capability = typeof record.capability === 'string' ? record.capability : undefined;
  if (capability === undefined) {
    return undefined;
  }
  return {
    deviceId: event.deviceId,
    capability,
    value: record.value,
    timestamp: event.timestamp,
    ...(record.metadata !== undefined && typeof record.metadata === 'object'
      ? { metadata: record.metadata as Record<string, unknown> }
      : {}),
  };
}

function toPayloadRecord(
  payload: unknown,
  gatewayMetadata: Record<string, unknown>,
): Record<string, unknown> {
  if (payload !== null && typeof payload === 'object' && !Array.isArray(payload)) {
    return { ...(payload as Record<string, unknown>), gateway: gatewayMetadata };
  }
  return { value: payload, gateway: gatewayMetadata };
}
