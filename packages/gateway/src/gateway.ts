import { CanonicalEvent } from '../../protocol/src';
import {
  DeviceDiscoveryRegistry,
  DigitalTwinManager,
  EventBus,
  TwinObservation,
} from '../../runtime/src';
import { AttackPatternLearner } from './attack-learning';
import { BackendFanout } from './backend';
import { NetworkConditionBaseline, NetworkConditionObservation } from './baseline';
import { GatewayChannelDefinition, MultiChannelProcessor } from './channels';
import { createGatewayConfig } from './config';
import { StructuredGatewayLogger } from './logger';
import {
  NetworkMap,
  NetworkTopologySnapshot,
  NodeReachabilityProbe,
  ProbeResult,
  ProbeTarget,
  ReachabilityProbe,
} from './network-map';
import { GatewayReplayGuard } from './replay';
import {
  DeviceRegistrationPolicy,
  DeviceRegistrationRequest,
  DeviceRegistrationService,
} from './registration';
import { GatewayCredentialRegistry, verifyIngressSecurity } from './security';
import {
  BackendConnector,
  GatewayConfig,
  GatewayIngressResult,
  UniversalIngressEnvelope,
} from './types';

/** Runtime event emitted by the optional gateway process. */
export interface GatewayRuntimeEvent {
  readonly type:
    | 'INGRESS_ACCEPTED'
    | 'INGRESS_REJECTED'
    | 'REGISTRATION_ACCEPTED'
    | 'BASELINE_DEVIATION';
  readonly deviceId: string;
  readonly transport: string;
  readonly timestamp: string;
  readonly reason?: string;
}

/** Optional services used when AEGIS is embedded as an SDK or sidecar. */
export interface EdgeGatewayOptions {
  readonly registrationPolicy?: DeviceRegistrationPolicy;
  readonly logger?: StructuredGatewayLogger;
  readonly attackLearner?: AttackPatternLearner;
  readonly baseline?: NetworkConditionBaseline;
  readonly channels?: readonly GatewayChannelDefinition[];
  readonly networkMap?: NetworkMap;
  readonly reachabilityProbe?: ReachabilityProbe;
}

/** Optional production gateway for heterogeneous edge transports and backend fanout. */
export class EdgeGateway {
  private readonly config: GatewayConfig;
  private readonly credentials: GatewayCredentialRegistry;
  private readonly replayGuard: GatewayReplayGuard;
  private readonly fanout: BackendFanout;
  private readonly events: EventBus<GatewayRuntimeEvent>;
  private readonly logger: StructuredGatewayLogger;
  private readonly attackLearner: AttackPatternLearner;
  private readonly baseline: NetworkConditionBaseline;
  private readonly channels: MultiChannelProcessor;
  private readonly networkMap: NetworkMap;
  private readonly reachabilityProbe: ReachabilityProbe;
  private readonly registration: DeviceRegistrationService | undefined;
  private readonly discovery = new DeviceDiscoveryRegistry();
  private readonly twins = new DigitalTwinManager();

  public constructor(
    config: GatewayConfig,
    backends: readonly BackendConnector[] = [],
    options: EdgeGatewayOptions = {},
  ) {
    this.config = createGatewayConfig(config);
    this.credentials = new GatewayCredentialRegistry(this.config.credentials);
    this.replayGuard = new GatewayReplayGuard(this.config.replayWindowMs);
    this.fanout = new BackendFanout(backends);
    this.events = new EventBus<GatewayRuntimeEvent>(this.config.eventLogSize);
    this.logger = options.logger ?? new StructuredGatewayLogger(this.config.eventLogSize);
    this.attackLearner = options.attackLearner ?? new AttackPatternLearner();
    this.baseline = options.baseline ?? new NetworkConditionBaseline();
    this.channels = new MultiChannelProcessor(options.channels ?? []);
    this.networkMap = options.networkMap ?? new NetworkMap(this.config.gatewayId);
    this.reachabilityProbe = options.reachabilityProbe ?? new NodeReachabilityProbe();
    this.registration =
      options.registrationPolicy === undefined
        ? undefined
        : new DeviceRegistrationService(options.registrationPolicy, (credential) =>
            this.credentials.upsert(credential),
          );
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
      this.observeEnvelopeNetwork(envelope);
      this.networkMap.observeEnvelope(envelope, this.config.networkSegments, event.timestamp);
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
      this.logger.append({
        type: 'INGRESS_ACCEPTED',
        deviceId: envelope.deviceId,
        transport: envelope.transport,
        message: 'Ingress accepted',
        attributes: { sequenceId: envelope.sequenceId, sourceProtocol: envelope.transport },
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
      const reason = error instanceof Error ? error.message : String(error);
      const attack = this.attackLearner.recordObservedRejection(
        reason,
        envelope.deviceId,
        envelope.transport,
      );
      this.logger.append({
        type: 'INGRESS_REJECTED',
        deviceId: envelope.deviceId,
        transport: envelope.transport,
        message: reason,
        attributes: { attackType: attack.type, sequenceId: envelope.sequenceId },
      });
      await this.events.publish({
        type: 'INGRESS_REJECTED',
        deviceId: envelope.deviceId,
        transport: envelope.transport,
        timestamp: new Date().toISOString(),
        reason,
      });
      throw error;
    }
  }

  /** Parses and ingests one multi-device channel frame. */
  public async ingestChannelFrame(
    channelId: string,
    frame: string | Buffer,
  ): Promise<readonly GatewayIngressResult[]> {
    const parsed = this.channels.parse(channelId, frame);
    const results: GatewayIngressResult[] = [];
    for (const envelope of parsed.envelopes) {
      results.push(await this.ingest(envelope));
    }
    return results;
  }

  /** Adds a channel definition at runtime for SDK and sidecar deployments. */
  public registerChannel(channel: GatewayChannelDefinition): void {
    this.channels.register(channel);
  }

  /** Registers a device and issues identity/certificate material. */
  public async registerDevice(request: DeviceRegistrationRequest): Promise<unknown> {
    if (this.registration === undefined) {
      throw new Error('Device registration service is not configured');
    }
    try {
      const result = await this.registration.register(request);
      this.logger.append({
        type: 'REGISTRATION_ACCEPTED',
        deviceId: request.deviceId,
        message: 'Device registration accepted',
        attributes: { profile: request.profile, authority: result.authority },
      });
      await this.events.publish({
        type: 'REGISTRATION_ACCEPTED',
        deviceId: request.deviceId,
        transport: 'registration',
        timestamp: new Date().toISOString(),
      });
      return result;
    } catch (error) {
      this.logger.append({
        type: 'REGISTRATION_REJECTED',
        deviceId: request.deviceId,
        message: error instanceof Error ? error.message : String(error),
        attributes: { profile: request.profile },
      });
      throw error;
    }
  }

  /** Observes a network condition sample and learns standalone baselines. */
  public observeNetworkCondition(observation: NetworkConditionObservation): unknown {
    const report = this.baseline.observe(observation);
    if (report.latencyDeviation || report.packetLossDeviation || report.reconnectDeviation) {
      this.logger.append({
        type: 'BASELINE_DEVIATION',
        message: 'Network baseline deviation detected',
        attributes: { ...report },
      });
    }
    return report;
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
      runMode: this.config.runMode,
      backendBinding: this.config.backendBinding,
      devices: this.discovery.list().length,
      pendingBackends: this.fanout.pendingCount(),
      replayTokens: this.replayGuard.tokenCount(),
      attacks: this.attackLearner.summaries().reduce((sum, item) => sum + item.count, 0),
      channels: this.channels.list().length,
      networkNodes: this.networkMap.snapshot().nodes.length,
      networkRoutes: this.networkMap.routeTable().length,
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

  /** Returns gateway logs for replay and diagnostics. */
  public logs(limit = 100): readonly unknown[] {
    return this.logger.query({ limit });
  }

  /** Replays retained gateway logs matching a query. */
  public replayLogs(
    query: Parameters<StructuredGatewayLogger['replay']>[0] = {},
  ): readonly unknown[] {
    return this.logger.replay(query);
  }

  /** Returns learned attack summaries. */
  public attackSummaries(): readonly unknown[] {
    return this.attackLearner.summaries();
  }

  /** Records a verified attack from an operator or external security service. */
  public recordVerifiedAttack(
    input: Parameters<AttackPatternLearner['recordVerifiedAttempt']>[0],
  ): unknown {
    const summary = this.attackLearner.recordVerifiedAttempt(input);
    this.logger.append({
      type: 'ATTACK_LEARNED',
      ...(input.deviceId === undefined ? {} : { deviceId: input.deviceId }),
      ...(input.transport === undefined ? {} : { transport: input.transport }),
      message: input.reason,
      attributes: { ...summary },
    });
    return summary;
  }

  /** Returns learned network baselines. */
  public baselineSnapshot(): Record<string, unknown> {
    return this.baseline.snapshot();
  }

  /** Lists configured channels. */
  public channelSummary(): readonly unknown[] {
    return this.channels.list();
  }

  /** Returns observed topology, links, and route table entries. */
  public networkTopology(): NetworkTopologySnapshot {
    return this.networkMap.snapshot();
  }

  /** Returns route table entries, optionally filtered by destination. */
  public routeTable(destination?: string): readonly unknown[] {
    return this.networkMap.routeTable(destination);
  }

  /** Probes node reachability and updates topology state. */
  public async probeReachability(target: ProbeTarget): Promise<ProbeResult> {
    const result = await this.reachabilityProbe.probe(target);
    this.networkMap.updateReachability(
      target.nodeId,
      result.reachable ? 'REACHABLE' : 'UNREACHABLE',
      result.observedAt,
    );
    this.logger.append({
      type: result.reachable ? 'INGRESS_ACCEPTED' : 'INGRESS_REJECTED',
      deviceId: target.nodeId,
      message: result.reachable ? 'Reachability probe succeeded' : 'Reachability probe failed',
      attributes: { ...result },
    });
    return result;
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

  private observeEnvelopeNetwork(envelope: UniversalIngressEnvelope): void {
    const metadata = envelope.metadata;
    if (metadata === undefined) {
      return;
    }
    const latencyMs = numberField(metadata.latencyMs);
    const packetLossRatio = numberField(metadata.packetLossRatio);
    const reconnects = numberField(metadata.reconnects);
    if (latencyMs === undefined || packetLossRatio === undefined || reconnects === undefined) {
      return;
    }
    this.observeNetworkCondition({
      key: `${metadata.segmentId ?? 'default'}:${envelope.transport}`,
      latencyMs,
      packetLossRatio,
      reconnects,
      observedAt: envelope.timestamp,
    });
  }
}

function numberField(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
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
