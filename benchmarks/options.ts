import { BenchError } from './bench-error.ts';
import type { RouteId, RunOptions, ServerId } from './types.ts';
import {
  defaultDurationSeconds,
  defaultOut,
  defaultPipelining,
  defaultRounds,
  durationRange,
  pipeliningRange,
  roundsRange,
} from './values.ts';

export const helpText = `Usage: node benchmarks/run.ts [options]

Measures DarkStart, Fastify and node:http on the same two routes with
autocannon on this machine, and writes a report.

Options:
  --pipelining <n>   requests in flight per connection, 1 to 100 (default 10)
  --duration <s>     seconds per round, 1 to 600 (default 10)
  --rounds <n>       measured rounds per server and route, 1 to 50 (default 5)
  --servers <list>   darkstart,fastify,node-http (default all three)
  --routes <list>    hello,echo (default both)
  --out <dir>        folder for the run's report (default benchmarks/results)
  --check            start each server, check its answers, measure nothing
  --help             show this help

Only a run with every default is the acceptance protocol and gets a verdict.
`;

export const serverIds: readonly ServerId[] = ['darkstart', 'fastify', 'node-http'];
export const routeIds: readonly RouteId[] = ['hello', 'echo'];

const valueOptions = ['--pipelining', '--duration', '--rounds', '--servers', '--routes', '--out'] as const;
type ValueOption = (typeof valueOptions)[number];
const flagOptions = ['--check', '--help'] as const;

const wholeNumber = /^\d+$/;

const usage = (message: string): BenchError => new BenchError(2, message);

const isValueOption = (name: string): name is ValueOption => valueOptions.some((option) => option === name);
const isFlagOption = (name: string): boolean => flagOptions.some((option) => option === name);

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

const readValues = (argv: readonly string[]): { values: Map<ValueOption, string>; check: boolean } => {
  const values = new Map<ValueOption, string>();
  let check = false;
  for (let index = 0; index < argv.length; index++) {
    const token = argv[index] ?? '';
    const equals = token.indexOf('=');
    const name = token.startsWith('--') && equals > 0 ? token.slice(0, equals) : token;
    if (name === token && isFlagOption(name)) {
      check ||= name === '--check';
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
  return { values, check };
};

export function wantsHelp(argv: readonly string[]): boolean {
  return argv.includes('--help');
}

export function parseOptions(argv: readonly string[]): RunOptions {
  const { values, check } = readValues(argv);
  const pipelining = values.get('--pipelining');
  const duration = values.get('--duration');
  const rounds = values.get('--rounds');
  const servers = values.get('--servers');
  const routes = values.get('--routes');
  return {
    pipelining:
      pipelining === undefined ? defaultPipelining : parseInteger('--pipelining', pipelining, pipeliningRange),
    durationSeconds:
      duration === undefined ? defaultDurationSeconds : parseInteger('--duration', duration, durationRange),
    rounds: rounds === undefined ? defaultRounds : parseInteger('--rounds', rounds, roundsRange),
    servers: servers === undefined ? serverIds : parseList('--servers', servers, serverIds, 'server'),
    routes: routes === undefined ? routeIds : parseList('--routes', routes, routeIds, 'route'),
    out: values.get('--out') ?? defaultOut,
    check,
  };
}
