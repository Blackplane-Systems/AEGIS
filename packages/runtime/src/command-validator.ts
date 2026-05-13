import { createPublicKey, verify } from 'crypto';

/** Signed command accepted by the replay-prevention validator. */
export interface SignedCommand {
  readonly deviceId: string;
  readonly seq: number;
  readonly timestamp: string;
  readonly nonce: string;
  readonly payload: Record<string, unknown>;
  readonly signature: string;
}

/** Replay-prevention validator configuration. */
export interface CommandValidatorConfig {
  readonly skewToleranceMs?: number;
}

/** Command validation result. */
export interface CommandValidationResult {
  readonly accepted: boolean;
  readonly reason?: string;
}

/** Enforces monotone sequence, timestamp skew, nonce dedupe, and Ed25519 signature checks. */
export class CommandValidator {
  private readonly lastSeq = new Map<string, number>();
  private readonly nonces = new Map<string, Map<string, number>>();
  private readonly skewToleranceMs: number;

  public constructor(config: CommandValidatorConfig = {}) {
    this.skewToleranceMs = config.skewToleranceMs ?? 30_000;
  }

  /** Validates and records a signed command if accepted. */
  public validate(
    command: SignedCommand,
    publicKeyPem: string,
    now = new Date(),
  ): CommandValidationResult {
    if (command.seq <= (this.lastSeq.get(command.deviceId) ?? 0)) {
      return { accepted: false, reason: 'OUT_OF_ORDER_SEQ' };
    }
    const timestampMs = Date.parse(command.timestamp);
    if (
      !Number.isFinite(timestampMs) ||
      Math.abs(timestampMs - now.getTime()) >= this.skewToleranceMs
    ) {
      return { accepted: false, reason: 'EXPIRED_TIMESTAMP' };
    }
    this.prune(command.deviceId, now.getTime());
    const deviceNonces = this.nonces.get(command.deviceId) ?? new Map<string, number>();
    if (deviceNonces.has(command.nonce)) {
      return { accepted: false, reason: 'DUPLICATE_NONCE' };
    }
    if (
      !verify(
        null,
        Buffer.from(commandSigningPayload(command)),
        createPublicKey(publicKeyPem),
        Buffer.from(command.signature, 'base64'),
      )
    ) {
      return { accepted: false, reason: 'BAD_SIGNATURE' };
    }
    deviceNonces.set(command.nonce, now.getTime());
    this.nonces.set(command.deviceId, deviceNonces);
    this.lastSeq.set(command.deviceId, command.seq);
    return { accepted: true };
  }

  private prune(deviceId: string, nowMs: number): void {
    const deviceNonces = this.nonces.get(deviceId);
    if (deviceNonces === undefined) {
      return;
    }
    for (const [nonce, seenAt] of deviceNonces) {
      if (nowMs - seenAt > this.skewToleranceMs) {
        deviceNonces.delete(nonce);
      }
    }
  }
}

/** Stable command payload covered by the Ed25519 signature. */
export function commandSigningPayload(command: Omit<SignedCommand, 'signature'>): string {
  return JSON.stringify({
    deviceId: command.deviceId,
    seq: command.seq,
    timestamp: command.timestamp,
    nonce: command.nonce,
    payload: command.payload,
  });
}
