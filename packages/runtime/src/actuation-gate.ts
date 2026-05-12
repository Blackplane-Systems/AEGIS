import { AegisConfig, createAegisConfig } from '../../core/src';
import { EventPriority } from './priorities';

/** Criticality class for actuation commands. */
export type Criticality = 'NORMAL' | 'CRITICAL';

/** Rollback reversibility model. */
export enum Reversibility {
  FULLY_REVERSIBLE = 'FULLY_REVERSIBLE',
  PARTIALLY_REVERSIBLE = 'PARTIALLY_REVERSIBLE',
  IRREVERSIBLE = 'IRREVERSIBLE',
}

/** Actuation request checked by the CNF safety gate. */
export interface ActuationRequest {
  readonly id: string;
  readonly deviceId: string;
  readonly command: string;
  readonly criticality: Criticality;
  readonly trust: number;
  readonly preconditionsMet: boolean;
  readonly conflicts: readonly string[];
  readonly approvals: readonly string[];
  readonly issuedAt: number;
  readonly reversibility: Reversibility;
  readonly inverse?: Omit<ActuationRequest, 'inverse'>;
}

/** Gate decision with independent gate status. */
export interface ActuationDecision {
  readonly approved: boolean;
  readonly gates: {
    readonly trust: boolean;
    readonly precondition: boolean;
    readonly rate: boolean;
    readonly conflict: boolean;
    readonly quorum: boolean;
  };
  readonly quorumRequired: number;
}

/** Rollback result for a stored actuation. */
export interface RollbackResult {
  readonly issued: boolean;
  readonly escalation: boolean;
  readonly rollbackEvent?: {
    readonly priority: EventPriority.ROLLBACK;
    readonly actuation: Omit<ActuationRequest, 'inverse'>;
    readonly auditMark: true;
  };
}

/** Configurable actuation safety interlock implementing the CNF approved(act) check. */
export class ActuationSafetyGate {
  private readonly cooldowns = new Map<string, number>();
  private readonly approvedActs = new Map<string, ActuationRequest>();

  public constructor(private readonly config: AegisConfig = createAegisConfig()) {}

  /** Returns the configured quorum threshold q > (n + f) / 2. */
  public quorumRequired(
    n = this.config.actuation.quorumN,
    f = this.config.actuation.quorumF,
  ): number {
    return Math.floor((n + f) / 2) + 1;
  }

  /** Evaluates all gates independently and records approved actuations. */
  public approved(actuation: ActuationRequest): ActuationDecision {
    const gates = {
      trust: this.trustGate(actuation),
      precondition: this.preconditionGate(actuation),
      rate: this.rateGate(actuation),
      conflict: this.conflictGate(actuation),
      quorum: this.quorumGate(actuation),
    };
    const approved = Object.values(gates).every(Boolean);
    if (approved) {
      this.cooldowns.set(this.cooldownKey(actuation), actuation.issuedAt);
      this.approvedActs.set(actuation.id, actuation);
    }
    return { approved, gates, quorumRequired: this.quorumRequired() };
  }

  /** Trust gate. */
  public trustGate(actuation: ActuationRequest): boolean {
    return actuation.trust >= this.config.actuation.minTrust;
  }

  /** Precondition gate. */
  public preconditionGate(actuation: ActuationRequest): boolean {
    return actuation.preconditionsMet;
  }

  /** Cooldown/rate gate per (device, command). */
  public rateGate(actuation: ActuationRequest): boolean {
    const previous = this.cooldowns.get(this.cooldownKey(actuation));
    return (
      previous === undefined || actuation.issuedAt - previous >= this.config.actuation.cooldownMs
    );
  }

  /** Conflict gate. */
  public conflictGate(actuation: ActuationRequest): boolean {
    return actuation.conflicts.length === 0;
  }

  /** Quorum gate for CRITICAL actions. */
  public quorumGate(actuation: ActuationRequest): boolean {
    if (actuation.criticality !== 'CRITICAL') {
      return true;
    }
    return actuation.approvals.length >= this.quorumRequired();
  }

  /** Looks up inverse action, re-issues it with ROLLBACK priority, or escalates irreversible actions. */
  public rollback(actId: string): RollbackResult {
    const original = this.approvedActs.get(actId);
    if (
      original === undefined ||
      original.reversibility === Reversibility.IRREVERSIBLE ||
      original.inverse === undefined
    ) {
      return { issued: false, escalation: true };
    }
    return {
      issued: true,
      escalation: original.reversibility === Reversibility.PARTIALLY_REVERSIBLE,
      rollbackEvent: {
        priority: EventPriority.ROLLBACK,
        actuation: original.inverse,
        auditMark: true,
      },
    };
  }

  private cooldownKey(actuation: ActuationRequest): string {
    return `${actuation.deviceId}:${actuation.command}`;
  }
}
