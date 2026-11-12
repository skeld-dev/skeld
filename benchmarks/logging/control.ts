// Does:  Picks the logging round count from a control-only session: the medians of every window of each odd count.
// Holds: A count is chosen only when every window of that many consecutive rounds has its median inside the band.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { markdownTable } from '../report.ts';
import { loggingBuilds } from '../schedule.ts';
import { median } from '../statistics.ts';
import { displayPath } from '../terminal.ts';
import { type CpuSample, controlRatios } from './readout.ts';
import { roundCountBand, roundCountRange } from '../values.ts';

interface ControlRun {
  readonly folder: string;
  readonly id: string;
  readonly status: string;
  readonly rounds: number;
  readonly deviations: readonly string[];
  readonly samples: readonly CpuSample[];
}

interface CountRow {
  readonly count: number;
  readonly medians: readonly number[];
  readonly holds: boolean;
}

const usageText = 'Usage: node benchmarks/logging/control.ts <run folder> <output folder>';

const fail = (exitCode: 2 | 3, message: string): never => {
  process.stderr.write(`error: ${message}\n`);
  process.exit(exitCode);
};

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;

const field = (record: Record<string, unknown>, name: string): unknown => record[name];

const parseSample = (value: unknown, index: number): CpuSample => {
  const bad = (): never => fail(3, `samples[${index}] in results.json is not a benchmark sample.`);
  if (!isRecord(value)) {
    return bad();
  }
  const round = field(value, 'round');
  const kind = field(value, 'kind');
  const build = loggingBuilds.find((candidate) => candidate === field(value, 'build'));
  const route = field(value, 'route');
  const cpu = field(value, 'serverCpuMicrosecondsPerRequest');
  if (
    typeof round !== 'number' ||
    (kind !== 'warm-up' && kind !== 'measured') ||
    build === undefined ||
    (route !== 'hello' && route !== 'echo') ||
    (cpu !== null && typeof cpu !== 'number')
  ) {
    return bad();
  }
  return { round, kind, build, route, serverCpuMicrosecondsPerRequest: cpu };
};

const readRun = (folder: string): ControlRun => {
  let text: string;
  try {
    text = readFileSync(join(folder, 'results.json'), 'utf8');
  } catch (error) {
    return fail(
      3,
      `cannot read ${join(folder, 'results.json')}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  let run: unknown;
  try {
    run = JSON.parse(text);
  } catch (error) {
    return error instanceof SyntaxError
      ? fail(3, `results.json in ${basename(folder)} is not JSON.`)
      : fail(3, String(error));
  }
  const options = isRecord(run) ? field(run, 'options') : null;
  const logging = isRecord(options) ? field(options, 'logging') : null;
  if (!(isRecord(run) && isRecord(options) && isRecord(logging) && field(logging, 'controlOnly') === true)) {
    return fail(3, `${basename(folder)} is not a control-only logging session.`);
  }
  const id = field(run, 'id');
  const status = field(run, 'status');
  const rounds = field(options, 'rounds');
  const deviations = field(run, 'deviations');
  const samples = field(run, 'samples');
  if (
    typeof id !== 'string' ||
    typeof status !== 'string' ||
    typeof rounds !== 'number' ||
    !Array.isArray(deviations) ||
    !deviations.every((item) => typeof item === 'string') ||
    !Array.isArray(samples)
  ) {
    return fail(3, `results.json in ${basename(folder)} lacks its id, status, rounds, deviations or samples.`);
  }
  if (status !== 'complete') {
    return fail(3, `${id} ended ${status}; only a complete session gives every round its ratio.`);
  }
  return { folder: displayPath(folder), id, status, rounds, deviations, samples: samples.map(parseSample) };
};

const roundByRound = (run: ControlRun): readonly number[] => {
  const ratios = controlRatios(run.samples);
  return Array.from({ length: run.rounds }, (_, index) => {
    const found = ratios.find((paired) => paired.round === index + 1);
    return found === undefined ? fail(3, `round ${index + 1} of ${run.id} has no control ratio on echo.`) : found.ratio;
  });
};

const inBand = (value: number): boolean => value >= roundCountBand.min && value <= roundCountBand.max;

const countRows = (ratios: readonly number[]): readonly CountRow[] => {
  const rows: CountRow[] = [];
  for (let count = roundCountRange.min; count <= roundCountRange.max; count += 2) {
    const medians = Array.from({ length: Math.max(0, ratios.length - count + 1) }, (_, start) =>
      median(ratios.slice(start, start + count)),
    );
    rows.push({ count, medians, holds: medians.length > 0 && medians.every(inBand) });
  }
  return rows;
};

const bandText = `${roundCountBand.min.toFixed(2)} to ${roundCountBand.max.toFixed(2)}`;
const ratioText = (value: number): string => value.toFixed(4);

const resultLine = (chosen: CountRow | undefined): string =>
  chosen === undefined
    ? `NO-GO: no odd count from ${roundCountRange.min} to ${roundCountRange.max} keeps every window's median inside ${bandText}.`
    : `loggingRounds = ${chosen.count}: the smallest odd count from ${roundCountRange.min} to ${roundCountRange.max} whose every window's median is inside ${bandText}.`;

const render = (run: ControlRun, ratios: readonly number[], rows: readonly CountRow[], result: string): string =>
  [
    `# Logging round count from ${run.id}`,
    '',
    result,
    '',
    `Run folder: \`${run.folder}/\`, status ${run.status}, ${run.rounds} rounds of before-a and before-b on echo.`,
    '',
    `Protocol: ${run.deviations.length === 0 ? 'conforming' : run.deviations.join('; ')}.`,
    '',
    '## Control ratio per round (before-b over before-a, server CPU per request)',
    '',
    ...markdownTable(
      ['Round', 'Ratio'],
      ratios.map((ratio, index) => [String(index + 1), ratioText(ratio)]),
    ),
    '',
    '## Medians per round count',
    '',
    ...markdownTable(
      ['Rounds', 'Windows', 'Lowest window median', 'Highest window median', `Every window inside ${bandText}`],
      rows.map((row) => [
        String(row.count),
        String(row.medians.length),
        row.medians.length === 0 ? '-' : ratioText(Math.min(...row.medians)),
        row.medians.length === 0 ? '-' : ratioText(Math.max(...row.medians)),
        row.holds ? 'yes' : 'no',
      ]),
    ),
    '',
    'A window is a run of that many consecutive rounds; its median is the median of their control ratios.',
    '',
  ].join('\n');

const [runArgument, outArgument, ...extra] = process.argv.slice(2);
if (runArgument === undefined || outArgument === undefined || extra.length > 0) {
  fail(2, usageText);
} else {
  const run = readRun(resolve(runArgument));
  const ratios = roundByRound(run);
  const rows = countRows(ratios);
  const chosen = rows.find((row) => row.holds);
  const result = resultLine(chosen);
  const outFolder = resolve(outArgument);
  mkdirSync(outFolder, { recursive: true });
  writeFileSync(join(outFolder, 'control.md'), render(run, ratios, rows, result));
  process.stdout.write(`${result}\n`);
  process.exit(chosen === undefined ? 1 : 0);
}
