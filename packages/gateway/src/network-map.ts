import { connect } from 'node:net';
import { EdgeTransport, NetworkSegmentConfig, UniversalIngressEnvelope } from './types';

/** Node categories represented in the gateway network map. */
export type NetworkNodeKind =
  | 'GATEWAY'
  | 'DEVICE'
  | 'BACKEND'
  | 'LAN_SEGMENT'
  | 'CLOUD'
  | 'SERIAL_BUS'
  | 'MESH';

/** Link categories represented in the gateway network map. */
export type NetworkLinkKind =
  | 'WIFI'
  | 'MQTT'
  | 'HTTP'
  | 'BLE'
  | 'LORA'
  | 'SERIAL'
  | 'ESP_NOW'
  | 'WEBSOCKET'
  | 'BROADCAST'
  | 'COAP'
  | 'MODBUS'
  | 'OPCUA'
  | 'BACNET'
  | 'CAN'
  | 'ZIGBEE'
  | 'DNP3'
  | 'PROFINET'
  | 'ETHERNET_IP'
  | 'BACKEND'
  | 'UNKNOWN';

/** Routing or forwarding protocol inferred from metadata, route tables, or transport type. */
export type RoutingProtocol =
  | 'STATIC'
  | 'BGP'
  | 'OSPF'
  | 'RIP'
  | 'MESH'
  | 'MQTT_BROKER'
  | 'LORA_GATEWAY'
  | 'ESP_NOW_PEER'
  | 'SERIAL_MULTIPLEX'
  | 'COAP_PROXY'
  | 'MODBUS_GATEWAY'
  | 'OPCUA_SERVER'
  | 'BACNET_ROUTER'
  | 'CAN_GATEWAY'
  | 'ZIGBEE_COORDINATOR'
  | 'DNP3_OUTSTATION'
  | 'PROFINET_IO'
  | 'ETHERNET_IP_CIP'
  | 'UNKNOWN';

/** Reachability state for a node or route target. */
export type ReachabilityState = 'UNKNOWN' | 'REACHABLE' | 'DEGRADED' | 'UNREACHABLE';

/** Network node retained by the gateway topology map. */
export interface NetworkNode {
  readonly id: string;
  readonly kind: NetworkNodeKind;
  readonly label?: string;
  readonly segmentId?: string;
  readonly addresses?: readonly string[];
  readonly reachability: ReachabilityState;
  readonly lastSeen?: string;
  readonly metadata?: Record<string, unknown>;
}

/** Observed directed network link. */
export interface NetworkLink {
  readonly id: string;
  readonly from: string;
  readonly to: string;
  readonly kind: NetworkLinkKind;
  readonly routingProtocol: RoutingProtocol;
  readonly cost: number;
  readonly lastObserved: string;
  readonly metadata?: Record<string, unknown>;
}

/** Gateway route table entry. */
export interface RouteEntry {
  readonly destination: string;
  readonly nextHop: string;
  readonly interfaceId?: string;
  readonly protocol: RoutingProtocol;
  readonly metric: number;
  readonly lastUpdated: string;
  readonly source?: string;
}

/** Serializable topology snapshot. */
export interface NetworkTopologySnapshot {
  readonly gatewayId: string;
  readonly nodes: readonly NetworkNode[];
  readonly links: readonly NetworkLink[];
  readonly routes: readonly RouteEntry[];
}

/** Probe protocols supported by the gateway reachability interface. */
export type ProbeProtocol = 'TCP' | 'HTTP' | 'APP_HEARTBEAT';

/** Reachability probe target. */
export interface ProbeTarget {
  readonly nodeId: string;
  readonly address: string;
  readonly protocol: ProbeProtocol;
  readonly port?: number;
  readonly path?: string;
  readonly timeoutMs?: number;
}

/** Reachability probe result. */
export interface ProbeResult {
  readonly target: ProbeTarget;
  readonly reachable: boolean;
  readonly latencyMs?: number;
  readonly observedAt: string;
  readonly error?: string;
}

/** Pluggable reachability probe used by production and tests. */
export interface ReachabilityProbe {
  probe(target: ProbeTarget): Promise<ProbeResult>;
}

/** Deterministic reachability probe for tests, simulations, and offline policies. */
export class StaticReachabilityProbe implements ReachabilityProbe {
  private readonly results = new Map<string, Omit<ProbeResult, 'target' | 'observedAt'>>();

  public set(nodeId: string, result: Omit<ProbeResult, 'target' | 'observedAt'>): void {
    this.results.set(nodeId, result);
  }

  public async probe(target: ProbeTarget): Promise<ProbeResult> {
    const result = this.results.get(target.nodeId) ?? {
      reachable: false,
      error: 'no static probe result',
    };
    return {
      target,
      reachable: result.reachable,
      ...(result.latencyMs === undefined ? {} : { latencyMs: result.latencyMs }),
      observedAt: new Date().toISOString(),
      ...(result.error === undefined ? {} : { error: result.error }),
    };
  }
}

/** Dependency-free TCP/HTTP reachability probe for standalone gateway deployments. */
export class NodeReachabilityProbe implements ReachabilityProbe {
  public async probe(target: ProbeTarget): Promise<ProbeResult> {
    if (target.protocol === 'HTTP' || target.protocol === 'APP_HEARTBEAT') {
      return this.httpProbe(target);
    }
    return this.tcpProbe(target);
  }

  private async httpProbe(target: ProbeTarget): Promise<ProbeResult> {
    const started = Date.now();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), target.timeoutMs ?? 1_000);
    try {
      const url = target.address.startsWith('http')
        ? target.address
        : `http://${target.address}${target.port === undefined ? '' : `:${target.port}`}${target.path ?? '/'}`;
      const response = await fetch(url, { method: 'GET', signal: controller.signal });
      return {
        target,
        reachable: response.ok,
        latencyMs: Date.now() - started,
        observedAt: new Date().toISOString(),
        ...(response.ok ? {} : { error: `HTTP ${response.status}` }),
      };
    } catch (error) {
      return {
        target,
        reachable: false,
        latencyMs: Date.now() - started,
        observedAt: new Date().toISOString(),
        error: error instanceof Error ? error.message : String(error),
      };
    } finally {
      clearTimeout(timeout);
    }
  }

  private async tcpProbe(target: ProbeTarget): Promise<ProbeResult> {
    const started = Date.now();
    return new Promise((resolve) => {
      const socket = connect({ host: target.address, port: target.port ?? 80 });
      const timeout = setTimeout(() => {
        socket.destroy();
        resolve({
          target,
          reachable: false,
          latencyMs: Date.now() - started,
          observedAt: new Date().toISOString(),
          error: 'timeout',
        });
      }, target.timeoutMs ?? 1_000);
      socket.once('connect', () => {
        clearTimeout(timeout);
        socket.destroy();
        resolve({
          target,
          reachable: true,
          latencyMs: Date.now() - started,
          observedAt: new Date().toISOString(),
        });
      });
      socket.once('error', (error) => {
        clearTimeout(timeout);
        resolve({
          target,
          reachable: false,
          latencyMs: Date.now() - started,
          observedAt: new Date().toISOString(),
          error: error.message,
        });
      });
    });
  }
}

/** Maintains observed topology, reachability, and route table state for the gateway. */
export class NetworkMap {
  private readonly nodes = new Map<string, NetworkNode>();
  private readonly links = new Map<string, NetworkLink>();
  private readonly routes = new Map<string, RouteEntry>();

  public constructor(private readonly gatewayId: string) {
    this.observeNode({ id: gatewayId, kind: 'GATEWAY', reachability: 'REACHABLE' });
  }

  /** Inserts or updates a network node. */
  public observeNode(
    node: Omit<NetworkNode, 'reachability'> & { readonly reachability?: ReachabilityState },
  ): NetworkNode {
    const current = this.nodes.get(node.id);
    const label = node.label ?? current?.label;
    const segmentId = node.segmentId ?? current?.segmentId;
    const addresses = node.addresses ?? current?.addresses;
    const lastSeen = node.lastSeen ?? current?.lastSeen;
    const merged: NetworkNode = {
      id: node.id,
      kind: node.kind,
      reachability: node.reachability ?? current?.reachability ?? 'UNKNOWN',
      ...(label === undefined ? {} : { label }),
      ...(segmentId === undefined ? {} : { segmentId }),
      ...(addresses === undefined ? {} : { addresses }),
      ...(lastSeen === undefined ? {} : { lastSeen }),
      metadata: { ...(current?.metadata ?? {}), ...(node.metadata ?? {}) },
    };
    this.nodes.set(node.id, merged);
    return merged;
  }

  /** Inserts or updates an observed link. */
  public observeLink(link: NetworkLink): NetworkLink {
    this.links.set(link.id, link);
    return link;
  }

  /** Inserts or updates one route table entry. */
  public upsertRoute(route: RouteEntry): RouteEntry {
    this.routes.set(`${route.destination}:${route.nextHop}:${route.protocol}`, route);
    return route;
  }

  /** Updates reachability for a node from a probe or ingress observation. */
  public updateReachability(
    nodeId: string,
    state: ReachabilityState,
    observedAt = new Date().toISOString(),
  ): void {
    const current = this.nodes.get(nodeId);
    this.observeNode({
      id: nodeId,
      kind: current?.kind ?? 'DEVICE',
      reachability: state,
      lastSeen: observedAt,
      ...(current?.segmentId === undefined ? {} : { segmentId: current.segmentId }),
      ...(current?.addresses === undefined ? {} : { addresses: current.addresses }),
      ...(current?.metadata === undefined ? {} : { metadata: current.metadata }),
    });
  }

  /** Updates topology and route table from an accepted device envelope. */
  public observeEnvelope(
    envelope: UniversalIngressEnvelope,
    segments: readonly NetworkSegmentConfig[],
    observedAt: string,
  ): void {
    const segmentId = stringMetadata(envelope.metadata?.segmentId) ?? 'local';
    const segment = segments.find((candidate) => candidate.id === segmentId);
    this.observeNode({
      id: segmentId,
      kind: segmentKind(segment),
      label: segment?.description ?? segmentId,
      reachability: 'REACHABLE',
      lastSeen: observedAt,
    });
    const addresses = addressesFromMetadata(envelope.metadata);
    this.observeNode({
      id: envelope.deviceId,
      kind: 'DEVICE',
      segmentId,
      ...(addresses === undefined ? {} : { addresses }),
      reachability: 'REACHABLE',
      lastSeen: observedAt,
      ...(envelope.metadata === undefined ? {} : { metadata: envelope.metadata }),
    });
    const protocol = identifyRoutingProtocol(envelope.transport, envelope.metadata);
    const linkKind = linkKindFromTransport(envelope.transport);
    this.observeLink({
      id: `${segmentId}:${envelope.deviceId}:${envelope.transport}`,
      from: segmentId,
      to: envelope.deviceId,
      kind: linkKind,
      routingProtocol: protocol,
      cost: numberMetadata(envelope.metadata?.routeCost) ?? defaultCost(linkKind),
      lastObserved: observedAt,
      ...(envelope.metadata === undefined ? {} : { metadata: envelope.metadata }),
    });
    this.upsertRoute({
      destination: envelope.deviceId,
      nextHop: segmentId,
      interfaceId: stringMetadata(envelope.metadata?.interfaceId) ?? envelope.transport,
      protocol,
      metric: numberMetadata(envelope.metadata?.routeMetric) ?? defaultCost(linkKind),
      lastUpdated: observedAt,
      source: 'ingress_observation',
    });
    this.observeAggregatorPayloads(envelope, segmentId, protocol, linkKind, observedAt);
  }

  /** Returns a deterministic topology snapshot. */
  public snapshot(): NetworkTopologySnapshot {
    return {
      gatewayId: this.gatewayId,
      nodes: [...this.nodes.values()].sort((left, right) => left.id.localeCompare(right.id)),
      links: [...this.links.values()].sort((left, right) => left.id.localeCompare(right.id)),
      routes: [...this.routes.values()].sort((left, right) =>
        `${left.destination}:${left.nextHop}`.localeCompare(
          `${right.destination}:${right.nextHop}`,
        ),
      ),
    };
  }

  /** Returns route entries, optionally narrowed to one destination. */
  public routeTable(destination?: string): readonly RouteEntry[] {
    const routes = [...this.routes.values()];
    return routes
      .filter((route) => destination === undefined || route.destination === destination)
      .sort((left, right) => left.metric - right.metric);
  }

  /** Returns neighboring nodes for a topology node. */
  public neighbors(nodeId: string): readonly NetworkNode[] {
    const ids = new Set(
      [...this.links.values()]
        .filter((link) => link.from === nodeId || link.to === nodeId)
        .map((link) => (link.from === nodeId ? link.to : link.from)),
    );
    return [...ids]
      .map((id) => this.nodes.get(id))
      .filter((node): node is NetworkNode => node !== undefined)
      .sort((left, right) => left.id.localeCompare(right.id));
  }

  private observeAggregatorPayloads(
    envelope: UniversalIngressEnvelope,
    segmentId: string,
    protocol: RoutingProtocol,
    linkKind: NetworkLinkKind,
    observedAt: string,
  ): void {
    const aggregatorId =
      stringMetadata(envelope.metadata?.aggregatorId ?? envelope.metadata?.gatewayDeviceId) ??
      (arrayMetadata(envelope.metadata?.embeddedDeviceIds).length > 0
        ? envelope.deviceId
        : undefined);
    const embeddedDeviceIds = arrayMetadata(
      envelope.metadata?.embeddedDeviceIds ?? envelope.metadata?.devices,
    );
    if (aggregatorId === undefined || embeddedDeviceIds.length === 0) {
      return;
    }
    this.observeNode({
      id: aggregatorId,
      kind: 'DEVICE',
      segmentId,
      reachability: 'REACHABLE',
      lastSeen: observedAt,
      metadata: { role: 'AGGREGATOR', transport: envelope.transport },
    });
    this.observeLink({
      id: `${segmentId}:${aggregatorId}:${envelope.transport}:aggregator`,
      from: segmentId,
      to: aggregatorId,
      kind: linkKind,
      routingProtocol: protocol,
      cost: numberMetadata(envelope.metadata?.routeCost) ?? defaultCost(linkKind),
      lastObserved: observedAt,
      metadata: { role: 'AGGREGATOR_UPLINK' },
    });
    for (const embeddedDeviceId of embeddedDeviceIds) {
      this.observeNode({
        id: embeddedDeviceId,
        kind: 'DEVICE',
        segmentId,
        reachability: 'REACHABLE',
        lastSeen: observedAt,
        metadata: { viaAggregator: aggregatorId },
      });
      this.observeLink({
        id: `${aggregatorId}:${embeddedDeviceId}:embedded`,
        from: aggregatorId,
        to: embeddedDeviceId,
        kind: 'SERIAL',
        routingProtocol: 'SERIAL_MULTIPLEX',
        cost: defaultCost('SERIAL'),
        lastObserved: observedAt,
        metadata: { role: 'EMBEDDED_PAYLOAD' },
      });
      this.upsertRoute({
        destination: embeddedDeviceId,
        nextHop: aggregatorId,
        interfaceId: stringMetadata(envelope.metadata?.interfaceId) ?? envelope.transport,
        protocol: 'SERIAL_MULTIPLEX',
        metric: numberMetadata(envelope.metadata?.routeMetric) ?? defaultCost('SERIAL'),
        lastUpdated: observedAt,
        source: 'aggregator_payload',
      });
    }
  }
}

/** Identifies routing or forwarding protocol from explicit metadata and transport defaults. */
export function identifyRoutingProtocol(
  transport: EdgeTransport,
  metadata: Record<string, unknown> | undefined,
): RoutingProtocol {
  const explicit = stringMetadata(metadata?.routingProtocol)?.toUpperCase();
  if (
    explicit === 'STATIC' ||
    explicit === 'BGP' ||
    explicit === 'OSPF' ||
    explicit === 'RIP' ||
    explicit === 'MESH' ||
    explicit === 'MQTT_BROKER' ||
    explicit === 'LORA_GATEWAY' ||
    explicit === 'ESP_NOW_PEER' ||
    explicit === 'SERIAL_MULTIPLEX' ||
    explicit === 'COAP_PROXY' ||
    explicit === 'MODBUS_GATEWAY' ||
    explicit === 'OPCUA_SERVER' ||
    explicit === 'BACNET_ROUTER' ||
    explicit === 'CAN_GATEWAY' ||
    explicit === 'ZIGBEE_COORDINATOR' ||
    explicit === 'DNP3_OUTSTATION' ||
    explicit === 'PROFINET_IO' ||
    explicit === 'ETHERNET_IP_CIP'
  ) {
    return explicit;
  }
  if (transport === 'mqtt') {
    return 'MQTT_BROKER';
  }
  if (transport === 'lora') {
    return 'LORA_GATEWAY';
  }
  if (transport === 'esp_now') {
    return 'ESP_NOW_PEER';
  }
  if (transport === 'serial') {
    return 'SERIAL_MULTIPLEX';
  }
  if (transport === 'coap') {
    return 'COAP_PROXY';
  }
  if (transport === 'modbus_tcp' || transport === 'modbus_rtu') {
    return 'MODBUS_GATEWAY';
  }
  if (transport === 'opcua') {
    return 'OPCUA_SERVER';
  }
  if (transport === 'bacnet_ip') {
    return 'BACNET_ROUTER';
  }
  if (transport === 'can_bus') {
    return 'CAN_GATEWAY';
  }
  if (transport === 'zigbee') {
    return 'ZIGBEE_COORDINATOR';
  }
  if (transport === 'dnp3') {
    return 'DNP3_OUTSTATION';
  }
  if (transport === 'profinet') {
    return 'PROFINET_IO';
  }
  if (transport === 'ethernet_ip') {
    return 'ETHERNET_IP_CIP';
  }
  if (transport === 'ble' || transport === 'broadcast_udp') {
    return 'MESH';
  }
  if (transport === 'wifi_http' || transport === 'websocket') {
    return 'STATIC';
  }
  return 'UNKNOWN';
}

function segmentKind(segment: NetworkSegmentConfig | undefined): NetworkNodeKind {
  if (segment?.kind === 'REMOTE_CLOUD') {
    return 'CLOUD';
  }
  if (segment?.kind === 'SERIAL_BUS') {
    return 'SERIAL_BUS';
  }
  if (segment?.kind === 'MESH') {
    return 'MESH';
  }
  return 'LAN_SEGMENT';
}

function linkKindFromTransport(transport: EdgeTransport): NetworkLinkKind {
  const map: Record<EdgeTransport, NetworkLinkKind> = {
    wifi_http: 'HTTP',
    mqtt: 'MQTT',
    esp_now: 'ESP_NOW',
    ble: 'BLE',
    lora: 'LORA',
    serial: 'SERIAL',
    websocket: 'WEBSOCKET',
    broadcast_udp: 'BROADCAST',
    coap: 'COAP',
    modbus_tcp: 'MODBUS',
    modbus_rtu: 'MODBUS',
    opcua: 'OPCUA',
    bacnet_ip: 'BACNET',
    can_bus: 'CAN',
    zigbee: 'ZIGBEE',
    dnp3: 'DNP3',
    profinet: 'PROFINET',
    ethernet_ip: 'ETHERNET_IP',
  };
  return map[transport];
}

function defaultCost(kind: NetworkLinkKind): number {
  if (kind === 'SERIAL' || kind === 'LORA' || kind === 'MODBUS' || kind === 'CAN') {
    return 20;
  }
  if (kind === 'BLE' || kind === 'ESP_NOW' || kind === 'ZIGBEE') {
    return 15;
  }
  if (kind === 'PROFINET' || kind === 'ETHERNET_IP') {
    return 5;
  }
  return 10;
}

function addressesFromMetadata(
  metadata: Record<string, unknown> | undefined,
): readonly string[] | undefined {
  const address = stringMetadata(metadata?.address ?? metadata?.ip ?? metadata?.mac);
  return address === undefined ? undefined : [address];
}

function stringMetadata(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function numberMetadata(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function arrayMetadata(value: unknown): readonly string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is string => typeof item === 'string' && item.length > 0);
}
