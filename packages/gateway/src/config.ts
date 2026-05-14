import { GatewayConfig } from './types';

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
    allowPlaintextFrom: overrides.allowPlaintextFrom ?? ['serial', 'lora', 'broadcast_udp'],
    requireNonceForSecureIngress: overrides.requireNonceForSecureIngress ?? true,
    replayWindowMs: overrides.replayWindowMs ?? DEFAULT_GATEWAY_REPLAY_WINDOW_MS,
    maxBodyBytes: overrides.maxBodyBytes ?? DEFAULT_GATEWAY_MAX_BODY_BYTES,
    eventLogSize: overrides.eventLogSize ?? 1_000,
    publicHealth: overrides.publicHealth ?? false,
    credentials: overrides.credentials,
    ...(overrides.adminTokenSha256 === undefined
      ? {}
      : { adminTokenSha256: overrides.adminTokenSha256 }),
  };
}
