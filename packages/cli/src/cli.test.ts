import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runCli } from './index';

describe('aegis CLI harness', () => {
  let cwd: string;
  let stdout: string[];
  let stderr: string[];

  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), 'aegis-cli-'));
    stdout = [];
    stderr = [];
  });

  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true });
  });

  const io = () => ({
    stdout: (message: string) => stdout.push(message),
    stderr: (message: string) => stderr.push(message),
  });

  it('enrolls devices and prints status', async () => {
    expect(await runCli(['enroll', 'device-1'], io(), cwd)).toBe(0);
    expect(stdout[0]).toContain('state=PROVISIONED');
    expect(await runCli(['status', 'device-1'], io(), cwd)).toBe(0);
    const status = JSON.parse(stdout[1]!);
    expect(status.state).toBe('PROVISIONED');
    expect(status.permittedActions).toContain('attest');
  });

  it('simulates canonical events and prints audit chain validity', async () => {
    await runCli(['enroll', 'device-1'], io(), cwd);
    expect(
      await runCli(
        [
          'simulate-event',
          'device-1',
          '{"timestamp":"2026-01-01T00:00:00.000Z","payload":{"temp":21},"sequenceId":7}',
        ],
        io(),
        cwd,
      ),
    ).toBe(0);
    expect(stdout.at(-1)).toContain('simulated event 7');
    expect(await runCli(['audit', 'device-1', '--last', '2'], io(), cwd)).toBe(0);
    const audit = JSON.parse(stdout.at(-1)!);
    expect(audit.chainValid).toBe(true);
    expect(audit.records).toHaveLength(2);
  });

  it('dry-runs policy rules against state snapshots', async () => {
    writeFileSync(
      join(cwd, 'rule.json'),
      JSON.stringify({
        id: 'trust-block',
        when: { type: 'TRUST', op: '<', value: 0.75 },
        then: { kind: 'BLOCK' },
      }),
    );
    writeFileSync(join(cwd, 'state.json'), JSON.stringify({ trust: 0.2 }));
    expect(await runCli(['policy', 'check', 'rule.json', 'state.json'], io(), cwd)).toBe(0);
    const result = JSON.parse(stdout.at(-1)!);
    expect(result.matches[0].ruleId).toBe('trust-block');
    expect(result.decision.kind).toBe('BLOCK');
    expect(stderr).toEqual([]);
  });
});
