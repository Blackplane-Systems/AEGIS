import { Action, Comparator, Condition, Rule } from './ast';

/** Parses structured JSON/YAML rule definitions and validates the typed AST. */
export function parseRuleDefinition(input: string | unknown): Rule {
  const value = typeof input === 'string' ? parseStructuredText(input) : input;
  return toRule(value);
}

/** Serialises a rule to stable JSON for parser round-trip tests and CLI output. */
export function serialiseRule(rule: Rule): string {
  return JSON.stringify(rule, Object.keys(rule).sort(), 2);
}

function parseStructuredText(input: string): unknown {
  try {
    return JSON.parse(input);
  } catch {
    return parseSimpleYaml(input);
  }
}

function toRule(value: unknown): Rule {
  if (!isRecord(value)) {
    throw new Error('Rule definition must be an object');
  }
  const id = value.id;
  if (typeof id !== 'string' || id.length === 0) {
    throw new Error('Rule requires id');
  }
  const rule: Rule = {
    id,
    when: toCondition(value.when),
    then: toAction(value.then),
  };
  return {
    ...rule,
    ...(typeof value.description === 'string' ? { description: value.description } : {}),
    ...(typeof value.signature === 'string' ? { signature: value.signature } : {}),
  };
}

function toCondition(value: unknown): Condition {
  if (!isRecord(value) || typeof value.type !== 'string') {
    throw new Error('Condition requires a type');
  }
  switch (value.type) {
    case 'ATOM':
      if (typeof value.field !== 'string' || typeof value.op !== 'string') {
        throw new Error('ATOM requires field and op');
      }
      return {
        type: 'ATOM',
        field: value.field,
        op: value.op as Comparator,
        ...(Object.prototype.hasOwnProperty.call(value, 'value') ? { value: value.value } : {}),
      } as Condition;
    case 'NOT':
      return { type: 'NOT', condition: toCondition(value.condition) };
    case 'AND':
    case 'OR':
      if (!Array.isArray(value.conditions)) {
        throw new Error(`${value.type} requires conditions`);
      }
      return { type: value.type, conditions: value.conditions.map(toCondition) } as Condition;
    case 'WITHIN':
      return {
        type: 'WITHIN',
        condition: toCondition(value.condition),
        window: toWindow(value.window),
      };
    case 'COUNT':
      if (typeof value.op !== 'string' || typeof value.value !== 'number') {
        throw new Error('COUNT requires op and numeric value');
      }
      return {
        type: 'COUNT',
        ...(typeof value.eventType === 'string' ? { eventType: value.eventType } : {}),
        op: value.op as Comparator,
        value: value.value,
        window: toWindow(value.window),
      } as Condition;
    case 'CONFIDENCE':
      if (typeof value.min !== 'number') {
        throw new Error('CONFIDENCE requires min');
      }
      return { type: 'CONFIDENCE', min: value.min };
    case 'TRUST':
      if (typeof value.op !== 'string' || typeof value.value !== 'number') {
        throw new Error('TRUST requires op and value');
      }
      return { type: 'TRUST', op: value.op as Comparator, value: value.value };
    default:
      throw new Error(`Unknown condition type: ${value.type}`);
  }
}

function toAction(value: unknown): Action {
  if (!isRecord(value) || typeof value.kind !== 'string') {
    throw new Error('Action requires kind');
  }
  return {
    kind: value.kind as Action['kind'],
    ...(typeof value.command === 'string' ? { command: value.command } : {}),
    ...(typeof value.reason === 'string' ? { reason: value.reason } : {}),
  };
}

function toWindow(value: unknown): { readonly ms: number } {
  if (!isRecord(value) || typeof value.ms !== 'number') {
    throw new Error('TimeWindow requires ms');
  }
  return { ms: value.ms };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function parseSimpleYaml(input: string): unknown {
  const root: Record<string, unknown> = {};
  const stack: Array<{ indent: number; value: Record<string, unknown> }> = [
    { indent: -1, value: root },
  ];
  for (const rawLine of input.split(/\r?\n/)) {
    if (rawLine.trim().length === 0 || rawLine.trim().startsWith('#')) {
      continue;
    }
    const indent = rawLine.match(/^\s*/)?.[0].length ?? 0;
    const line = rawLine.trim();
    const separator = line.indexOf(':');
    if (separator < 0) {
      throw new Error(`Unsupported YAML line: ${rawLine}`);
    }
    const key = line.slice(0, separator).trim();
    const rawValue = line.slice(separator + 1).trim();
    while (stack.length > 1 && indent <= stack[stack.length - 1]!.indent) {
      stack.pop();
    }
    const parent = stack[stack.length - 1]!.value;
    if (rawValue.length === 0) {
      const child: Record<string, unknown> = {};
      parent[key] = child;
      stack.push({ indent, value: child });
    } else {
      parent[key] = parseScalar(rawValue);
    }
  }
  return root;
}

function parseScalar(raw: string): unknown {
  const unquoted = raw.replace(/^['"]|['"]$/g, '');
  if (unquoted === 'true') {
    return true;
  }
  if (unquoted === 'false') {
    return false;
  }
  const numeric = Number(unquoted);
  return Number.isFinite(numeric) && unquoted.trim() !== '' ? numeric : unquoted;
}
