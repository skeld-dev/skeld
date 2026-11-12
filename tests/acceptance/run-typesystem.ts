// Does:  Runs the type-system acceptance scripts in turn and reports how many passed.
// Holds: It exits non-zero unless every script passed; each script runs in its own process.

import { spawnSync } from 'node:child_process';

const scripts = [
  'sensitive-leak.ts',
  'derived-cap.ts',
  'body-limit-options.ts',
  'hostile-body.ts',
  'body-refusal.ts',
  'derived-class.ts',
  'response-contract.ts',
  'error-headers.ts',
  'timeouts.ts',
  'pipeline-refusal.ts',
  'json-depth.ts',
  'onsend-observe.ts',
  'client-response-limit.ts',
  'reserved-headers.ts',
  'handler-timeout.ts',
  'client-address.ts',
  'security-headers.ts',
  'audit-callbacks.ts',
  'audit-lifecycle.ts',
  'audit-lifecycle-races.ts',
  'audit-schema.ts',
  'audit-boundaries.ts',
  'audit-retention.ts',
  'redirects.ts',
  'cookie-read.ts',
  'cookie-contract.ts',
  'cookie-write.ts',
];

let failed = 0;
for (const script of scripts) {
  const result = spawnSync(process.execPath, ['--conditions=skeld-source', new URL(script, import.meta.url).pathname], {
    encoding: 'utf8',
    timeout: 120_000,
  });
  const passed = result.status === 0;
  process.stdout.write(`${script}: ${result.stdout.trim()}\n`);
  if (!passed) {
    failed++;
    process.stdout.write(`${script}: exit ${result.status ?? result.signal}\n${result.stderr}`);
  }
}
process.stdout.write(`${scripts.length - failed} of ${scripts.length} scripts passed\n`);
process.exitCode = failed === 0 ? 0 : 1;
