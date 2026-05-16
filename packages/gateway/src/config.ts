import { GatewayConfig } from './types';
import {
  DEFAULT_NETWORK_INTELLIGENCE_CONFIG,
  DEFAULT_NETWORK_INTELLIGENCE_THRESHOLDS,
} from './network-intelligence';

/** Default replay window for constrained edge device envelopes. */
export const DEFAULT_GATEWAY_REPLAY_WINDOW_MS = 120_000;

/** Default maximum HTTP body size for device ingestion. */
export const DEFAULT_GATEWAY_MAX_BODY_BYTES = 64 * 1024;

/** Creates a conservative gateway configuration for local, hybrid, or remote operation. */
export function createGatewayConfig(
  overrides: Partial<GatewayConfig> & Pick<GatewayConfig, 'credentials'>,
): GatewayConfig {
  return {
    mode: overrides.mode ?? 'HYBRID',
    runMode: overrides.runMode ?? 'STANDALONE_PROCESS',
    backendBinding: overrides.backendBinding ?? 'LOOSE',
    allowPlaintextFrom: overrides.allowPlaintextFrom ?? ['serial', 'lora', 'broadcast_udp'],
    requireNonceForSecureIngress: overrides.requireNonceForSecureIngress ?? true,
    replayWindowMs: overrides.replayWindowMs ?? DEFAULT_GATEWAY_REPLAY_WINDOW_MS,
    maxBodyBytes: overrides.maxBodyBytes ?? DEFAULT_GATEWAY_MAX_BODY_BYTES,
    eventLogSize: overrides.eventLogSize ?? 1_000,
    gatewayId: overrides.gatewayId ?? 'aegis-gateway-local',
    publicHealth: overrides.publicHealth ?? false,
    credentials: overrides.credentials,
    networkSegments: overrides.networkSegments ?? [
      {
        id: 'local',
        kind: 'LOCAL_LAN',
        allowCloudEgress: true,
        allowPeerForwarding: true,
        description: 'Default local edge network',
      },
    ],
    channelDefaults: overrides.channelDefaults ?? {
      maxFrameBytes: 4_096,
      requireDeviceIdentityInPayload: true,
      autoBaseline: true,
    },
    networkIntelligence: {
      ...DEFAULT_NETWORK_INTELLIGENCE_CONFIG,
      ...(overrides.networkIntelligence ?? {}),
      thresholds: {
        ...DEFAULT_NETWORK_INTELLIGENCE_THRESHOLDS,
        ...(overrides.networkIntelligence?.thresholds ?? {}),
      },
    },
    ui: overrides.ui ?? {
      enabled: true,
      requireAuth: true,
      title: 'AEGIS Gateway Console',
    },
    ...(overrides.adminTokenSha256 === undefined
      ? {}
      : { adminTokenSha256: overrides.adminTokenSha256 }),
  };
}
