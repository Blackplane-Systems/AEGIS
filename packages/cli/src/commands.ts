import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';
import { CanonicalEvent } from '../../protocol/src';
import { createAuditRecord, verifyChain } from '../../runtime/src';
import { getPermittedActions, createDeviceIdentity, TrustState } from '../../trust/src';
import { RetePolicyEngine, parseRuleDefinition, resolveConflicts } from '../../policy/src';
import {
  CliDatabase,
  CliDeviceRecord,
  buildAuditChain,
  loadDatabase,
  saveDatabase,
} from './storage';

/** CLI IO abstraction used by tests and the executable entrypoint. */
export interface CliIo {
  readonly stdout: (message: string) => void;
  readonly stderr: (message: string) => void;
}

/** Executes an AEGIS CLI command and returns a process exit code. */
export async function runCli(
  argv: readonly string[],
  io: CliIo,
  cwd = process.cwd(),
): Promise<number> {
  try {
    const [command, ...rest] = argv;
    switch (command) {
      case 'enroll':
        return enroll(rest, io, cwd);
      case 'status':
        return status(rest, io, cwd);
      case 'simulate-event':
        return simulateEvent(rest, io, cwd);
      case 'audit':
        return audit(rest, io, cwd);
      case 'policy':
        return policy(rest, io, cwd);
      default:
        io.stderr('usage: aegis <enroll|status|simulate-event|audit|policy> ...');
        return 1;
    }
  } catch (error) {
    io.stderr(error instanceof Error ? error.message : String(error));
    return 1;
  }
}

function enroll(args: readonly string[], io: CliIo, cwd: string): number {
  const deviceId = args[0];
  if (deviceId === undefined) {
    throw new Error('usage: aegis enroll <device-id>');
  }
  const db = loadDatabase(cwd);
  const { identity, privateKeyPem } = createDeviceIdentity(deviceId, ['telemetry'], ['default']);
  const auditRecord = createAuditRecord({
    deviceId,
    type: 'STATE_TRANSITION',
    data: { from: TrustState.OBSERVED, to: TrustState.PROVISIONED },
  });
  db.devices[deviceId] = {
    deviceId,
    identity,
    privateKeyPem,
    state: TrustState.PROVISIONED,
    trust: 0.5,
    auditRecords: [auditRecord],
    events: [],
  };
  saveDatabase(cwd, db);
  io.stdout(`enrolled ${deviceId} state=${TrustState.PROVISIONED}`);
  return 0;
}

function status(args: readonly string[], io: CliIo, cwd: string): number {
  const deviceId = args[0];
  if (deviceId === undefined) {
    throw new Error('usage: aegis status <device-id>');
  }
  const device = requireDevice(loadDatabase(cwd), deviceId);
  io.stdout(
    JSON.stringify(
      {
        deviceId,
        trust: device.trust,
        state: device.state,
        permittedActions: getPermittedActions(device.state),
      },
      null,
      2,
    ),
  );
  return 0;
}

function simulateEvent(args: readonly string[], io: CliIo, cwd: string): number {
  const [deviceId, eventJson] = args;
  if (deviceId === undefined || eventJson === undefined) {
    throw new Error('usage: aegis simulate-event <device-id> <event-json>');
  }
  const db = loadDatabase(cwd);
  const device = requireDevice(db, deviceId);
  const event = JSON.parse(eventJson) as Partial<CanonicalEvent>;
  const canonical: CanonicalEvent = {
    deviceId,
    timestamp: event.timestamp ?? new Date().toISOString(),
    payload: toRecord(event.payload ?? {}),
    sourceProtocol: event.sourceProtocol ?? 'cli',
    sequenceId: event.sequenceId ?? device.events.length + 1,
  };
  db.devices[deviceId] = {
    ...device,
    events: [...device.events, canonical],
    auditRecords: [
      ...device.auditRecords,
      createAuditRecord({
        deviceId,
        type: 'POLICY_EVALUATION',
        data: { event: canonical, injected: true },
      }),
    ],
  };
  saveDatabase(cwd, db);
  io.stdout(`simulated event ${canonical.sequenceId} for ${deviceId}`);
  return 0;
}

function audit(args: readonly string[], io: CliIo, cwd: string): number {
  const deviceId = args[0];
  if (deviceId === undefined) {
    throw new Error('usage: aegis audit <device-id> [--last N]');
  }
  const lastIndex = args.indexOf('--last');
  const limit = lastIndex >= 0 ? Number(args[lastIndex + 1] ?? 10) : 10;
  const device = requireDevice(loadDatabase(cwd), deviceId);
  const blocks = buildAuditChain(device.auditRecords);
  const validity = verifyChain(blocks);
  const records = device.auditRecords.slice(-limit);
  io.stdout(
    JSON.stringify(
      {
        deviceId,
        chainValid: validity === null,
        records,
      },
      null,
      2,
    ),
  );
  return 0;
}

function policy(args: readonly string[], io: CliIo, cwd: string): number {
  const [subcommand, ruleFile, stateJson] = args;
  if (subcommand !== 'check' || ruleFile === undefined || stateJson === undefined) {
    throw new Error('usage: aegis policy check <rule-file> <state-json>');
  }
  const rule = parseRuleDefinition(readFileSync(resolve(cwd, ruleFile), 'utf8'));
  const state = readStateInput(cwd, stateJson);
  const matches = new RetePolicyEngine([rule]).evaluate(state);
  const decision = resolveConflicts(matches.map((match) => match.action));
  io.stdout(JSON.stringify({ matches, decision }, null, 2));
  return 0;
}

function requireDevice(db: CliDatabase, deviceId: string): CliDeviceRecord {
  const device = db.devices[deviceId];
  if (device === undefined) {
    throw new Error(`unknown device: ${deviceId}`);
  }
  return device;
}

function readStateInput(cwd: string, stateJson: string): Record<string, unknown> {
  const path = resolve(cwd, stateJson);
  const content = existsSync(path) ? readFileSync(path, 'utf8') : stateJson;
  return toRecord(JSON.parse(content));
}

function toRecord(value: unknown): Record<string, unknown> {
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  throw new Error('Expected JSON object');
}
