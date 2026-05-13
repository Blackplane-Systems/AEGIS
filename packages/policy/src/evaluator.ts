import { AegisConfig, createAegisConfig } from '../../core/src';
import { Action, ActionKind, Comparator, Condition, EvaluationContext, Rule } from './ast';

/** Result emitted for one matched policy rule. */
export interface PolicyEvaluation {
  readonly ruleId: string;
  readonly matched: boolean;
  readonly action: Action;
}

/** Conflict-resolution context for safety axioms A1-A4. */
export interface ConflictContext {
  readonly localSafetyViolation?: boolean;
  readonly stale?: boolean;
  readonly allowedActions?: readonly ActionKind[];
}

/** Single-condition alpha node used by the simplified Rete evaluator. */
export class AlphaNode {
  public constructor(private readonly condition: Condition) {}

  /** Tests a single condition against a context. */
  public test(context: EvaluationContext): boolean {
    return evaluateCondition(this.condition, context);
  }
}

/** Beta join for multi-condition matches. */
export class BetaJoin {
  public constructor(private readonly conditions: readonly Condition[]) {}

  /** Returns true when all joined conditions match. */
  public join(context: EvaluationContext): boolean {
    return this.conditions.every((condition) => new AlphaNode(condition).test(context));
  }
}

/** Simplified Rete-network policy engine with working-memory updates. */
export class RetePolicyEngine {
  private readonly workingMemory: Record<string, unknown>[] = [];

  public constructor(
    private readonly rules: readonly Rule[],
    private readonly config: AegisConfig = createAegisConfig(),
  ) {
    if (config.policy.strictSignedRules && rules.some((rule) => rule.signature === undefined)) {
      throw new Error('STRICT policy mode rejects unsigned rules');
    }
  }

  /** Adds a fact to working memory. */
  public addFact(fact: Record<string, unknown>): void {
    this.workingMemory.push(structuredClone(fact));
  }

  /** Evaluates all rules against state plus working-memory facts. */
  public evaluate(state: Record<string, unknown>, now = new Date()): readonly PolicyEvaluation[] {
    const context: EvaluationContext = {
      state,
      now,
      facts: this.workingMemory,
    };
    return this.rules
      .map((rule) => ({
        ruleId: rule.id,
        matched: evaluateCondition(rule.when, context, this.config),
        action: rule.then,
      }))
      .filter((result) => result.matched);
  }
}

/** Evaluates a policy condition AST recursively. */
export function evaluateCondition(
  condition: Condition,
  context: EvaluationContext,
  config: AegisConfig = createAegisConfig(),
): boolean {
  switch (condition.type) {
    case 'ATOM':
      return compare(readPath(context.state, condition.field), condition.op, condition.value);
    case 'NOT':
      return !evaluateCondition(condition.condition, context, config);
    case 'AND':
      return new BetaJoin(condition.conditions).join(context);
    case 'OR':
      return condition.conditions.some((child) => evaluateCondition(child, context, config));
    case 'WITHIN': {
      const timestampValue = readPath(context.state, 'timestamp');
      const now = context.now ?? new Date();
      const timestamp =
        typeof timestampValue === 'string' || typeof timestampValue === 'number'
          ? new Date(timestampValue)
          : now;
      return (
        now.getTime() - timestamp.getTime() <= condition.window.ms &&
        evaluateCondition(condition.condition, context, config)
      );
    }
    case 'COUNT': {
      const now = context.now ?? new Date();
      const count = (context.facts ?? []).filter((fact) => {
        const factTime = readPath(fact, 'timestamp');
        const timestamp =
          typeof factTime === 'string' || typeof factTime === 'number' ? new Date(factTime) : now;
        const inWindow = now.getTime() - timestamp.getTime() <= condition.window.ms;
        const typeMatches =
          condition.eventType === undefined || readPath(fact, 'type') === condition.eventType;
        return inWindow && typeMatches;
      }).length;
      return compare(count, condition.op, condition.value);
    }
    case 'CONFIDENCE':
      return Number(readPath(context.state, 'confidence')) >= condition.min;
    case 'TRUST':
      return compare(Number(readPath(context.state, 'trust')), condition.op, condition.value);
  }
}

/** Resolves conflicting policy actions using the safety lattice and axioms A1-A4. */
export function resolveConflicts(
  actions: readonly Action[],
  context: ConflictContext = {},
): Action {
  if (context.localSafetyViolation === true) {
    return { kind: 'BLOCK', reason: 'A2 local safety dominance' };
  }
  if (context.stale === true) {
    return { kind: 'BLOCK', reason: 'A3 freshness lockout' };
  }
  const allowed = new Set(context.allowedActions ?? ['BLOCK', 'DEGRADE', 'ADVISORY', 'EXECUTE']);
  if (actions.some((action) => !allowed.has(action.kind))) {
    return { kind: 'BLOCK', reason: 'A4 no privilege escalation' };
  }
  if (actions.length === 0) {
    return { kind: 'ADVISORY', reason: 'no matching rule' };
  }
  return [...actions].sort((a, b) => safetyRank(a.kind) - safetyRank(b.kind))[0]!;
}

/** Returns true when state age exceeds configured freshness. */
export function isFresh(
  state: Record<string, unknown>,
  config: AegisConfig = createAegisConfig(),
  now = new Date(),
): boolean {
  const timestamp = readPath(state, 'timestamp');
  if (typeof timestamp !== 'string' && typeof timestamp !== 'number') {
    return true;
  }
  return now.getTime() - new Date(timestamp).getTime() <= config.policy.maxEventAgeMs;
}

function safetyRank(kind: ActionKind): number {
  const rank: Record<ActionKind, number> = {
    BLOCK: 0,
    DEGRADE: 1,
    ADVISORY: 2,
    EXECUTE: 3,
  };
  return rank[kind];
}

function readPath(record: Record<string, unknown>, path: string): unknown {
  return path.split('.').reduce<unknown>((current, segment) => {
    if (current !== null && typeof current === 'object' && segment in current) {
      return (current as Record<string, unknown>)[segment];
    }
    return undefined;
  }, record);
}

function compare(left: unknown, op: Comparator, right: unknown): boolean {
  switch (op) {
    case '==':
      return left === right;
    case '!=':
      return left !== right;
    case '>':
      return Number(left) > Number(right);
    case '>=':
      return Number(left) >= Number(right);
    case '<':
      return Number(left) < Number(right);
    case '<=':
      return Number(left) <= Number(right);
    case 'exists':
      return left !== undefined && left !== null;
    case 'includes':
      return Array.isArray(left) && left.includes(right);
  }
}
