import { spawnSync } from 'node:child_process';

const scripts = [
  'malformed-path.ts',
  'prototype-poisoning.ts',
  'body-limit.ts',
  'response-filter.ts',
  'error-leak.ts',
  'duplicate-host.ts',
  'exports-boundary.ts',
];

let failed = 0;
for (const script of scripts) {
  const result = spawnSync(
    process.execPath,
    ['--conditions=darkstart-source', new URL(script, import.meta.url).pathname],
    { encoding: 'utf8', timeout: 60_000 },
  );
  const passed = result.status === 0;
  process.stdout.write(`${script}: ${result.stdout.trim()}\n`);
  if (!passed) {
    failed++;
    process.stdout.write(`${script}: exit ${result.status ?? result.signal}\n${result.stderr}`);
  }
}
process.stdout.write(`${scripts.length - failed} of ${scripts.length} scripts passed\n`);
process.exitCode = failed === 0 ? 0 : 1;
