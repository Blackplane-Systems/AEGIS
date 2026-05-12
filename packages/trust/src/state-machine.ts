import { AegisConfig, createAegisConfig } from '../../core/src';

/** Trust lifecycle states for AEGIS devices. */
export enum TrustState {
  OBSERVED = 'OBSERVED',
  PROVISIONED = 'PROVISIONED',
  VALIDATED = 'VALIDATED',
  CONSTRAINED = 'CONSTRAINED',
  DEGRADED = 'DEGRADED',
  QUARANTINED = 'QUARANTINED',
  REVOKED = 'REVOKED',
}

/** Actions emitted by the state machine as Moore outputs. */
export type PermittedAction =
  | 'observe'
  | 'enroll'
  | 'attest'
  | 'rotate_certificate'
  | 'report_telemetry'
  | 'update_trust'
  | 'request_actuation'
  | 'request_noncritical_actuation'
  | 'audit'
  | 'status';

/** Operator override used to force guarded state transitions. */
export type OperatorOverride =
  | 'provision'
  | 'validate'
  | 'constrain'
  | 'quarantine'
  | 'restore'
  | 'revoke';

/** Guard context supplied for a trust-state transition. */
export interface TransitionContext {
  readonly score: number;
  readonly attested?: boolean;
  readonly operatorOverride?: OperatorOverride;
  readonly reason?: string;
  readonly at?: Date;
}

/** Immutable transition history record. */
export interface TransitionRecord {
  readonly from: TrustState;
  readonly to: TrustState;
  readonly timestamp: string;
  readonly reason: string;
  readonly score: number;
}

/** Moore-machine implementation for device trust lifecycle. */
export class TrustStateMachine {
  private stateValue: TrustState;
  private readonly historyValue: TransitionRecord[] = [];
  private readonly config: AegisConfig;

  public constructor(
    initialState: TrustState = TrustState.OBSERVED,
    config: AegisConfig = createAegisConfig(),
  ) {
    this.stateValue = initialState;
    this.config = config;
  }

  /** Current trust state. */
  public get state(): TrustState {
    return this.stateValue;
  }

  /** Immutable transition history. */
  public get history(): readonly TransitionRecord[] {
    return [...this.historyValue];
  }

  /** Transitions to the target state when the guarded transition is valid. */
  public transition(to: TrustState, context: TransitionContext): TrustState {
    if (!this.canTransition(this.stateValue, to, context)) {
      throw new Error(`Invalid transition ${this.stateValue} -> ${to}`);
    }
    const from = this.stateValue;
    this.stateValue = to;
    this.historyValue.push({
      from,
      to,
      timestamp: (context.at ?? new Date()).toISOString(),
      reason: context.reason ?? context.operatorOverride ?? 'guard satisfied',
      score: context.score,
    });
    return this.stateValue;
  }

  /** Returns true when a transition satisfies allowed edge and guard rules. */
  public canTransition(from: TrustState, to: TrustState, context: TransitionContext): boolean {
    if (from === TrustState.REVOKED) {
      return false;
    }
    if (context.operatorOverride === 'revoke') {
      return to === TrustState.REVOKED;
    }
    if (context.operatorOverride === 'quarantine') {
      return to === TrustState.QUARANTINED;
    }
    if (context.score < this.config.trustThresholds.quarantine) {
      return to === TrustState.QUARANTINED;
    }
    if (context.score < this.config.trustThresholds.degraded) {
      return to === TrustState.DEGRADED || to === TrustState.QUARANTINED;
    }
    if (context.operatorOverride === 'restore' && from === TrustState.QUARANTINED) {
      return to === TrustState.PROVISIONED;
    }
    if (context.operatorOverride === 'provision') {
      return from === TrustState.OBSERVED && to === TrustState.PROVISIONED;
    }
    if (context.operatorOverride === 'constrain') {
      return to === TrustState.CONSTRAINED;
    }
    if (context.operatorOverride === 'validate') {
      return to === TrustState.VALIDATED && context.score >= this.config.trustThresholds.validated;
    }
    return matchesGuardedEdge(from, to, context, this.config);
  }
}

/** Returns the permitted action set for a state. */
export function getPermittedActions(state: TrustState): readonly PermittedAction[] {
  const actions: Record<TrustState, readonly PermittedAction[]> = {
    [TrustState.OBSERVED]: ['observe', 'enroll', 'status'],
    [TrustState.PROVISIONED]: ['attest', 'rotate_certificate', 'report_telemetry', 'status'],
    [TrustState.VALIDATED]: [
      'report_telemetry',
      'update_trust',
      'request_actuation',
      'audit',
      'status',
    ],
    [TrustState.CONSTRAINED]: [
      'report_telemetry',
      'update_trust',
      'request_noncritical_actuation',
      'audit',
      'status',
    ],
    [TrustState.DEGRADED]: ['report_telemetry', 'update_trust', 'audit', 'status'],
    [TrustState.QUARANTINED]: ['audit', 'status'],
    [TrustState.REVOKED]: [],
  };
  return actions[state];
}

function matchesGuardedEdge(
  from: TrustState,
  to: TrustState,
  context: TransitionContext,
  config: AegisConfig,
): boolean {
  const validatedGuard =
    context.score >= config.trustThresholds.validated && context.attested === true;
  switch (from) {
    case TrustState.OBSERVED:
      return to === TrustState.PROVISIONED;
    case TrustState.PROVISIONED:
      return to === TrustState.VALIDATED && validatedGuard;
    case TrustState.VALIDATED:
      return to === TrustState.CONSTRAINED && !validatedGuard;
    case TrustState.CONSTRAINED:
      return (to === TrustState.VALIDATED && validatedGuard) || to === TrustState.DEGRADED;
    case TrustState.DEGRADED:
      return to === TrustState.CONSTRAINED && context.score >= config.trustThresholds.degraded;
    case TrustState.QUARANTINED:
      return false;
    case TrustState.REVOKED:
      return false;
  }
}
