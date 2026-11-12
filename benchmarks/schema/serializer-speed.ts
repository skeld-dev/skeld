// Does:  Measures the generated serializer against fast-json-stringify on seven response shapes.
// Holds: A serializer that writes nothing aborts the run, so a broken engine cannot post a fast figure.

import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { loadavg } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
// biome-ignore lint/correctness/noUnresolvedImports: the seam carries only the skeld-source condition, which Biome's resolver does not set (ADR-028)
import { generateSerializer } from '@skeld/core/generated-check';
import { toJsonSchema } from '@skeld/core/json-schema';
import type { Schema } from '@skeld/core/schema';
import * as t from '@skeld/core/schema';

const shapes = ['S1', 'S2', 'S3', 'S4', 'union', 'record', 'escapes'] as const;
type Shape = (typeof shapes)[number];
const candidate = 'skeld';
const poolSize = 16;
const pinnedCpu = '7';
const stringBound = 64;
const integerMaximum = 1_000_000;
const defaultPairs = 15;
const defaultWarmupMs = 1000;
const defaultMeasureMs = 2000;
const lowerQuartile = 0.25;

interface Prepared {
  readonly write: (value: unknown) => unknown;
  readonly values: readonly unknown[];
}

interface Measured {
  readonly engine: string;
  readonly shape: Shape;
  readonly opsPerSecond: number;
  readonly bytes: number;
  readonly node: string;
}

function isShape(text: string | undefined): text is Shape {
  return shapes.some((shape) => shape === text);
}

function scalarFields(): readonly {
  readonly key: string;
  readonly schema: Schema;
  readonly kind: 'string' | 'integer' | 'boolean';
}[] {
  return [
    ...Array.from({ length: 8 }, (_, index) => ({
      key: `string_field_${index}`,
      schema: t.string({ maxLength: stringBound }),
      kind: 'string' as const,
    })),
    ...Array.from({ length: 8 }, (_, index) => ({
      key: `integer_field_${index}`,
      schema: t.integer({ minimum: 0, maximum: integerMaximum }),
      kind: 'integer' as const,
    })),
    ...Array.from({ length: 4 }, (_, index) => ({
      key: `boolean_field_${index}`,
      schema: t.boolean(),
      kind: 'boolean' as const,
    })),
  ];
}

function word(index: number, length: number): string {
  return String(index % 10).concat('y'.repeat(length - 1));
}

function scalarValue(kind: 'string' | 'integer' | 'boolean', index: number): unknown {
  if (kind === 'string') {
    return word(index, stringBound);
  }
  return kind === 'integer' ? 123456 + index : index % 2 === 0;
}

const first = t.object({
  kind: t.literal('a'),
  x: t.integer({ minimum: 0, maximum: integerMaximum }),
  label: t.string({ maxLength: 32 }),
});
const second = t.object({
  kind: t.literal('b'),
  y: t.integer({ minimum: 0, maximum: integerMaximum }),
  note: t.string({ maxLength: 32 }),
});
const escapeKeys = ['quoted', 'slashed', 'broken', 'tabbed', 'mixed'] as const;
const escapeTexts = ['say "hi" to "them"', 'back\\slash\\path', 'line\nbreak\nhere', 'tab\there\tnow', 'a"b\\c\nd\te'];

function schemaFor(shape: Shape): Schema {
  switch (shape) {
    case 'S1':
      return t.object({ hello: t.string({ maxLength: 2048 }) });
    case 'S2':
      return t.object(Object.fromEntries(scalarFields().map((field) => [field.key, field.schema])));
    case 'S3':
      return t.array(
        t.object({
          name: t.string({ maxLength: stringBound }),
          label: t.string({ maxLength: stringBound }),
          count: t.integer({ minimum: 0, maximum: integerMaximum }),
          active: t.boolean(),
        }),
        { maxItems: 100 },
      );
    case 'S4':
      return t.object(
        Object.fromEntries(
          scalarFields().map((field, index) => [field.key, index % 2 === 1 ? t.optional(field.schema) : field.schema]),
        ),
      );
    case 'union':
      return t.union([first, second]);
    case 'record':
      return t.record(t.string({ maxLength: 8 }), t.integer({ minimum: 0, maximum: integerMaximum }), {
        maxProperties: 10,
      });
    case 'escapes':
      return t.object(Object.fromEntries(escapeKeys.map((key) => [key, t.string({ maxLength: 64 })])));
    default:
      return shape satisfies never;
  }
}

function valueFor(shape: Shape, index: number): unknown {
  switch (shape) {
    case 'S1':
      return { hello: String(index % 10) + 'x'.repeat(2035) };
    case 'S2':
      return Object.fromEntries(scalarFields().map((field) => [field.key, scalarValue(field.kind, index)]));
    case 'S3':
      return Array.from({ length: 50 }, (_, position) => ({
        name: word(index, 15),
        label: word(position, 15),
        count: 100000 + index * 50 + position,
        active: (index + position) % 2 === 0,
      }));
    case 'S4': {
      let optionalSeen = 0;
      const entries: [string, unknown][] = [];
      scalarFields().forEach((field, position) => {
        if (position % 2 === 1 && (optionalSeen++ + index) % 2 !== 0) {
          return;
        }
        entries.push([field.key, scalarValue(field.kind, index)]);
      });
      return Object.fromEntries(entries);
    }
    case 'union':
      return index % 2 === 0
        ? { kind: 'a', x: 1000 + index, label: word(index, 16) }
        : { kind: 'b', y: 2000 + index, note: word(index, 16) };
    case 'record':
      return Object.fromEntries(
        Array.from({ length: 10 }, (_, position) => [`key${position}`, index * 100 + position]),
      );
    case 'escapes':
      return Object.fromEntries(
        escapeKeys.map((key, position) => [key, escapeTexts[(position + index) % escapeTexts.length]]),
      );
    default:
      return shape satisfies never;
  }
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortKeys);
  }
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => (left < right ? -1 : 1))
        .map(([name, held]) => [name, sortKeys(held)]),
    );
  }
  return value;
}

async function prepare(folder: string, engine: string, shape: Shape): Promise<Prepared> {
  const schema = schemaFor(shape);
  const values = Array.from({ length: poolSize }, (_, index) => valueFor(shape, index));
  if (engine === candidate) {
    return { write: generateSerializer(schema).write, values };
  }
  const loaded: unknown = await import(pathToFileURL(join(folder, 'serializer-engines', `${engine}.mjs`)).href);
  if (typeof loaded !== 'object' || loaded === null || !('prepare' in loaded) || typeof loaded.prepare !== 'function') {
    throw new TypeError(`engine ${engine} does not export prepare(jsonSchema)`);
  }
  const made: unknown = loaded.prepare(toJsonSchema(schema));
  if (typeof made !== 'object' || made === null || !('write' in made) || typeof made.write !== 'function') {
    throw new TypeError(`engine ${engine}: prepare(jsonSchema) did not return { write }`);
  }
  const write = made.write;
  return { write: (value) => write(value), values };
}

async function measureChild(argv: readonly string[]): Promise<void> {
  const at = argv.indexOf('--child');
  const engine = argv[at + 1];
  const shape = argv[at + 2];
  const folder = flagValue(argv, '--comparators');
  const warmupMs = Number(flagValue(argv, '--warmup-ms'));
  const measureMs = Number(flagValue(argv, '--measure-ms'));
  if (engine === undefined || !isShape(shape) || folder === undefined) {
    usage('--child needs an engine, a shape and --comparators');
  }
  const { write, values } = await prepare(resolve(folder), engine, shape);
  let bytes = 0;
  for (const value of values) {
    const text = write(value);
    if (typeof text !== 'string' || JSON.stringify(sortKeys(JSON.parse(text))) !== JSON.stringify(sortKeys(value))) {
      throw new Error(
        `${engine} ${shape}: wrote ${String(text).slice(0, 120)} for ${JSON.stringify(value).slice(0, 120)}`,
      );
    }
    bytes = text.length;
  }
  let sink = 0;
  const runBatch = (count: number): void => {
    for (let step = 0; step < count; step++) {
      const text = write(values[step & (poolSize - 1)]);
      if (typeof text === 'string') {
        sink += text.length;
      }
    }
  };
  let batch = 1;
  const warmEnd = performance.now() + warmupMs;
  while (performance.now() < warmEnd) {
    const started = performance.now();
    runBatch(batch);
    const elapsed = performance.now() - started;
    if (elapsed < 5) {
      batch = Math.min(Math.max(batch + 1, Math.ceil(batch * (5 / Math.max(elapsed, 0.001)))), 1 << 24);
    }
  }
  globalThis.gc?.();
  let operations = 0;
  const started = performance.now();
  let now = started;
  while (now - started < measureMs) {
    runBatch(batch);
    operations += batch;
    now = performance.now();
  }
  if (sink === 0) {
    throw new Error('the serializer wrote nothing');
  }
  const measured: Measured = {
    engine,
    shape,
    opsPerSecond: Math.round(operations / ((now - started) / 1000)),
    bytes,
    node: process.version,
  };
  process.stdout.write(`${JSON.stringify(measured)}\n`);
}

function isMeasured(value: unknown): value is Measured {
  return (
    typeof value === 'object' &&
    value !== null &&
    'opsPerSecond' in value &&
    typeof value.opsPerSecond === 'number' &&
    'engine' in value &&
    typeof value.engine === 'string'
  );
}

function runChild(script: string, folder: string, engine: string, shape: Shape, timing: readonly string[]): Measured {
  const run = spawnSync(
    'taskset',
    [
      '--cpu-list',
      pinnedCpu,
      process.execPath,
      '--expose-gc',
      '--conditions=skeld-source',
      script,
      '--child',
      engine,
      shape,
      '--comparators',
      folder,
      ...timing,
    ],
    { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 },
  );
  if (run.status !== 0) {
    throw new Error(`${engine} ${shape} exited ${run.status}: ${run.stderr.slice(0, 400)}`);
  }
  const parsed: unknown = JSON.parse(run.stdout.trim().split('\n').pop() ?? '');
  if (!isMeasured(parsed)) {
    throw new TypeError(`${engine} ${shape}: unreadable measurement`);
  }
  return parsed;
}

function usage(message: string): never {
  process.stderr.write(
    `${message}\nusage: serializer-speed.ts --comparators <dir> [--shape <name>] [--pairs <n>] [--warmup-ms <n>] [--measure-ms <n>]\n`,
  );
  process.exit(2);
}

function flagValue(argv: readonly string[], flag: string): string | undefined {
  const at = argv.indexOf(flag);
  return at === -1 ? undefined : argv[at + 1];
}

function quantile(sorted: readonly number[], fraction: number): number {
  const position = (sorted.length - 1) * fraction;
  const low = Math.floor(position);
  const lower = sorted[low] ?? Number.NaN;
  const upper = sorted[Math.min(low + 1, sorted.length - 1)] ?? Number.NaN;
  return lower + (upper - lower) * (position - low);
}

function orchestrate(argv: readonly string[]): void {
  const folder = flagValue(argv, '--comparators');
  const only = flagValue(argv, '--shape');
  const pairs = Number(flagValue(argv, '--pairs') ?? defaultPairs);
  const warmupMs = flagValue(argv, '--warmup-ms') ?? String(defaultWarmupMs);
  const measureMs = flagValue(argv, '--measure-ms') ?? String(defaultMeasureMs);
  if (folder === undefined) {
    usage('--comparators <dir> is required');
  }
  if (only !== undefined && !isShape(only)) {
    usage(`unknown shape ${only}`);
  }
  if (!Number.isSafeInteger(pairs) || pairs < 1) {
    usage('--pairs needs a positive integer');
  }
  const script = process.argv[1];
  if (script === undefined) {
    usage('the script path is unknown');
  }
  const root = resolve(folder);
  const timing = ['--warmup-ms', warmupMs, '--measure-ms', measureMs];
  const comparators = readdirSync(join(root, 'serializer-engines'))
    .filter((file) => file.endsWith('.mjs'))
    .map((file) => file.replace(/\.mjs$/, ''))
    .sort();
  const selected = shapes.filter((shape) => only === undefined || shape === only);
  const loadBefore = loadavg();
  const results = selected.flatMap((shape) =>
    comparators.map((comparator) => {
      const ratios: number[] = [];
      for (let pair = 0; pair < pairs; pair++) {
        const ownFirst = pair % 2 === 0;
        const own = ownFirst ? runChild(script, root, candidate, shape, timing) : undefined;
        const other = runChild(script, root, comparator, shape, timing);
        const ownLater = own ?? runChild(script, root, candidate, shape, timing);
        ratios.push(ownLater.opsPerSecond / other.opsPerSecond);
      }
      const sorted = [...ratios].sort((left, right) => left - right);
      const lower = quantile(sorted, lowerQuartile);
      return {
        shape,
        comparator,
        pairs,
        lowerQuartileRatio: Number(lower.toFixed(4)),
        min: Number((sorted[0] ?? Number.NaN).toFixed(4)),
        max: Number((sorted[sorted.length - 1] ?? Number.NaN).toFixed(4)),
        rerunBand: lower >= 0.95 && lower < 1,
        atLeastOne: lower >= 1,
        ratios: ratios.map((ratio) => Number(ratio.toFixed(4))),
      };
    }),
  );
  process.stdout.write(
    `${JSON.stringify({ node: process.version, pinnedCpu, warmupMs: Number(warmupMs), measureMs: Number(measureMs), poolSize, loadavgBefore: loadBefore, loadavgAfter: loadavg(), results }, null, 1)}\n`,
  );
}

if (process.argv.includes('--child')) {
  await measureChild(process.argv.slice(2));
} else {
  orchestrate(process.argv.slice(2));
}
