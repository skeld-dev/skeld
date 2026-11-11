import { BenchError } from './bench-error.ts';
import type { RouteId, RunOptions, ServerId } from './types.ts';
import {
  defaultCpuN,
  defaultDurationSeconds,
  defaultOut,
  defaultPipelining,
  defaultRounds,
  defaultStepN,
  defaultWarmUpSeconds,
  durationRange,
  pipeliningRange,
  roundsRange,
  stepRange,
} from './values.ts';

export const helpText = `Usage: node benchmarks/run.ts [options]

Measures DarkStart, Fastify and node:http on the same two routes with
autocannon on this machine, and writes a report. Each server runs on core 7
and the runner (autocannon's 3 workers) on cores 3-6, pinned with taskset.
The judged figure is the server's CPU time per request over the measured
window, with requests per second and p99 latency beside it.

Options:
  --pipelining <n>   requests in flight per connection, 1 to 100 (default 1;
                     10 gives the fastify.dev profile, which gets no verdict)
  --warm-up <s>      discarded warm-up seconds per route, 1 to 600 (default 3)
  --duration <s>     measured seconds per route, 1 to 600 (default 10)
  --rounds <n>       measured rounds per server and route, 1 to 50 (default 3)
  --servers <list>   darkstart,fastify,node-http,hono,express,light
                     (default darkstart,fastify,node-http)
  --routes <list>    hello,echo (default both)
  --out <dir>        folder for the run's report (default benchmarks/results)
  --check            start each server, check its answers, measure nothing
  --diag             measure DarkStart's normal and diag builds side by side,
                     then run the security scenario; darkstart only; with
                     --check, the start checks and the scenario only
  --step-n <n>       diag build: time the steps of 1 in n requests, 1 to 1024
                     (default 8; needs --diag)
  --cpu-n <n>        diag build: read CPU on 1 in n requests, 1 to 1024
                     (default 32; needs --diag)
  --help             show this help

Only a run with every default, pinned on a host with 8 or more vCPUs, is the
acceptance protocol and gets a verdict. In diag mode the same rule decides
whether the overhead ratio is assessed.
`;

export const defaultServerIds: readonly ServerId[] = ['darkstart', 'fastify', 'node-http'];
const serverIds: readonly ServerId[] = [...defaultServerIds, 'hono', 'express', 'light'];
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
] as const;
type ValueOption = (typeof valueOptions)[number];
const flagOptions = ['--check', '--diag', '--help'] as const;
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

const parseServers = (text: string | undefined, diag: boolean): readonly ServerId[] => {
  if (text === undefined) {
    return diag ? ['darkstart'] : defaultServerIds;
  }
  const servers = parseList('--servers', text, serverIds, 'server');
  const other = diag ? servers.find((server) => server !== 'darkstart') : undefined;
  if (other !== undefined) {
    throw usage(
      `diag mode measures only darkstart; got "${other}" in --servers. Remove --servers or set it to darkstart.`,
    );
  }
  return servers;
};

export function wantsHelp(argv: readonly string[]): boolean {
  return argv.includes('--help');
}

export function parseOptions(argv: readonly string[]): RunOptions {
  const { values, flags } = readValues(argv);
  const diag = flags.has('--diag');
  const pipelining = values.get('--pipelining');
  const warmUp = values.get('--warm-up');
  const duration = values.get('--duration');
  const rounds = values.get('--rounds');
  const routes = values.get('--routes');
  return {
    pipelining:
      pipelining === undefined ? defaultPipelining : parseInteger('--pipelining', pipelining, pipeliningRange),
    warmUpSeconds: warmUp === undefined ? defaultWarmUpSeconds : parseInteger('--warm-up', warmUp, durationRange),
    durationSeconds:
      duration === undefined ? defaultDurationSeconds : parseInteger('--duration', duration, durationRange),
    rounds: rounds === undefined ? defaultRounds : parseInteger('--rounds', rounds, roundsRange),
    servers: parseServers(values.get('--servers'), diag),
    routes: routes === undefined ? routeIds : parseList('--routes', routes, routeIds, 'route'),
    out: values.get('--out') ?? defaultOut,
    check: flags.has('--check'),
    diag,
    stepN: parseSampling('--step-n', values.get('--step-n'), diag, defaultStepN),
    cpuN: parseSampling('--cpu-n', values.get('--cpu-n'), diag, defaultCpuN),
  };
}
