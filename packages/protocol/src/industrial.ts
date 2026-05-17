import { Reliability } from './types';

/** Protocol families used by AEGIS to describe heterogeneous edge and OT traffic. */
export type ProtocolFamily =
  | 'IOT_APPLICATION'
  | 'INDUSTRIAL_OT'
  | 'BUILDING_AUTOMATION'
  | 'FIELD_BUS'
  | 'WIRELESS_MESH'
  | 'NETWORK_CONTROL';

/** Direction normally expected for a protocol observation. */
export type ProtocolDirection =
  | 'DEVICE_TO_GATEWAY'
  | 'GATEWAY_TO_DEVICE'
  | 'PEER_TO_PEER'
  | 'CONTROL_PLANE';

/** Default security posture expected before deployment-specific policy is applied. */
export type ProtocolSecurityPosture =
  | 'PLAINTEXT_LEGACY'
  | 'LINK_LAYER_ONLY'
  | 'APPLICATION_SIGNED'
  | 'TRANSPORT_ENCRYPTED'
  | 'MUTUAL_AUTHENTICATED';

/** Operator-readable protocol profile used for readiness checks and adapter selection. */
export interface ProtocolProfile {
  readonly id: string;
  readonly displayName: string;
  readonly family: ProtocolFamily;
  readonly direction: ProtocolDirection;
  readonly reliability: Reliability;
  readonly defaultSecurity: ProtocolSecurityPosture;
  readonly typicalPorts: readonly number[];
  readonly canonicalCapability: string;
  readonly identityFields: readonly string[];
  readonly supportsBroadcast: boolean;
  readonly supportsCommand: boolean;
  readonly aggregatorFriendly: boolean;
  readonly operationalRisks: readonly string[];
  readonly recommendedControls: readonly string[];
}

/** Input used to classify a raw protocol observation before adapter selection. */
export interface ProtocolObservationInput {
  readonly transport?: string;
  readonly port?: number;
  readonly payload?: Record<string, unknown>;
  readonly metadata?: Record<string, unknown>;
}

/** Classification result for an observed edge or control-plane protocol. */
export interface ProtocolClassification {
  readonly profile: ProtocolProfile;
  readonly confidence: number;
  readonly evidence: readonly string[];
}

const HIGH_CONFIDENCE = 0.95;
const MEDIUM_CONFIDENCE = 0.72;
const LOW_CONFIDENCE = 0.45;

/** Public-safe protocol coverage across IoT, fieldbus, building automation, and OT networks. */
export const PROTOCOL_PROFILES: readonly ProtocolProfile[] = [
  {
    id: 'mqtt',
    displayName: 'MQTT',
    family: 'IOT_APPLICATION',
    direction: 'DEVICE_TO_GATEWAY',
    reliability: Reliability.AT_LEAST_ONCE,
    defaultSecurity: 'TRANSPORT_ENCRYPTED',
    typicalPorts: [1883, 8883],
    canonicalCapability: 'mqtt_message',
    identityFields: ['clientId', 'deviceId', 'topic'],
    supportsBroadcast: false,
    supportsCommand: true,
    aggregatorFriendly: true,
    operationalRisks: ['shared broker blast radius', 'retained command replay', 'weak topic ACLs'],
    recommendedControls: ['per-device credentials', 'topic allowlists', 'nonce or sequence checks'],
  },
  {
    id: 'http_webhook',
    displayName: 'HTTP Webhook',
    family: 'IOT_APPLICATION',
    direction: 'DEVICE_TO_GATEWAY',
    reliability: Reliability.AT_LEAST_ONCE,
    defaultSecurity: 'TRANSPORT_ENCRYPTED',
    typicalPorts: [80, 443, 8080, 8443],
    canonicalCapability: 'http_event',
    identityFields: ['deviceId', 'authorization', 'clientCertificate'],
    supportsBroadcast: false,
    supportsCommand: true,
    aggregatorFriendly: true,
    operationalRisks: ['missing idempotency keys', 'load balancer source ambiguity'],
    recommendedControls: ['request signatures', 'idempotency keys', 'body size limits'],
  },
  {
    id: 'websocket',
    displayName: 'WebSocket',
    family: 'IOT_APPLICATION',
    direction: 'PEER_TO_PEER',
    reliability: Reliability.AT_LEAST_ONCE,
    defaultSecurity: 'TRANSPORT_ENCRYPTED',
    typicalPorts: [80, 443],
    canonicalCapability: 'websocket_event',
    identityFields: ['deviceId', 'sessionId', 'authorization'],
    supportsBroadcast: false,
    supportsCommand: true,
    aggregatorFriendly: true,
    operationalRisks: ['long-lived session replay', 'backpressure collapse'],
    recommendedControls: [
      'session reauthentication',
      'bounded outbound queues',
      'heartbeat timeouts',
    ],
  },
  {
    id: 'coap',
    displayName: 'CoAP',
    family: 'IOT_APPLICATION',
    direction: 'DEVICE_TO_GATEWAY',
    reliability: Reliability.AT_LEAST_ONCE,
    defaultSecurity: 'TRANSPORT_ENCRYPTED',
    typicalPorts: [5683, 5684],
    canonicalCapability: 'coap_resource',
    identityFields: ['deviceId', 'endpoint', 'path'],
    supportsBroadcast: true,
    supportsCommand: true,
    aggregatorFriendly: true,
    operationalRisks: ['UDP amplification exposure', 'observe relation exhaustion'],
    recommendedControls: ['DTLS or OSCORE', 'method allowlists', 'rate limits per endpoint'],
  },
  {
    id: 'modbus_tcp',
    displayName: 'Modbus TCP',
    family: 'INDUSTRIAL_OT',
    direction: 'GATEWAY_TO_DEVICE',
    reliability: Reliability.AT_LEAST_ONCE,
    defaultSecurity: 'PLAINTEXT_LEGACY',
    typicalPorts: [502],
    canonicalCapability: 'modbus_registers',
    identityFields: ['unitId', 'slaveId', 'deviceId'],
    supportsBroadcast: false,
    supportsCommand: true,
    aggregatorFriendly: true,
    operationalRisks: [
      'unauthenticated writes',
      'function-code abuse',
      'flat PLC segment exposure',
    ],
    recommendedControls: ['read/write split policy', 'unit-id allowlists', 'OT segment isolation'],
  },
  {
    id: 'modbus_rtu',
    displayName: 'Modbus RTU',
    family: 'FIELD_BUS',
    direction: 'GATEWAY_TO_DEVICE',
    reliability: Reliability.AT_MOST_ONCE,
    defaultSecurity: 'LINK_LAYER_ONLY',
    typicalPorts: [],
    canonicalCapability: 'modbus_rtu_frame',
    identityFields: ['slaveId', 'deviceId'],
    supportsBroadcast: true,
    supportsCommand: true,
    aggregatorFriendly: true,
    operationalRisks: [
      'shared bus collisions',
      'broadcast write risk',
      'silent serial framing errors',
    ],
    recommendedControls: [
      'serial gateway identity',
      'frame length limits',
      'broadcast write denylist',
    ],
  },
  {
    id: 'opcua_pubsub',
    displayName: 'OPC UA PubSub',
    family: 'INDUSTRIAL_OT',
    direction: 'DEVICE_TO_GATEWAY',
    reliability: Reliability.AT_LEAST_ONCE,
    defaultSecurity: 'MUTUAL_AUTHENTICATED',
    typicalPorts: [4840],
    canonicalCapability: 'opcua_datavalue',
    identityFields: ['nodeId', 'deviceId', 'publisherId'],
    supportsBroadcast: true,
    supportsCommand: true,
    aggregatorFriendly: true,
    operationalRisks: ['namespace confusion', 'publisher impersonation', 'stale data value reuse'],
    recommendedControls: [
      'application instance certificates',
      'namespace allowlists',
      'freshness gates',
    ],
  },
  {
    id: 'bacnet_ip',
    displayName: 'BACnet/IP',
    family: 'BUILDING_AUTOMATION',
    direction: 'PEER_TO_PEER',
    reliability: Reliability.AT_MOST_ONCE,
    defaultSecurity: 'PLAINTEXT_LEGACY',
    typicalPorts: [47808],
    canonicalCapability: 'bacnet_object',
    identityFields: ['deviceInstance', 'objectId', 'deviceId'],
    supportsBroadcast: true,
    supportsCommand: true,
    aggregatorFriendly: true,
    operationalRisks: ['Who-Is broadcast noise', 'unauthenticated property writes'],
    recommendedControls: ['BBMD scoping', 'write-property policy', 'network segmentation'],
  },
  {
    id: 'dnp3',
    displayName: 'DNP3',
    family: 'INDUSTRIAL_OT',
    direction: 'GATEWAY_TO_DEVICE',
    reliability: Reliability.AT_LEAST_ONCE,
    defaultSecurity: 'APPLICATION_SIGNED',
    typicalPorts: [20000],
    canonicalCapability: 'dnp3_point',
    identityFields: ['outstation', 'deviceId', 'pointIndex'],
    supportsBroadcast: false,
    supportsCommand: true,
    aggregatorFriendly: true,
    operationalRisks: ['unsolicited response storms', 'control relay risk'],
    recommendedControls: [
      'secure authentication',
      'select-before-operate enforcement',
      'outstation allowlists',
    ],
  },
  {
    id: 'can_bus',
    displayName: 'CAN Bus',
    family: 'FIELD_BUS',
    direction: 'PEER_TO_PEER',
    reliability: Reliability.AT_MOST_ONCE,
    defaultSecurity: 'LINK_LAYER_ONLY',
    typicalPorts: [],
    canonicalCapability: 'can_frame',
    identityFields: ['arbitrationId', 'deviceId', 'sourceAddress'],
    supportsBroadcast: true,
    supportsCommand: true,
    aggregatorFriendly: true,
    operationalRisks: ['identifier spoofing', 'bus saturation', 'no native origin authentication'],
    recommendedControls: [
      'gateway mediation',
      'identifier allowlists',
      'rate and payload shape limits',
    ],
  },
  {
    id: 'zigbee',
    displayName: 'Zigbee',
    family: 'WIRELESS_MESH',
    direction: 'PEER_TO_PEER',
    reliability: Reliability.AT_LEAST_ONCE,
    defaultSecurity: 'LINK_LAYER_ONLY',
    typicalPorts: [],
    canonicalCapability: 'zigbee_cluster',
    identityFields: ['ieeeAddress', 'networkAddress', 'deviceId'],
    supportsBroadcast: true,
    supportsCommand: true,
    aggregatorFriendly: true,
    operationalRisks: ['weak commissioning', 'mesh route churn', 'coordinator compromise'],
    recommendedControls: [
      'install-code commissioning',
      'coordinator hardening',
      'cluster allowlists',
    ],
  },
  {
    id: 'profinet',
    displayName: 'PROFINET',
    family: 'INDUSTRIAL_OT',
    direction: 'PEER_TO_PEER',
    reliability: Reliability.AT_LEAST_ONCE,
    defaultSecurity: 'PLAINTEXT_LEGACY',
    typicalPorts: [],
    canonicalCapability: 'profinet_io',
    identityFields: ['stationName', 'deviceId', 'mac'],
    supportsBroadcast: true,
    supportsCommand: true,
    aggregatorFriendly: false,
    operationalRisks: ['DCP naming abuse', 'real-time traffic disruption'],
    recommendedControls: [
      'cell-zone segmentation',
      'engineering-station allowlists',
      'passive monitoring',
    ],
  },
  {
    id: 'ethernet_ip',
    displayName: 'EtherNet/IP',
    family: 'INDUSTRIAL_OT',
    direction: 'PEER_TO_PEER',
    reliability: Reliability.AT_LEAST_ONCE,
    defaultSecurity: 'PLAINTEXT_LEGACY',
    typicalPorts: [44818, 2222],
    canonicalCapability: 'cip_object',
    identityFields: ['deviceId', 'vendorId', 'serialNumber'],
    supportsBroadcast: true,
    supportsCommand: true,
    aggregatorFriendly: true,
    operationalRisks: ['implicit messaging overload', 'unauthorized CIP writes'],
    recommendedControls: [
      'CIP service allowlists',
      'rate controls',
      'controller-cell segmentation',
    ],
  },
  {
    id: 'network_control',
    displayName: 'Network Control Plane',
    family: 'NETWORK_CONTROL',
    direction: 'CONTROL_PLANE',
    reliability: Reliability.AT_MOST_ONCE,
    defaultSecurity: 'PLAINTEXT_LEGACY',
    typicalPorts: [67, 68, 546, 547, 520, 179],
    canonicalCapability: 'network_control_observation',
    identityFields: ['sourceAddress', 'deviceId', 'interfaceId'],
    supportsBroadcast: true,
    supportsCommand: false,
    aggregatorFriendly: false,
    operationalRisks: ['rogue address assignment', 'route churn', 'multicast listener abuse'],
    recommendedControls: ['passive observation', 'operator redaction', 'segment-scoped retention'],
  },
];

/** Returns every built-in protocol profile sorted by display name. */
export function listProtocolProfiles(): readonly ProtocolProfile[] {
  return [...PROTOCOL_PROFILES].sort((left, right) =>
    left.displayName.localeCompare(right.displayName),
  );
}

/** Looks up one built-in protocol profile by id or display name. */
export function getProtocolProfile(id: string): ProtocolProfile | undefined {
  const normalized = normalizeProtocolId(id);
  return PROTOCOL_PROFILES.find(
    (profile) =>
      profile.id === normalized || normalizeProtocolId(profile.displayName) === normalized,
  );
}

/** Aggregates recommended controls for a set of protocols without duplicating text. */
export function recommendedControlsForProtocols(ids: readonly string[]): readonly string[] {
  const controls = new Set<string>();
  for (const id of ids) {
    const profile = getProtocolProfile(id);
    for (const control of profile?.recommendedControls ?? []) {
      controls.add(control);
    }
  }
  return [...controls].sort();
}

/** Classifies a protocol observation from transport, port, payload, and metadata hints. */
export function classifyProtocolObservation(
  input: ProtocolObservationInput,
): ProtocolClassification | undefined {
  const evidence: string[] = [];
  const hints = [
    input.transport,
    stringValue(input.metadata?.protocol),
    stringValue(input.metadata?.applicationProtocol),
    stringValue(input.payload?.protocol),
  ]
    .filter((item): item is string => item !== undefined)
    .map(normalizeProtocolId);
  for (const hint of hints) {
    const profile = getProtocolProfile(hint);
    if (profile !== undefined) {
      evidence.push(`protocol hint ${hint}`);
      return { profile, confidence: HIGH_CONFIDENCE, evidence };
    }
  }
  if (input.port !== undefined) {
    const profile = PROTOCOL_PROFILES.find((candidate) =>
      candidate.typicalPorts.includes(input.port!),
    );
    if (profile !== undefined) {
      evidence.push(`well-known port ${input.port}`);
      return { profile, confidence: MEDIUM_CONFIDENCE, evidence };
    }
  }
  const payload = input.payload ?? {};
  if (payload.unitId !== undefined || payload.functionCode !== undefined) {
    const profile = getProtocolProfile('modbus_tcp')!;
    return { profile, confidence: MEDIUM_CONFIDENCE, evidence: ['modbus register fields'] };
  }
  if (payload.arbitrationId !== undefined || payload.canId !== undefined) {
    const profile = getProtocolProfile('can_bus')!;
    return { profile, confidence: MEDIUM_CONFIDENCE, evidence: ['CAN arbitration identifier'] };
  }
  if (payload.objectId !== undefined || payload.deviceInstance !== undefined) {
    const profile = getProtocolProfile('bacnet_ip')!;
    return { profile, confidence: LOW_CONFIDENCE, evidence: ['BACnet object identity fields'] };
  }
  return undefined;
}

/** Normalizes protocol ids from operator input, payload hints, and route metadata. */
export function normalizeProtocolId(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[\s/-]+/g, '_')
    .replace(/^opcua$/, 'opcua_pubsub')
    .replace(/^opc_ua$/, 'opcua_pubsub')
    .replace(/^bacnet$/, 'bacnet_ip')
    .replace(/^ethernetip$/, 'ethernet_ip')
    .replace(/^modbus$/, 'modbus_tcp');
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}
