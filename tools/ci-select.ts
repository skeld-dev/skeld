// Does:  Chooses the CI jobs a pull request needs from its changed paths, with the test catalog as the script list.
// Holds: A path no rule claims selects every job, so a change is never left unchecked by omission.

import { appendFileSync, readFileSync } from 'node:fs';

const jobs = [
  'static',
  'codeql',
  'quick',
  'database',
  'protocol',
  'extended',
  'tooling',
  'docs',
  'examples',
  'consumer',
  'website',
] as const;
type Job = (typeof jobs)[number];
type TestJob = 'quick' | 'database' | 'protocol' | 'extended' | 'tooling';

const everything: readonly Job[] = [
  'static',
  'codeql',
  'quick',
  'database',
  'protocol',
  'extended',
  'tooling',
  'docs',
  'examples',
  'website',
];
// Why: The database and protocol rigs (tests/auth/rig/v1-app.ts, oidc-app.ts) import nearly every auth subpath.
const auth: readonly Job[] = [
  'static',
  'codeql',
  'quick',
  'database',
  'protocol',
  'extended',
  'tooling',
  'docs',
  'examples',
];
// Why: tests/support/support-log.ts and tests/logging/log-destination.ts run scripts from benchmarks/logging.
const benchmarks: readonly Job[] = ['static', 'quick', 'extended'];
// Why: The site build resolves links to these files (website/src/build/docs-links.ts) and reads LICENSE.
const siteLinked =
  /^(?:examples\/.*|(?:tests|benchmarks)\/README\.md|packages\/core\/README\.md|CONTRIBUTING\.md|LICENSE)$/;
const groupJobs: Readonly<Record<string, TestJob>> = {
  runtime: 'quick',
  database: 'database',
  protocol: 'protocol',
  extended: 'extended',
  tooling: 'tooling',
};

// Does:  Reads the catalog's suites into a map from script path to the job that runs its group.
function scriptJobs(module: unknown): ReadonlyMap<string, TestJob> {
  const suites = typeof module === 'object' && module !== null ? Reflect.get(module, 'suites') : undefined;
  if (typeof suites !== 'object' || suites === null) {
    throw new Error('tests/support/suites.ts exports no suites object');
  }
  const map = new Map<string, TestJob>();
  for (const [group, scripts] of Object.entries(suites)) {
    const job = groupJobs[group];
    if (!Object.hasOwn(groupJobs, group) || job === undefined) {
      throw new Error(`tests/support/suites.ts group ${group} has no CI job`);
    }
    if (!Array.isArray(scripts) || !scripts.every((script) => typeof script === 'string')) {
      throw new Error(`tests/support/suites.ts group ${group} is not a list of script paths`);
    }
    for (const script of scripts) {
      map.set(script, job);
    }
  }
  return map;
}

// Does:  Names the jobs one test path needs: its catalog group, or every group of its folder for a fixture or rig.
function testJobs(script: string, scripts: ReadonlyMap<string, TestJob>): readonly Job[] {
  const owner = scripts.get(script);
  if (owner !== undefined) {
    return ['static', owner];
  }
  const slash = script.indexOf('/');
  const folder = script.slice(0, slash + 1);
  const owners = [...scripts].filter(([path]) => slash > 0 && path.startsWith(folder)).map(([, job]) => job);
  return owners.length === 0 ? everything : ['static', ...new Set(owners)];
}

// Does:  Names the jobs one changed path needs; documentation selects only the documentation checks and the site.
function pathJobs(path: string, scripts: ReadonlyMap<string, TestJob>): readonly Job[] {
  const site: readonly Job[] = siteLinked.test(path) ? ['website'] : [];
  if (path.startsWith('docs/')) {
    return path.endsWith('.md') ? ['docs', 'consumer', 'website'] : ['docs', 'website'];
  }
  if (path.endsWith('.md')) {
    return ['docs', ...site];
  }
  const [top, next] = path.split('/');
  switch (top) {
    case 'LICENSE':
      return site;
    case 'website':
      return ['static', 'website'];
    case 'examples':
      return ['static', 'codeql', 'docs', 'examples', 'website'];
    case 'benchmarks':
      return benchmarks;
    case 'tests':
      return testJobs(path.slice('tests/'.length), scripts);
    case 'packages':
      return next === 'core' || next === 'auth' ? auth : everything;
    case '.semgrep':
      return ['static', 'codeql'];
    default:
      return everything;
  }
}

// Does:  Turns changed paths into the job set; an empty diff selects nothing.
function select(changed: readonly string[], catalog: ReadonlyMap<string, TestJob>, all: boolean): Record<Job, boolean> {
  const wanted = new Set<Job>(all ? everything : changed.flatMap((path) => pathJobs(path, catalog)));
  return {
    static: wanted.has('static'),
    codeql: wanted.has('codeql'),
    quick: wanted.has('quick'),
    database: wanted.has('database'),
    protocol: wanted.has('protocol'),
    extended: wanted.has('extended'),
    tooling: wanted.has('tooling'),
    docs: wanted.has('docs'),
    examples: wanted.has('examples'),
    // Why: The tooling group already runs the consumer declaration check on its own packed artifacts.
    consumer: wanted.has('consumer') && !wanted.has('tooling'),
    website: wanted.has('website'),
  };
}

const args = process.argv.slice(2);
if (args.length > 1 || (args.length === 1 && args[0] !== '--all')) {
  process.stderr.write('usage: node tools/ci-select.ts [--all] < changed paths, NUL- or newline-separated\n');
  process.exit(2);
}
const allJobs = args[0] === '--all';
const changedPaths = allJobs
  ? []
  : readFileSync(0, 'utf8')
      .split(/[\0\n]/)
      .filter((path) => path !== '');
const scriptMap = scriptJobs(await import(new URL('../tests/support/suites.ts', import.meta.url).href));
for (const path of changedPaths) {
  process.stdout.write(`${path}: ${pathJobs(path, scriptMap).join(' ') || 'nothing'}\n`);
}
const selected = select(changedPaths, scriptMap, allJobs);
process.stdout.write(`selected: ${jobs.filter((job) => selected[job]).join(' ') || 'nothing'}\n`);
const output = process.env.GITHUB_OUTPUT;
if (output !== undefined) {
  appendFileSync(output, `${jobs.map((job) => `${job}=${selected[job]}`).join('\n')}\n`);
}
