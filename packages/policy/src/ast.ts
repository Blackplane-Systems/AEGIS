/** Time window used by temporal policy conditions. */
export interface TimeWindow {
  readonly ms: number;
}

/** Atomic comparison operator. */
export type Comparator = '==' | '!=' | '>' | '>=' | '<' | '<=' | 'exists' | 'includes';

/** Policy condition AST matching Phase 1 formal syntax. */
export type Condition =
  | AtomCondition
  | NotCondition
  | AndCondition
  | OrCondition
  | WithinCondition
  | CountCondition
  | ConfidenceCondition
  | TrustCondition;

/** Single field comparison. */
export interface AtomCondition {
  readonly type: 'ATOM';
  readonly field: string;
  readonly op: Comparator;
  readonly value?: unknown;
}

/** Negated condition. */
export interface NotCondition {
  readonly type: 'NOT';
  readonly condition: Condition;
}

/** All child conditions must match. */
export interface AndCondition {
  readonly type: 'AND';
  readonly conditions: readonly Condition[];
}

/** Any child condition may match. */
export interface OrCondition {
  readonly type: 'OR';
  readonly conditions: readonly Condition[];
}

/** Child condition must match within a time window. */
export interface WithinCondition {
  readonly type: 'WITHIN';
  readonly condition: Condition;
  readonly window: TimeWindow;
}

/** Count matching facts over a time window. */
export interface CountCondition {
  readonly type: 'COUNT';
  readonly eventType?: string;
  readonly op: Comparator;
  readonly value: number;
  readonly window: TimeWindow;
}

/** Confidence threshold condition. */
export interface ConfidenceCondition {
  readonly type: 'CONFIDENCE';
  readonly min: number;
}

/** Trust threshold condition. */
export interface TrustCondition {
  readonly type: 'TRUST';
  readonly op: Comparator;
  readonly value: number;
}

/** Safety lattice action kind: BLOCK <= DEGRADE <= ADVISORY <= EXECUTE. */
export type ActionKind = 'BLOCK' | 'DEGRADE' | 'ADVISORY' | 'EXECUTE';

/** Policy action. */
export interface Action {
  readonly kind: ActionKind;
  readonly command?: string;
  readonly reason?: string;
}

/** Complete policy rule. */
export interface Rule {
  readonly id: string;
  readonly description?: string;
  readonly when: Condition;
  readonly then: Action;
  readonly signature?: string;
}

/** State and facts passed to a policy evaluation. */
export interface EvaluationContext {
  readonly now?: Date;
  readonly state: Record<string, unknown>;
  readonly facts?: readonly Record<string, unknown>[];
}
