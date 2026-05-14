/** Attack classes learned from confirmed malicious or invalid traffic. */
export type AttackType =
  | 'REPLAY'
  | 'SPOOFING'
  | 'PLAINTEXT_COMMAND'
  | 'UNAUTHORIZED_TRANSPORT'
  | 'SIGNATURE_FAILURE'
  | 'NONCE_REUSE'
  | 'PAYLOAD_FLOOD'
  | 'BASELINE_DEVIATION'
  | 'UNKNOWN';

/** Verified malicious attempt used for continuous gateway learning. */
export interface VerifiedAttackAttempt {
  readonly type: AttackType;
  readonly deviceId?: string;
  readonly transport?: string;
  readonly reason: string;
  readonly indicators?: readonly string[];
  readonly observedAt?: string;
}

/** Attack summary suitable for APIs and dashboards. */
export interface AttackPatternSummary {
  readonly type: AttackType;
  readonly count: number;
  readonly indicators: readonly string[];
  readonly lastSeen: string;
}

/** In-memory attack learner that turns verified attempts into reusable indicators. */
export class AttackPatternLearner {
  private readonly patterns = new Map<AttackType, AttackPatternSummary>();

  /** Records a verified attempt from operators, APIs, or gateway rejection review. */
  public recordVerifiedAttempt(attempt: VerifiedAttackAttempt): AttackPatternSummary {
    const current = this.patterns.get(attempt.type);
    const indicators = new Set(current?.indicators ?? []);
    for (const indicator of attempt.indicators ?? []) {
      indicators.add(indicator);
    }
    indicators.add(normalizeIndicator(attempt.reason));
    const summary: AttackPatternSummary = {
      type: attempt.type,
      count: (current?.count ?? 0) + 1,
      indicators: [...indicators].sort(),
      lastSeen: attempt.observedAt ?? new Date().toISOString(),
    };
    this.patterns.set(attempt.type, summary);
    return summary;
  }

  /** Classifies a new rejection using built-in reason mapping plus learned indicators. */
  public classify(reason: string): AttackType {
    const normalized = normalizeIndicator(reason);
    if (normalized.includes('sequence_replay')) {
      return 'REPLAY';
    }
    if (normalized.includes('nonce_replay')) {
      return 'NONCE_REUSE';
    }
    if (normalized.includes('plain_text_command') || normalized.includes('plaintext_command')) {
      return 'PLAINTEXT_COMMAND';
    }
    if (normalized.includes('invalid_hmac') || normalized.includes('invalid_ed25519')) {
      return 'SIGNATURE_FAILURE';
    }
    if (normalized.includes('not_allowed_to_use')) {
      return 'UNAUTHORIZED_TRANSPORT';
    }
    for (const pattern of this.patterns.values()) {
      if (pattern.indicators.some((indicator) => normalized.includes(indicator))) {
        return pattern.type;
      }
    }
    return 'UNKNOWN';
  }

  /** Records a gateway rejection as observed attack intelligence. */
  public recordObservedRejection(
    reason: string,
    deviceId?: string,
    transport?: string,
  ): AttackPatternSummary {
    return this.recordVerifiedAttempt({
      type: this.classify(reason),
      reason,
      ...(deviceId === undefined ? {} : { deviceId }),
      ...(transport === undefined ? {} : { transport }),
    });
  }

  /** Returns all learned attack summaries. */
  public summaries(): readonly AttackPatternSummary[] {
    return [...this.patterns.values()].sort((left, right) => left.type.localeCompare(right.type));
  }
}

function normalizeIndicator(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}
