import { Rule } from './ast';

/** P1 LTL template: valve safety blocks opening under high pressure. */
export const VALVE_SAFETY_TEMPLATE: Rule = {
  id: 'P1_VALVE_SAFETY',
  description: 'G(pressure_high -> X block valve open)',
  when: {
    type: 'AND',
    conditions: [
      { type: 'ATOM', field: 'payload.pressure', op: '>', value: 100 },
      { type: 'ATOM', field: 'command', op: '==', value: 'open_valve' },
    ],
  },
  then: { kind: 'BLOCK', command: 'open_valve', reason: 'pressure safety limit exceeded' },
};

/** P2 LTL template: access control blocks execution under trust threshold. */
export const ACCESS_CONTROL_TEMPLATE: Rule = {
  id: 'P2_ACCESS_CONTROL',
  description: 'G(trust_low -> block execute)',
  when: { type: 'TRUST', op: '<', value: 0.75 },
  then: { kind: 'BLOCK', reason: 'trust below execution threshold' },
};

/** P3 LTL template: actuation cooldown blocks repeated actuation. */
export const ACTUATION_COOLDOWN_TEMPLATE: Rule = {
  id: 'P3_ACTUATION_COOLDOWN',
  description: 'G(cooldown_active -> block actuation)',
  when: { type: 'ATOM', field: 'cooldownActive', op: '==', value: true },
  then: { kind: 'BLOCK', reason: 'actuation cooldown active' },
};

/** P4 LTL template: stale data lockout. */
export const STALE_DATA_LOCKOUT_TEMPLATE: Rule = {
  id: 'P4_STALE_DATA_LOCKOUT',
  description: 'G(stale_data -> block execute)',
  when: { type: 'ATOM', field: 'stale', op: '==', value: true },
  then: { kind: 'BLOCK', reason: 'stale data lockout' },
};

/** Built-in pre-compiled Phase 1 LTL rules. */
export const BUILT_IN_LTL_TEMPLATES: readonly Rule[] = [
  VALVE_SAFETY_TEMPLATE,
  ACCESS_CONTROL_TEMPLATE,
  ACTUATION_COOLDOWN_TEMPLATE,
  STALE_DATA_LOCKOUT_TEMPLATE,
];
