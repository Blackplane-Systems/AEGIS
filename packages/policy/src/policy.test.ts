import { describe, expect, it } from 'vitest';
import { createAegisConfig } from '../../core/src';
import {
  BUILT_IN_LTL_TEMPLATES,
  RetePolicyEngine,
  Rule,
  evaluateCondition,
  isFresh,
  parseRuleDefinition,
  resolveConflicts,
} from './index';

describe('policy parser', () => {
  it('round-trips JSON and YAML rule definitions across syntax variants', () => {
    const rule: Rule = {
      id: 'all-variants',
      when: {
        type: 'AND',
        conditions: [
          { type: 'ATOM', field: 'payload.temp', op: '>', value: 10 },
          { type: 'NOT', condition: { type: 'ATOM', field: 'locked', op: '==', value: true } },
          {
            type: 'OR',
            conditions: [
              { type: 'CONFIDENCE', min: 0.9 },
              { type: 'TRUST', op: '>=', value: 0.8 },
            ],
          },
          {
            type: 'WITHIN',
            window: { ms: 1000 },
            condition: { type: 'ATOM', field: 'status', op: '==', value: 'fresh' },
          },
          { type: 'COUNT', eventType: 'alarm', op: '>=', value: 2, window: { ms: 1000 } },
        ],
      },
      then: { kind: 'DEGRADE', reason: 'variant coverage' },
    };
    expect(parseRuleDefinition(JSON.stringify(rule))).toEqual(rule);
    expect(
      parseRuleDefinition(`
id: yaml-rule
when:
  type: TRUST
  op: ">="
  value: 0.8
then:
  kind: EXECUTE
`),
    ).toEqual({
      id: 'yaml-rule',
      when: { type: 'TRUST', op: '>=', value: 0.8 },
      then: { kind: 'EXECUTE' },
    });
  });
});

describe('rete policy evaluator', () => {
  it('updates working memory and joins alpha/beta matches', () => {
    const rule: Rule = {
      id: 'count-and-trust',
      when: {
        type: 'AND',
        conditions: [
          { type: 'TRUST', op: '>=', value: 0.8 },
          { type: 'COUNT', eventType: 'alarm', op: '>=', value: 2, window: { ms: 1000 } },
        ],
      },
      then: { kind: 'ADVISORY' },
    };
    const engine = new RetePolicyEngine([rule]);
    engine.addFact({ type: 'alarm', timestamp: '2026-01-01T00:00:00.000Z' });
    engine.addFact({ type: 'alarm', timestamp: '2026-01-01T00:00:00.500Z' });
    expect(engine.evaluate({ trust: 0.9 }, new Date('2026-01-01T00:00:01.000Z'))).toHaveLength(1);
  });

  it('evaluates every built-in LTL template', () => {
    const engine = new RetePolicyEngine(BUILT_IN_LTL_TEMPLATES);
    expect(
      engine.evaluate({ payload: { pressure: 120 }, command: 'open_valve', trust: 1 }),
    ).toContainEqual(expect.objectContaining({ ruleId: 'P1_VALVE_SAFETY' }));
    expect(engine.evaluate({ trust: 0.2 })).toContainEqual(
      expect.objectContaining({ ruleId: 'P2_ACCESS_CONTROL' }),
    );
    expect(engine.evaluate({ trust: 1, cooldownActive: true })).toContainEqual(
      expect.objectContaining({ ruleId: 'P3_ACTUATION_COOLDOWN' }),
    );
    expect(engine.evaluate({ trust: 1, stale: true })).toContainEqual(
      expect.objectContaining({ ruleId: 'P4_STALE_DATA_LOCKOUT' }),
    );
  });

  it('enforces conflict-resolution safety axioms', () => {
    expect(resolveConflicts([{ kind: 'EXECUTE' }, { kind: 'BLOCK' }]).kind).toBe('BLOCK');
    expect(resolveConflicts([{ kind: 'EXECUTE' }], { localSafetyViolation: true }).kind).toBe(
      'BLOCK',
    );
    expect(resolveConflicts([{ kind: 'EXECUTE' }], { stale: true }).kind).toBe('BLOCK');
    expect(
      resolveConflicts([{ kind: 'EXECUTE' }], { allowedActions: ['ADVISORY'] }).reason,
    ).toContain('privilege');
  });

  it('checks temporal freshness and condition helpers', () => {
    const config = createAegisConfig({ policy: { maxEventAgeMs: 1000, strictSignedRules: false } });
    expect(
      isFresh(
        { timestamp: '2026-01-01T00:00:00.500Z' },
        config,
        new Date('2026-01-01T00:00:01.000Z'),
      ),
    ).toBe(true);
    expect(
      isFresh(
        { timestamp: '2026-01-01T00:00:00.000Z' },
        config,
        new Date('2026-01-01T00:00:02.000Z'),
      ),
    ).toBe(false);
    expect(
      evaluateCondition(
        { type: 'ATOM', field: 'capabilities', op: 'includes', value: 'actuate' },
        { state: { capabilities: ['actuate'] } },
      ),
    ).toBe(true);
  });
});
