// Does:  Parses and checks the benchmark's command-line options.
// Holds: A value outside its range is a usage error with exit 2; nothing starts on a bad option.

import { statSync } from 'node:fs';
import { resolve } from 'node:path';
import { BenchError, errorCode } from './bench-error.ts';
import type { LoggingSession, RouteId, RunOptions, ServerId } from './types.ts';
import {
  defaultCpuN,
  defaultDurationSeconds,
  defaultOut,
  defaultPipelining,
  defaultRounds,
  defaultStepN,
  defaultWarmUpSeconds,
  durationRange,
  loggingRounds,
  pipeliningRange,
  roundsRange,
  stepRange,
} from './values.ts';

export const helpText = `Usage: node benchmarks/run.ts [options]

Measures skeld on the hello and echo routes with autocannon on this machine,
and writes a report. The server runs on core 7
and the runner (autocannon's 3 workers) on cores 3-6, pinned with taskset.
The primary figure is the server's CPU time per request over the measured
window, with requests per second and p99 latency beside it.

Options:
  --pipelining <n>   requests in flight per connection, 1 to 100 (default 1)
  --warm-up <s>      discarded warm-up seconds per route, 1 to 600 (default 3)
  --duration <s>     measured seconds per route, 1 to 600 (default 10)
  --rounds <n>       measured rounds per server and route, 1 to 50 (default 3)
  --servers <list>   skeld only (default skeld)
  --routes <list>    hello,echo (default both)
  --out <dir>        folder for the run's report (default benchmarks/results)
  --check            start skeld, check its answers, measure nothing
  --diag             measure skeld's normal and diag builds side by side,
                     then run the security scenario; skeld only; with
                     --check, the start checks and the scenario only
  --step-n <n>       diag build: time the steps of 1 in n requests, 1 to 1024
                     (default 8; needs --diag)
  --cpu-n <n>        diag build: read CPU on 1 in n requests, 1 to 1024
                     (default 32; needs --diag)
  --logging          the logging session: the commit before the feature
                     twice (before-a, before-b) beside the variants off,
                     default and access, judged by round-paired medians;
                     skeld only; needs --baseline
  --baseline <dir>   logging session: the worktree of the commit before the
                     feature, built; its benchmarks/servers/skeld.ts runs
                     from that folder (needs --logging)
  --control-only     logging session: before-a and before-b on echo only
                     (needs --logging)
  --against <file>   also measure one external server, started as
                     node <file> --port 0 from the file's folder and named
                     by its ready line; reports skeld's ratios to it as
                     measurements; with --check, checks both servers; not
                     with --diag or --logging
  --help             show this help

HTTP runs report measurements without a comparison verdict. Default settings
and pinning on a host with 8 or more vCPUs define the measurement protocol.
Diagnostic and logging sessions retain their separate overhead assessments.
`;

const defaultServerIds: readonly ServerId[] = ['skeld'];
export const routeIds: readonly RouteId[] = ['hello', 'echo'];

const valueOptions = [
  '--pipelining',
  '--warm-up',
  '--duration',
  '--rounds',
  '--servers',
  '--routes',
  '--out',
  '--step-n',
  '--cpu-n',
  '--baseline',
  '--against',
] as const;
type ValueOption = (typeof valueOptions)[number];
const flagOptions = ['--check', '--diag', '--logging', '--control-only', '--help'] as const;
type FlagOption = (typeof flagOptions)[number];

const wholeNumber = /^\d+$/;

const usage = (message: string): BenchError => new BenchError(2, message);

const isValueOption = (name: string): name is ValueOption => valueOptions.some((option) => option === name);
const isFlagOption = (name: string): name is FlagOption => flagOptions.some((option) => option === name);

const parseInteger = (name: string, text: string, range: { readonly min: number; readonly max: number }): number => {
  const value = Number(text);
  if (!wholeNumber.test(text) || value < range.min || value > range.max) {
    throw usage(`${name} must be a whole number from ${range.min} to ${range.max}, got "${text}".`);
  }
  return value;
};

const parseList = <T extends string>(name: string, text: string, allowed: readonly T[], noun: string): readonly T[] => {
  if (text === '') {
    throw usage(`${name} is empty.`);
  }
  const chosen: T[] = [];
  for (const item of text.split(',')) {
    const id = allowed.find((candidate) => candidate === item);
    if (id === undefined) {
      throw usage(`unknown ${noun} "${item}" in ${name}; choose from ${allowed.join(', ')}.`);
    }
    if (chosen.includes(id)) {
      throw usage(`${name} lists ${id} twice.`);
    }
    chosen.push(id);
  }
  return chosen;
};

const readValues = (argv: readonly string[]): { values: Map<ValueOption, string>; flags: Set<FlagOption> } => {
  const values = new Map<ValueOption, string>();
  const flags = new Set<FlagOption>();
  for (let index = 0; index < argv.length; index++) {
    const token = argv[index] ?? '';
    const equals = token.indexOf('=');
    const name = token.startsWith('--') && equals > 0 ? token.slice(0, equals) : token;
    if (name === token && isFlagOption(name)) {
      flags.add(name);
      continue;
    }
    if (!isValueOption(name)) {
      throw usage(`unknown option ${name}. Run node benchmarks/run.ts --help for the options.`);
    }
    let value: string | undefined;
    if (name === token) {
      value = argv[index + 1];
      index++;
    } else {
      value = token.slice(equals + 1);
    }
    if (value === undefined || value.startsWith('--')) {
      throw usage(`${name} needs a value.`);
    }
    if (values.has(name)) {
      throw usage(`${name} is given twice.`);
    }
    values.set(name, value);
  }
  return { values, flags };
};

const parseSampling = (
  name: '--step-n' | '--cpu-n',
  text: string | undefined,
  diag: boolean,
  fallback: number,
): number => {
  if (text === undefined) {
    return fallback;
  }
  if (!diag) {
    throw usage(`${name} needs --diag.`);
  }
  return parseInteger(name, text, stepRange);
};

const parseServers = (text: string | undefined): readonly ServerId[] =>
  text === undefined ? defaultServerIds : parseList('--servers', text, defaultServerIds, 'server');

const parseLogging = (
  values: ReadonlyMap<ValueOption, string>,
  flags: ReadonlySet<FlagOption>,
): LoggingSession | null => {
  const baseline = values.get('--baseline');
  const controlOnly = flags.has('--control-only');
  if (!flags.has('--logging')) {
    if (baseline !== undefined || controlOnly) {
      throw usage(`${baseline === undefined ? '--control-only' : '--baseline'} needs --logging.`);
    }
    return null;
  }
  if (flags.has('--diag')) {
    throw usage('--logging and --diag are separate sessions; choose one.');
  }
  const fixed = ['--servers', '--routes'] as const;
  const given = fixed.find((name) => values.has(name));
  if (given !== undefined) {
    throw usage(`the logging session sets its own entrants and routes; remove ${given}.`);
  }
  if (baseline === undefined) {
    throw usage('--logging needs --baseline <dir>, the built worktree of the commit before the feature.');
  }
  return { baseline: resolve(baseline), controlOnly };
};

const parseAgainst = (text: string | undefined, flags: ReadonlySet<FlagOption>): string | null => {
  if (text === undefined) {
    return null;
  }
  const session = (['--diag', '--logging'] as const).find((name) => flags.has(name));
  if (session !== undefined) {
    throw usage(`--against compares plain HTTP runs; it cannot be combined with ${session}.`);
  }
  const file = resolve(text);
  let isFile: boolean;
  try {
    isFile = statSync(file).isFile();
  } catch (error) {
    const code = errorCode(error);
    if (code === null) {
      throw error;
    }
    throw usage(`--against ${text}: cannot read ${file} (${code}).`);
  }
  if (!isFile) {
    throw usage(`--against ${text}: ${file} is not a file.`);
  }
  return file;
};

const parseRounds = (text: string | undefined, logging: LoggingSession | null): number => {
  if (text !== undefined) {
    return parseInteger('--rounds', text, roundsRange);
  }
  if (logging === null) {
    return defaultRounds;
  }
  if (loggingRounds === null) {
    throw usage('the logging round count is not measured yet; give --rounds <n>.');
  }
  return loggingRounds;
};

const parseRoutes = (logging: LoggingSession | null, text: string | undefined): readonly RouteId[] => {
  if (logging !== null) {
    return logging.controlOnly ? ['echo'] : routeIds;
  }
  return text === undefined ? routeIds : parseList('--routes', text, routeIds, 'route');
};

export function wantsHelp(argv: readonly string[]): boolean {
  return argv.includes('--help');
}

export function parseOptions(argv: readonly string[]): RunOptions {
  const { values, flags } = readValues(argv);
  const diag = flags.has('--diag');
  const logging = parseLogging(values, flags);
  const against = parseAgainst(values.get('--against'), flags);
  const pipelining = values.get('--pipelining');
  const warmUp = values.get('--warm-up');
  const duration = values.get('--duration');
  const routes = values.get('--routes');
  return {
    pipelining:
      pipelining === undefined ? defaultPipelining : parseInteger('--pipelining', pipelining, pipeliningRange),
    warmUpSeconds: warmUp === undefined ? defaultWarmUpSeconds : parseInteger('--warm-up', warmUp, durationRange),
    durationSeconds:
      duration === undefined ? defaultDurationSeconds : parseInteger('--duration', duration, durationRange),
    rounds: parseRounds(values.get('--rounds'), logging),
    servers: logging === null ? parseServers(values.get('--servers')) : ['skeld'],
    routes: parseRoutes(logging, routes),
    out: values.get('--out') ?? defaultOut,
    check: flags.has('--check'),
    diag,
    logging,
    against,
    stepN: parseSampling('--step-n', values.get('--step-n'), diag, defaultStepN),
    cpuN: parseSampling('--cpu-n', values.get('--cpu-n'), diag, defaultCpuN),
  };
}
