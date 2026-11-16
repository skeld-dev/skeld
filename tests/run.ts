// Does:  Runs correctness scripts by category, with explicit modes for diagnostics and external integrations.
// Holds: Each script gets its own process; missing scripts, timeouts and nonzero exits fail the run.

import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const categories = ['security', 'browser', 'lifecycle', 'contracts', 'schema', 'logging', 'auth'];
const fixtures = new Set([
  'corpus.ts',
  'diverse-fixture.ts',
  'log-collector.ts',
  'log-destination.ts',
  'support-store.ts',
]);
const diagScripts = [
  'security/malformed-path.ts',
  'security/prototype-poisoning.ts',
  'security/body-limit.ts',
  'contracts/response-filter.ts',
  'security/error-leak.ts',
  'security/duplicate-host.ts',
  'contracts/exports-boundary.ts',
];
const [mode = 'all', ...args] = process.argv.slice(2);

function scriptsFor(): string[] {
  if (mode === 'diag' && args.length === 0) {
    return diagScripts;
  }
  if (mode === 'collector' && args.length === 2 && args[0] === '--collector' && args[1]) {
    return ['logging/log-collector.ts'];
  }
  if (mode === 'destination' && args.length === 0) {
    return ['logging/log-destination.ts'];
  }
  if (args.length !== 0 || (mode !== 'all' && !categories.includes(mode))) {
    throw new Error(`Usage: pnpm test [all|${categories.join('|')}|diag|collector --collector <path>|destination]`);
  }
  return (mode === 'all' ? categories : [mode]).flatMap((category) => {
    const scripts = readdirSync(new URL(`${category}/`, import.meta.url))
      .filter((name) => name.endsWith('.ts') && !fixtures.has(name))
      .sort()
      .map((name) => `${category}/${name}`);
    if (scripts.length === 0) {
      throw new Error(`No tests found in ${category}`);
    }
    return scripts;
  });
}

let failed = 0;
const scripts = scriptsFor();
for (const script of scripts) {
  const dir = mode === 'diag' ? mkdtempSync(join(tmpdir(), 'skeld-suite-diag-')) : undefined;
  const flags = ['--conditions=skeld-source'];
  if (dir !== undefined) {
    flags.push('--conditions=skeld-diag');
  }
  if (script === 'schema/no-codegen.ts') {
    flags.push('--disallow-code-generation-from-strings');
  }
  try {
    const result = spawnSync(process.execPath, [...flags, fileURLToPath(new URL(script, import.meta.url)), ...args], {
      encoding: 'utf8',
      timeout: 600_000,
      maxBuffer: 16 * 1024 * 1024,
      env: dir === undefined ? process.env : { ...process.env, SKELD_DIAG_DIR: dir },
    });
    process.stdout.write(`${script}: ${result.stdout?.trim() ?? ''}\n`);
    if (result.status !== 0) {
      failed++;
      process.stderr.write(
        `${script}: exit ${result.status ?? result.signal}\n${result.error ?? ''}\n${result.stderr}`,
      );
    }
  } finally {
    if (dir !== undefined) {
      rmSync(dir, { recursive: true, force: true });
    }
  }
}
process.stdout.write(`${scripts.length - failed} of ${scripts.length} scripts passed\n`);
process.exitCode = failed === 0 ? 0 : 1;
