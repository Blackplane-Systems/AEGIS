import {
  getProtocolProfile,
  listProtocolProfiles,
  recommendedControlsForProtocols,
  type ProtocolProfile,
} from '../../protocol/src';
import type { NetworkIntelligenceSnapshot } from './network-intelligence';
import type { NetworkTopologySnapshot } from './network-map';
import type { EdgeTransport, GatewayConfig } from './types';

/** Readiness control area used for operational gap reporting. */
export type ReadinessArea =
  | 'IDENTITY'
  | 'TRANSPORT_SECURITY'
  | 'REPLAY'
  | 'SEGMENTATION'
  | 'PROTOCOL_COVERAGE'
  | 'NETWORK_INTELLIGENCE'
  | 'BACKEND_INTEGRATION'
  | 'OBSERVABILITY'
  | 'OPERATOR_ACCESS';

/** Result of one production-readiness check. */
export type ReadinessStatus = 'PASS' | 'WARN' | 'FAIL';

/** One deterministic readiness check produced from gateway configuration and learned state. */
export interface ReadinessCheck {
  readonly id: string;
  readonly area: ReadinessArea;
  readonly status: ReadinessStatus;
  readonly summary: string;
  readonly evidence: Record<string, unknown>;
  readonly remediation: readonly string[];
}

/** Readiness report suitable for dashboards, CI checks, and external backend integrations. */
export interface ReadinessReport {
  readonly generatedAt: string;
  readonly score: number;
  readonly mode: string;
  readonly runMode: string;
  readonly backendBinding: string;
  readonly supportedProtocols: readonly ProtocolProfile[];
  readonly recommendedControls: readonly string[];
  readonly checks: readonly ReadinessCheck[];
  readonly criticalGaps: readonly ReadinessCheck[];
  readonly warnings: readonly ReadinessCheck[];
}

const SCORE_PASS = 1;
const SCORE_WARN = 0.55;
const SCORE_FAIL = 0;
const OT_TRANSPORTS = new Set<EdgeTransport>([
  'modbus_tcp',
  'modbus_rtu',
  'opcua',
  'bacnet_ip',
  'can_bus',
  'dnp3',
  'profinet',
  'ethernet_ip',
]);

/** Evaluates a gateway deployment against production-oriented IoT, OT, and edge requirements. */
export class GatewayReadinessAdvisor {
  /** Builds a deterministic report from config, topology, and current intelligence findings. */
  public evaluate(
    config: GatewayConfig,
    topology?: NetworkTopologySnapshot,
    intelligence?: NetworkIntelligenceSnapshot,
    generatedAt = new Date().toISOString(),
  ): ReadinessReport {
    const checks = [
      this.identityCheck(config),
      this.operatorAccessCheck(config),
      this.transportSecurityCheck(config),
      this.replayCheck(config),
      this.segmentationCheck(config, topology),
      this.protocolCoverageCheck(config),
      this.networkIntelligenceCheck(config, intelligence),
      this.backendIntegrationCheck(config),
      this.observabilityCheck(config),
    ];
    const supportedProfiles = this.supportedProfiles(config);
    const score = weightedScore(checks);
    return {
      generatedAt,
      score,
      mode: config.mode,
      runMode: config.runMode,
      backendBinding: config.backendBinding,
      supportedProtocols: supportedProfiles,
      recommendedControls: recommendedControlsForProtocols(
        supportedProfiles.map((item) => item.id),
      ),
      checks,
      criticalGaps: checks.filter((check) => check.status === 'FAIL'),
      warnings: checks.filter((check) => check.status === 'WARN'),
    };
  }

  private identityCheck(config: GatewayConfig): ReadinessCheck {
    const hasCredentials = config.credentials.length > 0;
    return {
      id: 'identity.credentials',
      area: 'IDENTITY',
      status: hasCredentials ? 'PASS' : 'WARN',
      summary: hasCredentials
        ? 'device credential registry is configured'
        : 'no device credentials are configured; only explicitly allowed open ingress can work',
      evidence: { credentials: config.credentials.length },
      remediation: hasCredentials
        ? []
        : ['configure device credentials or enable a registration authority before production use'],
    };
  }

  private operatorAccessCheck(config: GatewayConfig): ReadinessCheck {
    const needsAdmin = config.ui.enabled || !config.publicHealth;
    const hasAdminToken = config.adminTokenSha256 !== undefined;
    return {
      id: 'operator.admin-token',
      area: 'OPERATOR_ACCESS',
      status: !needsAdmin || hasAdminToken ? 'PASS' : 'FAIL',
      summary:
        !needsAdmin || hasAdminToken
          ? 'operator API access has an admin token boundary'
          : 'operator APIs or UI are enabled without an admin token hash',
      evidence: { uiEnabled: config.ui.enabled, publicHealth: config.publicHealth, hasAdminToken },
      remediation:
        !needsAdmin || hasAdminToken
          ? []
          : ['set adminTokenSha256 or disable authenticated operator surfaces'],
    };
  }

  private transportSecurityCheck(config: GatewayConfig): ReadinessCheck {
    const otCredentials = config.credentials.filter((credential) =>
      credential.allowedTransports.some((transport) => OT_TRANSPORTS.has(transport)),
    );
    const plaintextOt = config.allowPlaintextFrom.filter((transport) =>
      OT_TRANSPORTS.has(transport),
    );
    const plaintextOpen = config.allowPlaintextFrom.length > 0;
    const status: ReadinessStatus =
      plaintextOt.length > 0
        ? 'FAIL'
        : plaintextOpen || otCredentials.length === 0
          ? 'WARN'
          : 'PASS';
    return {
      id: 'transport.security',
      area: 'TRANSPORT_SECURITY',
      status,
      summary:
        status === 'PASS'
          ? 'secure ingress modes are available for configured OT transports'
          : 'plaintext ingress is allowed and must be scoped before production use',
      evidence: {
        allowPlaintextFrom: config.allowPlaintextFrom,
        otCredentialCount: otCredentials.length,
        plaintextOt,
      },
      remediation:
        status === 'PASS'
          ? []
          : [
              'scope plaintext to local-only bridges',
              'prefer HMAC, Ed25519, AES-GCM, or mTLS boundaries',
            ],
    };
  }

  private replayCheck(config: GatewayConfig): ReadinessCheck {
    return {
      id: 'ingress.replay',
      area: 'REPLAY',
      status: config.requireNonceForSecureIngress && config.replayWindowMs > 0 ? 'PASS' : 'FAIL',
      summary:
        config.requireNonceForSecureIngress && config.replayWindowMs > 0
          ? 'secure ingress requires nonce and replay-window validation'
          : 'secure ingress replay controls are incomplete',
      evidence: {
        requireNonceForSecureIngress: config.requireNonceForSecureIngress,
        replayWindowMs: config.replayWindowMs,
      },
      remediation:
        config.requireNonceForSecureIngress && config.replayWindowMs > 0
          ? []
          : ['require nonces for secure ingress and keep a bounded replay window'],
    };
  }

  private segmentationCheck(
    config: GatewayConfig,
    topology: NetworkTopologySnapshot | undefined,
  ): ReadinessCheck {
    const hasSegment = config.networkSegments.length > 0;
    const unrestricted = config.networkSegments.filter(
      (segment) => segment.allowCloudEgress && segment.allowPeerForwarding,
    );
    const status: ReadinessStatus = !hasSegment
      ? 'FAIL'
      : unrestricted.length > 0
        ? 'WARN'
        : 'PASS';
    return {
      id: 'network.segmentation',
      area: 'SEGMENTATION',
      status,
      summary:
        status === 'PASS'
          ? 'network segments have explicit egress and peer-forwarding controls'
          : 'one or more network segments are too broad for high-assurance deployments',
      evidence: {
        configuredSegments: config.networkSegments.length,
        unrestrictedSegments: unrestricted.map((segment) => segment.id),
        observedNodes: topology?.nodes.length ?? 0,
      },
      remediation:
        status === 'PASS'
          ? []
          : [
              'separate local LAN, OT fieldbus, DMZ, and cloud segments with explicit forwarding rules',
            ],
    };
  }

  private protocolCoverageCheck(config: GatewayConfig): ReadinessCheck {
    const transports = new Set(
      config.credentials.flatMap((credential) => credential.allowedTransports),
    );
    for (const transport of config.allowPlaintextFrom) {
      transports.add(transport);
    }
    const uncovered = [...transports].filter(
      (transport) => protocolForTransport(transport) === undefined,
    );
    return {
      id: 'protocol.coverage',
      area: 'PROTOCOL_COVERAGE',
      status: uncovered.length === 0 ? 'PASS' : 'WARN',
      summary:
        uncovered.length === 0
          ? 'configured transports map to known protocol profiles'
          : 'some transports have no protocol profile and will use generic handling',
      evidence: { transports: [...transports].sort(), uncovered },
      remediation:
        uncovered.length === 0
          ? []
          : ['add protocol profiles before enabling generic transports at scale'],
    };
  }

  private networkIntelligenceCheck(
    config: GatewayConfig,
    intelligence: NetworkIntelligenceSnapshot | undefined,
  ): ReadinessCheck {
    const highFindings =
      intelligence?.findings.filter(
        (finding) => finding.severity === 'HIGH' || finding.severity === 'CRITICAL',
      ) ?? [];
    const status: ReadinessStatus = !config.networkIntelligence.enabled
      ? 'WARN'
      : highFindings.length > 0
        ? 'WARN'
        : 'PASS';
    return {
      id: 'network.intelligence',
      area: 'NETWORK_INTELLIGENCE',
      status,
      summary:
        status === 'PASS'
          ? 'adaptive network intelligence is enabled with no high-severity current findings'
          : 'network intelligence is disabled or reporting high-severity findings',
      evidence: {
        enabled: config.networkIntelligence.enabled,
        mode: config.networkIntelligence.mode,
        highFindings: highFindings.map((finding) => finding.type),
      },
      remediation:
        status === 'PASS'
          ? []
          : ['enable network intelligence and resolve high-severity blockers before remote fanout'],
    };
  }

  private backendIntegrationCheck(config: GatewayConfig): ReadinessCheck {
    return {
      id: 'backend.binding',
      area: 'BACKEND_INTEGRATION',
      status: config.mode === 'LOCAL_ONLY' || config.backendBinding === 'TIGHT' ? 'PASS' : 'WARN',
      summary:
        config.mode === 'LOCAL_ONLY' || config.backendBinding === 'TIGHT'
          ? 'backend binding matches the selected deployment mode'
          : 'loose backend binding is flexible but should define delivery guarantees externally',
      evidence: {
        mode: config.mode,
        runMode: config.runMode,
        backendBinding: config.backendBinding,
      },
      remediation:
        config.mode === 'LOCAL_ONLY' || config.backendBinding === 'TIGHT'
          ? []
          : ['document idempotency, retry, and ordering semantics for external backend connectors'],
    };
  }

  private observabilityCheck(config: GatewayConfig): ReadinessCheck {
    return {
      id: 'observability.retention',
      area: 'OBSERVABILITY',
      status: config.eventLogSize >= 500 ? 'PASS' : 'WARN',
      summary:
        config.eventLogSize >= 500
          ? 'gateway event retention is sufficient for routine diagnostics'
          : 'gateway event retention may be too small for replay and incident review',
      evidence: { eventLogSize: config.eventLogSize },
      remediation:
        config.eventLogSize >= 500 ? [] : ['increase eventLogSize for production replay workflows'],
    };
  }

  private supportedProfiles(config: GatewayConfig): readonly ProtocolProfile[] {
    const ids = new Set<string>();
    for (const credential of config.credentials) {
      for (const transport of credential.allowedTransports) {
        const profile = protocolForTransport(transport);
        if (profile !== undefined) {
          ids.add(profile.id);
        }
      }
    }
    for (const transport of config.allowPlaintextFrom) {
      const profile = protocolForTransport(transport);
      if (profile !== undefined) {
        ids.add(profile.id);
      }
    }
    if (ids.size === 0) {
      return listProtocolProfiles().filter((profile) =>
        ['mqtt', 'coap', 'modbus_tcp', 'opcua_pubsub', 'bacnet_ip'].includes(profile.id),
      );
    }
    return [...ids]
      .map((id) => getProtocolProfile(id))
      .filter((profile): profile is ProtocolProfile => profile !== undefined)
      .sort((left, right) => left.displayName.localeCompare(right.displayName));
  }
}

function protocolForTransport(transport: EdgeTransport): ProtocolProfile | undefined {
  const map: Partial<Record<EdgeTransport, string>> = {
    wifi_http: 'http_webhook',
    mqtt: 'mqtt',
    websocket: 'websocket',
    broadcast_udp: 'coap',
    coap: 'coap',
    modbus_tcp: 'modbus_tcp',
    modbus_rtu: 'modbus_rtu',
    opcua: 'opcua_pubsub',
    bacnet_ip: 'bacnet_ip',
    can_bus: 'can_bus',
    zigbee: 'zigbee',
    dnp3: 'dnp3',
    profinet: 'profinet',
    ethernet_ip: 'ethernet_ip',
    lora: 'coap',
    esp_now: 'coap',
    ble: 'coap',
    serial: 'modbus_rtu',
  };
  const id = map[transport];
  return id === undefined ? undefined : getProtocolProfile(id);
}

function weightedScore(checks: readonly ReadinessCheck[]): number {
  if (checks.length === 0) {
    return 0;
  }
  const total = checks.reduce((sum, check) => {
    if (check.status === 'PASS') {
      return sum + SCORE_PASS;
    }
    if (check.status === 'WARN') {
      return sum + SCORE_WARN;
    }
    return sum + SCORE_FAIL;
  }, 0);
  return Number((total / checks.length).toFixed(3));
}
