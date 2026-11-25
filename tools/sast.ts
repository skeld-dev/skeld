// Does:  Runs the pull request's static analysis locally: Semgrep's project rules and CodeQL with the shared config.
// Holds: Exits 0 only when Semgrep passes and no CodeQL result is left without an in-source suppression.

import { spawnSync } from 'node:child_process';
import { mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { totalmem } from 'node:os';
import { join } from 'node:path';

// Why: A different CLI or query pack version is a different analysis, so a clean local run would not predict CI.
const codeqlVersion = '2.27.4';
const semgrepVersion = '1.182.1';
const root = new URL('..', import.meta.url).pathname;
const work = join(root, '.sast/codeql');
const languages = ['javascript-typescript', 'actions'];
// Why: The CLI sizes its heap from free memory and runs out on a busy host; this is the action's sizing (src/util.ts).
const totalMiB = totalmem() / 2 ** 20;
const ram = `--ram=${Math.floor(totalMiB - 1024 - 0.05 * Math.max(totalMiB - 8192, 0))}`;

function installed(command: string, args: readonly string[], wanted: string, install: string): boolean {
  const probe = spawnSync(command, args, { encoding: 'utf8' });
  if (probe.error !== undefined || probe.status !== 0) {
    process.stderr.write(`${command} is not installed: ${install}\n`);
    return false;
  }
  const found = probe.stdout.trim().split('\n').at(-1) ?? '';
  if (found !== wanted) {
    process.stderr.write(`${command} ${found} is installed, CI uses ${wanted}: ${install}\n`);
    return false;
  }
  return true;
}

function run(command: string, args: readonly string[]): boolean {
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit' });
  return result.error === undefined && result.status === 0;
}

// Why: Database creation logs every extracted file; the log matters only when extraction fails.
function runQuietly(command: string, args: readonly string[]): boolean {
  const result = spawnSync(command, args, { cwd: root, encoding: 'utf8', maxBuffer: 256 * 2 ** 20 });
  const passed = result.error === undefined && result.status === 0;
  if (!passed) {
    process.stderr.write(`${result.stdout ?? ''}${result.stderr ?? ''}${result.error?.message ?? ''}\n`);
  }
  return passed;
}

// Does:  The fields of a CodeQL SARIF 2.1.0 result this script reads.
interface SarifResult {
  readonly ruleId: string;
  readonly message: { readonly text: string };
  readonly locations?: readonly {
    readonly physicalLocation?: {
      readonly artifactLocation?: { readonly uri?: string };
      readonly region?: { readonly startLine?: number };
    };
  }[];
  readonly suppressions?: readonly unknown[];
}

// Does:  Prints each CodeQL result not suppressed in source as path:line and rule id, and counts them.
function report(sarifDir: string): number {
  let count = 0;
  for (const file of readdirSync(sarifDir).filter((name) => name.endsWith('.sarif'))) {
    const sarif: unknown = JSON.parse(readFileSync(join(sarifDir, file), 'utf8'));
    const runs: unknown = typeof sarif === 'object' && sarif !== null ? Reflect.get(sarif, 'runs') : undefined;
    if (!Array.isArray(runs)) {
      throw new Error(`${file} is not a SARIF log`);
    }
    const results: readonly SarifResult[] = runs.flatMap((sarifRun) => sarifRun.results ?? []);
    for (const result of results) {
      if ((result.suppressions?.length ?? 0) > 0) {
        continue;
      }
      const location = result.locations?.[0]?.physicalLocation;
      const where = `${location?.artifactLocation?.uri ?? '?'}:${location?.region?.startLine ?? '?'}`;
      process.stdout.write(`${where} ${result.ruleId} ${result.message.text.split('\n')[0]}\n`);
      count++;
    }
  }
  return count;
}

const cli = process.argv.slice(2);
if (cli.length === 2 && cli[0] === '--sarif' && cli[1] !== undefined) {
  const findings = report(cli[1]);
  process.stdout.write(`CodeQL: ${findings} unsuppressed result(s)\n`);
  process.exit(findings === 0 ? 0 : 1);
}
if (cli.length > 0) {
  process.stderr.write('usage: node tools/sast.ts [--sarif <directory of CodeQL SARIF files>]\n');
  process.exit(2);
}

const codeqlInstall = `download codeql-bundle-v${codeqlVersion} from https://github.com/github/codeql-action/releases and put its codeql on PATH`;
const semgrepInstall = `pipx install semgrep==${semgrepVersion}`;
const ready = [
  installed('semgrep', ['--version'], semgrepVersion, semgrepInstall),
  installed('codeql', ['version', '--format=terse'], codeqlVersion, codeqlInstall),
];
if (ready.includes(false)) {
  process.exit(1);
}

process.stdout.write('Semgrep: project rules on core, auth and openapi sources\n');
const semgrep = run('semgrep', [
  'scan',
  '--metrics=off',
  '--project-root',
  '.',
  '--config',
  '.semgrep',
  '--error',
  'packages/core/src',
  'packages/auth/src',
  'packages/openapi/src',
]);

process.stdout.write('CodeQL: building databases\n');
mkdirSync(work, { recursive: true });
const database = join(work, 'db');
const created = runQuietly('codeql', [
  'database',
  'create',
  database,
  '--quiet',
  '--db-cluster',
  '--overwrite',
  `--language=${languages.join(',')}`,
  '--build-mode=none',
  '--codescanning-config=.github/codeql/codeql-config.yml',
  `--source-root=${root}`,
  '--threads=0',
  ram,
]);
const sarifOut = join(work, 'sarif');
mkdirSync(sarifOut, { recursive: true });
let analysed = created;
for (const language of created ? languages : []) {
  const extractor = language === 'javascript-typescript' ? 'javascript' : language;
  process.stdout.write(`CodeQL: analysing ${language}\n`);
  analysed &&= run('codeql', [
    'database',
    'analyze',
    join(database, extractor),
    '--quiet',
    '--format=sarif-latest',
    `--output=${join(sarifOut, `${extractor}.sarif`)}`,
    '--threads=0',
    ram,
  ]);
}
const findings = analysed ? report(sarifOut) : 0;
process.stdout.write(
  `Semgrep: ${semgrep ? 'passed' : 'failed'}; CodeQL: ${analysed ? `${findings} unsuppressed result(s)` : 'did not complete'}\n`,
);
process.exit(semgrep && analysed && findings === 0 ? 0 : 1);
