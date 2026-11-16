// Does:  Runs correctness scripts by suite or category, with an explicit mode for diagnostics.
// Holds: Each script runs in its own process group; a timeout kills the group, and timeouts and nonzero exits fail.

import { type ChildProcess, spawn } from 'node:child_process';
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
// Why: The slowest script takes 15 to 20 s on the development host; 90 s leaves room for a slower CI runner.
const watchdogMs = 90_000;
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

interface Ran {
  code: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  leftovers: boolean;
}

let current: ChildProcess | null = null;

// Does:  Kills a script's whole process group; false when no process of the group was left.
function killGroup(pid: number): boolean {
  try {
    process.kill(-pid, 'SIGKILL');
    return true;
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ESRCH') {
      return false;
    }
    throw error;
  }
}

function runScript(argv: readonly string[], env: NodeJS.ProcessEnv): Promise<Ran> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, argv, { env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
    current = child;
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let leftovers = false;
    const kill = (): boolean => child.pid !== undefined && killGroup(child.pid);
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => {
      stderr += chunk;
    });
    const timer = setTimeout(() => {
      timedOut = true;
      kill();
    }, watchdogMs);
    child.once('error', reject);
    child.once('exit', () => {
      clearTimeout(timer);
      // Why: A fixture the script started can outlive it and hold the output pipes open, so its group dies with it.
      leftovers = !timedOut && kill();
    });
    child.once('close', (code, signal) => {
      current = null;
      resolve({ code, signal, stdout, stderr, timedOut, leftovers });
    });
  });
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    if (current?.pid !== undefined) {
      killGroup(current.pid);
    }
    process.exit(130);
  });
}

let failed = 0;
const scripts = scriptsFor();
const local = ['quick', 'runtime', 'protocol', 'extended', 'tooling', 'diag'].includes(mode);
const fewerSchemas = mode === 'quick' || mode === 'runtime';
if (list) {
  process.stdout.write(
    `${mode}: ${scripts.length} scripts; stores=${local ? 'sqlite' : 'both'}; schemas=${fewerSchemas ? '200' : 'all'}\n${scripts.join('\n')}\n`,
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
    fewerSchemas && ['schema/differential.ts', 'schema/serializer-differential.ts'].includes(script)
      ? ['--schemas', '200']
      : [];
  const scriptStarted = performance.now();
  try {
    // biome-ignore lint/performance/noAwaitInLoops: scripts run one at a time so their timings and ports stay their own
    const result = await runScript([...flags, fileURLToPath(new URL(script, import.meta.url)), ...scriptArgs], {
      ...process.env,
      SKELD_TEST_STORES: local ? 'sqlite' : 'both',
      ...(dir === undefined ? {} : { SKELD_DIAG_DIR: dir }),
    });
    process.stdout.write(`${script}: ${result.stdout.trim()}\n`);
    if (result.leftovers) {
      process.stderr.write(`${script}: killed processes it left running\n`);
    }
    if (result.timedOut || result.code !== 0) {
      failed++;
      const cause = result.timedOut
        ? `timed out after ${watchdogMs / 1000} s; its process group was killed`
        : `exit ${result.code ?? result.signal}`;
      process.stderr.write(`${script}: ${cause}\n${result.stderr}`);
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
