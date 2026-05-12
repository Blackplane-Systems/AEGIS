import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { CanonicalEvent } from '../../protocol/src';
import { AuditRecord, StructuredAuditLog } from '../../runtime/src';
import { DeviceIdentity, TrustState } from '../../trust/src';

/** CLI-persisted device record. */
export interface CliDeviceRecord {
  readonly deviceId: string;
  readonly identity: DeviceIdentity;
  readonly privateKeyPem: string;
  readonly state: TrustState;
  readonly trust: number;
  readonly auditRecords: readonly AuditRecord[];
  readonly events: readonly CanonicalEvent[];
}

/** CLI local state database. */
export interface CliDatabase {
  readonly devices: Record<string, CliDeviceRecord>;
}

/** Resolves the local CLI state file. */
export function stateFile(cwd: string): string {
  return join(cwd, '.aegis', 'state.json');
}

/** Loads CLI state from the workspace. */
export function loadDatabase(cwd: string): CliDatabase {
  const file = stateFile(cwd);
  if (!existsSync(file)) {
    return { devices: {} };
  }
  return JSON.parse(readFileSync(file, 'utf8')) as CliDatabase;
}

/** Saves CLI state to the workspace. */
export function saveDatabase(cwd: string, db: CliDatabase): void {
  const directory = join(cwd, '.aegis');
  mkdirSync(directory, { recursive: true });
  writeFileSync(stateFile(cwd), `${JSON.stringify(db, null, 2)}\n`);
}

/** Rebuilds an audit Merkle chain from stored append-only records. */
export function buildAuditChain(records: readonly AuditRecord[]) {
  const log = new StructuredAuditLog();
  for (const record of records) {
    log.append(record);
  }
  return log.blocks();
}
