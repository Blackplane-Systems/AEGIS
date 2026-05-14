import { CanonicalEvent } from '../../protocol/src';

/** Physical or logical ingress transport used by edge devices and gateways. */
export type EdgeTransport =
  | 'wifi_http'
  | 'mqtt'
  | 'esp_now'
  | 'ble'
  | 'lora'
  | 'serial'
  | 'websocket'
  | 'broadcast_udp';

/** Common device profiles used to derive conservative transport/security defaults. */
export type DeviceProfile =
  | 'RASPBERRY_PI'
  | 'ESP32'
  | 'ESP8266'
  | 'ARDUINO'
  | 'LORA_NODE'
  | 'GENERIC_GATEWAY';

/** Ingress security mode declared by an edge message envelope. */
export type IngressSecurityMode = 'OPEN_BROADCAST' | 'HMAC_SHA256' | 'ED25519' | 'AES_256_GCM';

/** Operator deployment mode for a gateway process. */
export type GatewayMode = 'LOCAL_ONLY' | 'HYBRID' | 'REMOTE_MANAGEMENT';

/** How AEGIS is hosted relative to the calling application or cloud platform. */
export type AegisRunMode =
  | 'SDK_EMBEDDED'
  | 'STANDALONE_PROCESS'
  | 'SIDECAR_PROCESS'
  | 'CLOUD_CONTROL_PLANE'
  | 'LOCAL_LAN_ONLY'
  | 'MULTI_LAN_BRIDGE';

/** Binding strength between AEGIS and an upstream application backend. */
export type BackendBindingMode = 'LOOSE' | 'TIGHT';

/** Registration authority used during first-time device enrollment. */
export type RegistrationAuthority = 'AEGIS_LOCAL' | 'EXTERNAL_AUTHORITY' | 'FEDERATED';

/** High-level event class used for risk checks before runtime processing. */
export type IngressEventKind =
  | 'TELEMETRY'
  | 'SENSOR_EVENT'
  | 'TRUST_UPDATE'
  | 'COMMAND'
  | 'HOUSEKEEPING';

/** Per-device credential and transport policy. */
export interface GatewayDeviceCredential {
  readonly deviceId: string;
  readonly profile: DeviceProfile;
  readonly allowedTransports: readonly EdgeTransport[];
  readonly allowedSecurityModes: readonly IngressSecurityMode[];
  readonly hmacSecret?: string;
  readonly aesKey?: string;
  readonly publicKeyPem?: string;
  readonly tags?: readonly string[];
}

/** Security metadata carried by a device message. */
export interface IngressSecurityDescriptor {
  readonly mode: IngressSecurityMode;
  readonly keyId?: string;
  readonly signature?: string;
  readonly nonce?: string;
  readonly iv?: string;
  readonly authTag?: string;
}

/** Universal edge message envelope accepted by the optional gateway layer. */
export interface UniversalIngressEnvelope {
  readonly deviceId: string;
  readonly transport: EdgeTransport;
  readonly eventKind: IngressEventKind;
  readonly timestamp: string;
  readonly sequenceId: string | number;
  readonly payload: unknown;
  readonly security: IngressSecurityDescriptor;
  readonly localOnly?: boolean;
  readonly broadcast?: boolean;
  readonly metadata?: Record<string, unknown>;
}

/** Result returned after a device envelope has passed gateway ingress validation. */
export interface GatewayIngressResult {
  readonly accepted: boolean;
  readonly event: CanonicalEvent;
  readonly plaintextAccepted: boolean;
  readonly backendQueued: number;
  readonly backendDelivered: number;
}

/** Gateway configuration for local-only, hybrid, or remote-managed deployments. */
export interface GatewayConfig {
  readonly mode: GatewayMode;
  readonly runMode: AegisRunMode;
  readonly backendBinding: BackendBindingMode;
  readonly allowPlaintextFrom: readonly EdgeTransport[];
  readonly requireNonceForSecureIngress: boolean;
  readonly replayWindowMs: number;
  readonly maxBodyBytes: number;
  readonly eventLogSize: number;
  readonly gatewayId: string;
  readonly adminTokenSha256?: string;
  readonly publicHealth: boolean;
  readonly credentials: readonly GatewayDeviceCredential[];
  readonly networkSegments: readonly NetworkSegmentConfig[];
  readonly channelDefaults: ChannelProcessingDefaults;
}

/** Logical LAN, cloud, or serial segment used for routing and policy. */
export interface NetworkSegmentConfig {
  readonly id: string;
  readonly kind: 'LOCAL_LAN' | 'REMOTE_CLOUD' | 'SERIAL_BUS' | 'MESH' | 'DMZ';
  readonly allowCloudEgress: boolean;
  readonly allowPeerForwarding: boolean;
  readonly description?: string;
}

/** Defaults applied to newly registered channels. */
export interface ChannelProcessingDefaults {
  readonly maxFrameBytes: number;
  readonly requireDeviceIdentityInPayload: boolean;
  readonly autoBaseline: boolean;
}

/** Backend delivery scope. */
export type BackendScope = 'LOCAL' | 'REMOTE';

/** Backend delivery outcome. */
export interface BackendDeliveryResult {
  readonly backendId: string;
  readonly delivered: boolean;
  readonly queued: boolean;
  readonly error?: string;
}

/** Optional plug-in backend connector used by gateway fanout. */
export interface BackendConnector {
  readonly id: string;
  readonly scope: BackendScope;
  push(event: CanonicalEvent): Promise<void>;
}
