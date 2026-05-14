/** Replay rejection result for telemetry and command envelopes. */
export interface ReplayCheckResult {
  readonly accepted: boolean;
  readonly reason?: string;
}

/** Lightweight replay guard for edge envelopes with monotone numeric sequences and nonce windows. */
export class GatewayReplayGuard {
  private readonly lastNumericSequence = new Map<string, number>();
  private readonly seenTokens = new Map<string, number>();

  public constructor(private readonly windowMs: number) {
    if (!Number.isInteger(windowMs) || windowMs <= 0) {
      throw new Error('GatewayReplayGuard windowMs must be a positive integer');
    }
  }

  /** Checks and records sequence/nonce material for a device envelope. */
  public check(
    deviceId: string,
    sequenceId: string | number,
    nonce: string | undefined,
    nowMs: number,
  ): ReplayCheckResult {
    this.expire(nowMs);
    if (typeof sequenceId === 'number') {
      const last = this.lastNumericSequence.get(deviceId);
      if (last !== undefined && sequenceId <= last) {
        return { accepted: false, reason: 'sequence_replay' };
      }
      this.lastNumericSequence.set(deviceId, sequenceId);
    } else {
      const token = `${deviceId}:seq:${sequenceId}`;
      if (this.seenTokens.has(token)) {
        return { accepted: false, reason: 'sequence_replay' };
      }
      this.seenTokens.set(token, nowMs + this.windowMs);
    }
    if (nonce !== undefined) {
      const token = `${deviceId}:nonce:${nonce}`;
      if (this.seenTokens.has(token)) {
        return { accepted: false, reason: 'nonce_replay' };
      }
      this.seenTokens.set(token, nowMs + this.windowMs);
    }
    return { accepted: true };
  }

  /** Returns the number of cached replay tokens. */
  public tokenCount(): number {
    return this.seenTokens.size;
  }

  private expire(nowMs: number): void {
    for (const [token, expiresAt] of this.seenTokens.entries()) {
      if (expiresAt <= nowMs) {
        this.seenTokens.delete(token);
      }
    }
  }
}
