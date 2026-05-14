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
  readonly allowPlaintextFrom: readonly EdgeTransport[];
  readonly requireNonceForSecureIngress: boolean;
  readonly replayWindowMs: number;
  readonly maxBodyBytes: number;
  readonly eventLogSize: number;
  readonly adminTokenSha256?: string;
  readonly publicHealth: boolean;
  readonly credentials: readonly GatewayDeviceCredential[];
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
