// Does:  Runs the logging rig scripts in turn and reports how many passed.
// Holds: A script that does not exist counts as a failure, and the exit is non-zero unless every script passed.

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const scripts = [
  'log-redaction.ts',
  'log-boundaries.ts',
  'log-injection.ts',
  'log-lifecycle.ts',
  'log-correlation.ts',
  'log-errors.ts',
  'log-suppression.ts',
  'log-events.ts',
  'log-close.ts',
];

let failed = 0;
for (const script of scripts) {
  const path = fileURLToPath(new URL(script, import.meta.url));
  if (!existsSync(path)) {
    failed++;
    process.stdout.write(`${script}: fail the script does not exist\n${script}: exit missing\n`);
    continue;
  }
  const result = spawnSync(process.execPath, ['--conditions=skeld-source', path], {
    encoding: 'utf8',
    timeout: 600_000,
  });
  process.stdout.write(`${script}: ${result.stdout.trim()}\n`);
  if (result.status !== 0) {
    failed++;
    process.stdout.write(`${script}: exit ${result.status ?? result.signal}\n${result.stderr}`);
  }
}
process.stdout.write(`${scripts.length - failed} of ${scripts.length} scripts passed\n`);
process.exitCode = failed === 0 ? 0 : 1;
