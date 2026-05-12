#!/usr/bin/env node
import { runCli } from './commands';

if (require.main === module) {
  void runCli(
    process.argv.slice(2),
    {
      stdout: (message) => {
        process.stdout.write(`${message}\n`);
      },
      stderr: (message) => {
        process.stderr.write(`${message}\n`);
      },
    },
    process.cwd(),
  ).then((code) => {
    process.exitCode = code;
  });
}

export * from './commands';
export * from './storage';
