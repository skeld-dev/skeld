// Does:  Runs correctness scripts by suite or category, with an explicit mode for diagnostics.
// Holds: Each script gets its own process; missing scripts, timeouts and nonzero exits fail the run.

import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { allScripts, categories, selectScripts } from './support/suites.ts';

const fixtures = new Set(['corpus.ts', 'diverse-fixture.ts', 'support-store.ts']);
const diagScripts = [
  'security/malformed-path.ts',
  'security/prototype-poisoning.ts',
  'security/body-limit.ts',
  'security/error-leak.ts',
  'security/duplicate-host.ts',
];
const [mode = 'all', ...args] = process.argv.slice(2);
const list = args.length === 1 && args[0] === '--list';

// Why: Discovery detects forgotten registration; it never silently adds expensive work to the quick suite.
const discovered = categories.flatMap((category) =>
  readdirSync(new URL(`${category}/`, import.meta.url))
    .filter((name) => name.endsWith('.ts') && !fixtures.has(name))
    .map((name) => `${category}/${name}`),
);
if (
  new Set(allScripts).size !== allScripts.length ||
  [...discovered].sort().join('\n') !== [...allScripts].sort().join('\n')
) {
  throw new Error('Test inventory differs from tests/support/suites.ts; register or remove the script explicitly');
}

function scriptsFor(): readonly string[] {
  if (mode === 'diag' && (args.length === 0 || list)) {
    return diagScripts;
  }
  if (args.length !== 0 && !list) {
    throw new Error('Expected a selection with optional --list');
  }
  return selectScripts(mode);
}

let failed = 0;
const scripts = scriptsFor();
const local = ['quick', 'runtime', 'protocol', 'extended', 'tooling', 'diag'].includes(mode);
const profile = mode === 'exhaustive' ? 'exhaustive' : mode === 'quick' || mode === 'runtime' ? 'quick' : 'standard';
if (list) {
  process.stdout.write(
    `${mode}: ${scripts.length} scripts; stores=${local ? 'sqlite' : 'both'}; profile=${profile}\n${scripts.join('\n')}\n`,
  );
  process.exit(0);
}
if (!local && scripts.some((script) => script.startsWith('auth/')) && !process.env.SKELD_TEST_PG_URL) {
  throw new Error('This selection requires SKELD_TEST_PG_URL; use quick for the service-free suite');
}
const started = performance.now();
const timings: { script: string; seconds: number }[] = [];
for (const script of scripts) {
  const dir = mode === 'diag' ? mkdtempSync(join(tmpdir(), 'skeld-suite-diag-')) : undefined;
  const flags = ['--conditions=skeld-source'];
  if (dir !== undefined) {
    flags.push('--conditions=skeld-diag');
  }
  if (script === 'schema/no-codegen.ts') {
    flags.push('--disallow-code-generation-from-strings');
  }
  const scriptArgs =
    profile === 'quick' && ['schema/differential.ts', 'schema/serializer-differential.ts'].includes(script)
      ? ['--schemas', '200']
      : [];
  const scriptStarted = performance.now();
  try {
    const result = spawnSync(
      process.execPath,
      [...flags, fileURLToPath(new URL(script, import.meta.url)), ...scriptArgs],
      {
        encoding: 'utf8',
        timeout: 600_000,
        maxBuffer: 16 * 1024 * 1024,
        env: {
          ...process.env,
          SKELD_TEST_PROFILE: profile,
          SKELD_TEST_STORES: local ? 'sqlite' : 'both',
          ...(dir === undefined ? {} : { SKELD_DIAG_DIR: dir }),
        },
      },
    );
    process.stdout.write(`${script}: ${result.stdout?.trim() ?? ''}\n`);
    if (result.status !== 0) {
      failed++;
      process.stderr.write(
        `${script}: exit ${result.status ?? result.signal}\n${result.error ?? ''}\n${result.stderr}`,
      );
    }
  } finally {
    const seconds = (performance.now() - scriptStarted) / 1000;
    timings.push({ script, seconds });
    process.stdout.write(`timing ${script}: ${seconds.toFixed(2)} s\n`);
    if (dir !== undefined) {
      rmSync(dir, { recursive: true, force: true });
    }
  }
}
process.stdout.write(`${scripts.length - failed} of ${scripts.length} scripts passed\n`);
process.stdout.write(`Total ${(performance.now() - started).toFixed(0)} ms; slowest scripts:\n`);
for (const { script, seconds } of timings.sort((a, b) => b.seconds - a.seconds).slice(0, 10)) {
  process.stdout.write(`  ${seconds.toFixed(2)} s ${script}\n`);
}
process.exitCode = failed === 0 ? 0 : 1;
