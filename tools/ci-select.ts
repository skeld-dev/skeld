// Does:  Chooses the CI jobs a pull request needs from its changed paths, with the test catalog as the script list.
// Holds: A path no rule claims selects the full run, so a change is never left unchecked by omission.

import { appendFileSync, readFileSync } from 'node:fs';

const jobs = [
  'static',
  'quick',
  'database',
  'protocol',
  'extended',
  'tooling',
  'diag',
  'full',
  'docs',
  'examples',
  'consumer',
  'website',
] as const;
type Job = (typeof jobs)[number];
type TestJob = 'quick' | 'database' | 'protocol' | 'extended' | 'tooling';

// Why: The database and protocol rigs (tests/auth/rig/v1-app.ts, oidc-app.ts) import nearly every auth subpath.
const auth: readonly Job[] = ['quick', 'database', 'protocol', 'extended', 'tooling', 'docs', 'examples'];
const core: readonly Job[] = [...auth, 'diag'];
// Why: tests/support/support-log.ts runs benchmarks/logging; tests/security/benchmark-lock.ts imports its lock.
const benchmarks: readonly Job[] = ['quick', 'extended', 'tooling'];
const groupJobs: Readonly<Record<string, TestJob>> = {
  runtime: 'quick',
  database: 'database',
  protocol: 'protocol',
  extended: 'extended',
  tooling: 'tooling',
};

// Does:  Reads the catalog's suites into a map from script path to the job that runs its group.
function scriptJobs(module: unknown): ReadonlyMap<string, Job> {
  const suites = typeof module === 'object' && module !== null ? Reflect.get(module, 'suites') : undefined;
  if (typeof suites !== 'object' || suites === null) {
    throw new Error('tests/support/suites.ts exports no suites object');
  }
  const map = new Map<string, Job>();
  for (const [group, scripts] of Object.entries(suites)) {
    if (!Array.isArray(scripts) || !scripts.every((script) => typeof script === 'string')) {
      throw new Error(`tests/support/suites.ts group ${group} is not a list of script paths`);
    }
    for (const script of scripts) {
      map.set(script, Object.hasOwn(groupJobs, group) ? (groupJobs[group] ?? 'full') : 'full');
    }
  }
  return map;
}

function withDiag(owners: readonly Job[]): readonly Job[] {
  return owners.includes('quick') ? [...owners, 'diag'] : owners;
}

// Does:  Names the jobs one test path needs: its catalog group, or every group of its folder for a fixture or rig.
function testJobs(script: string, scripts: ReadonlyMap<string, Job>): readonly Job[] {
  if (script === 'README.md') {
    return ['website'];
  }
  const owner = scripts.get(script);
  if (owner !== undefined) {
    return withDiag([owner]);
  }
  const slash = script.indexOf('/');
  const folder = script.slice(0, slash + 1);
  const owners = [...scripts].filter(([path]) => slash > 0 && path.startsWith(folder)).map(([, job]) => job);
  return owners.length === 0 ? ['full'] : withDiag([...new Set(owners)]);
}

function pathJobs(path: string, scripts: ReadonlyMap<string, Job>): readonly Job[] {
  const [top, next] = path.split('/');
  switch (top) {
    case 'docs':
      return path.endsWith('.md') ? ['docs', 'consumer', 'website'] : ['docs', 'website'];
    case 'website':
      return ['website'];
    case 'examples':
      return ['docs', 'examples', 'website'];
    case '.semgrep':
      return ['tooling'];
    case 'benchmarks':
      return path === 'benchmarks/README.md' ? [...benchmarks, 'website'] : benchmarks;
    case 'tests':
      return testJobs(path.slice('tests/'.length), scripts);
    case 'packages':
      if (next === 'core') {
        return path === 'packages/core/README.md' ? [...core, 'website'] : core;
      }
      return next === 'auth' ? auth : ['full'];
    case 'CONTRIBUTING.md':
      return ['website'];
    case 'README.md':
    case 'LICENSE':
      return [];
    default:
      return ['full'];
  }
}

// Does:  Turns changed paths into the job set; the full run replaces the five group jobs, never runs beside them.
function select(
  changed: readonly string[],
  catalog: ReadonlyMap<string, Job>,
  everything: boolean,
): Record<Job, boolean> {
  const wanted = new Set<Job>(everything ? ['full'] : changed.flatMap((path) => pathJobs(path, catalog)));
  if (wanted.has('full')) {
    return {
      static: true,
      quick: false,
      database: false,
      protocol: false,
      extended: false,
      tooling: false,
      diag: true,
      full: true,
      docs: true,
      examples: true,
      consumer: false,
      website: true,
    };
  }
  return {
    static: changed.length > 0,
    quick: wanted.has('quick'),
    database: wanted.has('database'),
    protocol: wanted.has('protocol'),
    extended: wanted.has('extended'),
    tooling: wanted.has('tooling'),
    diag: wanted.has('diag'),
    full: false,
    docs: wanted.has('docs'),
    examples: wanted.has('examples'),
    // Why: The tooling group already runs the consumer declaration check on its own packed artifacts.
    consumer: wanted.has('consumer') && !wanted.has('tooling'),
    website: wanted.has('website'),
  };
}

const args = process.argv.slice(2);
if (args.length > 1 || (args.length === 1 && args[0] !== '--full')) {
  process.stderr.write('usage: node tools/ci-select.ts [--full] < changed paths, NUL- or newline-separated\n');
  process.exit(2);
}
const fullRun = args[0] === '--full';
const changedPaths = fullRun
  ? []
  : readFileSync(0, 'utf8')
      .split(/[\0\n]/)
      .filter((path) => path !== '');
const scriptMap = scriptJobs(await import(new URL('../tests/support/suites.ts', import.meta.url).href));
for (const path of changedPaths) {
  process.stdout.write(`${path}: ${pathJobs(path, scriptMap).join(' ') || 'static only'}\n`);
}
const selected = select(changedPaths, scriptMap, fullRun);
process.stdout.write(`selected: ${jobs.filter((job) => selected[job]).join(' ') || 'nothing'}\n`);
const output = process.env.GITHUB_OUTPUT;
if (output !== undefined) {
  appendFileSync(output, `${jobs.map((job) => `${job}=${selected[job]}`).join('\n')}\n`);
}
