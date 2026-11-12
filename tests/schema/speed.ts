// Does:  Measures the generated check against typebox and Ajv on the four reference schemas.
// Holds: A check that accepts no value aborts the run, so a broken engine cannot post a fast figure.

import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { loadavg } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
// biome-ignore lint/correctness/noUnresolvedImports: the seam carries only the skeld-source condition, which Biome's resolver does not set (ADR-028)
import { generateCheck } from '@skeld/core/generated-check';
import type { Schema } from '@skeld/core/schema';
import * as t from '@skeld/core/schema';

const names = ['S1', 'S2', 'S3', 'S4'] as const;
type Name = (typeof names)[number];
const candidate = 'skeld';
const poolSize = 16;
const warmupMs = 2000;
const roundMs = 2000;
const rounds = 5;
const pinnedCpu = '7';
const stringBound = 64;
const integerMaximum = 1_000_000;

interface Prepared {
  readonly check: (value: unknown) => boolean;
  readonly values: readonly unknown[];
}

interface Measured {
  readonly engine: string;
  readonly schema: Name;
  readonly bodyBytes: number;
  readonly node: string;
  readonly medianOps: number;
  readonly minOps: number;
  readonly maxOps: number;
  readonly rounds: readonly number[];
  readonly batch: number;
}

function isName(text: string | undefined): text is Name {
  return names.some((name) => name === text);
}

function fields(
  suffix: string,
): readonly { readonly key: string; readonly schema: Schema; readonly kind: 'string' | 'integer' | 'boolean' }[] {
  return [
    ...Array.from({ length: 8 }, (_, index) => ({
      key: `string_field_${index}${suffix}`,
      schema: t.string({ maxLength: stringBound }),
      kind: 'string' as const,
    })),
    ...Array.from({ length: 8 }, (_, index) => ({
      key: `integer_field_${index}${suffix}`,
      schema: t.integer({ minimum: 0, maximum: integerMaximum }),
      kind: 'integer' as const,
    })),
    ...Array.from({ length: 4 }, (_, index) => ({
      key: `boolean_field_${index}${suffix}`,
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

function schemaFor(name: Name): Schema {
  switch (name) {
    case 'S1':
      return t.object({ hello: t.string({ maxLength: 2048 }) });
    case 'S2':
      return t.object(Object.fromEntries(fields('').map((field) => [field.key, field.schema])));
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
          fields('').map((field, index) => [field.key, index % 2 === 1 ? t.optional(field.schema) : field.schema]),
        ),
      );
    default:
      return name satisfies never;
  }
}

function valueFor(name: Name, index: number): unknown {
  switch (name) {
    case 'S1':
      return { hello: String(index % 10) + 'x'.repeat(2035) };
    case 'S2':
      return Object.fromEntries(fields('').map((field) => [field.key, scalarValue(field.kind, index)]));
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
      fields('').forEach((field, position) => {
        if (position % 2 === 1 && (optionalSeen++ + index) % 2 !== 0) {
          return;
        }
        entries.push([field.key, scalarValue(field.kind, index)]);
      });
      return Object.fromEntries(entries);
    }
    default:
      return name satisfies never;
  }
}

function prepareCandidate(name: Name): Prepared {
  return {
    check: generateCheck(schemaFor(name)),
    values: Array.from({ length: poolSize }, (_, index) => valueFor(name, index)),
  };
}

async function prepareComparator(folder: string, engine: string, name: Name): Promise<Prepared> {
  const loaded: unknown = await import(pathToFileURL(join(folder, 'engines', `${engine}.mjs`)).href);
  if (typeof loaded !== 'object' || loaded === null || !('prepare' in loaded) || typeof loaded.prepare !== 'function') {
    throw new TypeError(`engine ${engine} does not export prepare(name)`);
  }
  const made: unknown = loaded.prepare(name);
  if (
    typeof made !== 'object' ||
    made === null ||
    !('check' in made) ||
    typeof made.check !== 'function' ||
    !('values' in made) ||
    !Array.isArray(made.values)
  ) {
    throw new TypeError(`engine ${engine}: prepare(${name}) did not return { check, values }`);
  }
  const check = made.check;
  return { check: (value) => check(value) === true, values: made.values };
}

function median(sorted: readonly number[]): number {
  const middle = sorted[Math.floor(sorted.length / 2)];
  if (middle === undefined) {
    throw new RangeError('no rounds were measured');
  }
  return middle;
}

function measureChild(engine: string, schema: Name, prepared: Prepared): Measured {
  const { check, values } = prepared;
  if (values.length !== poolSize) {
    throw new RangeError(`pool holds ${values.length} values, expected ${poolSize}`);
  }
  for (const value of values) {
    if (check(value) !== true) {
      throw new Error(`${engine} ${schema}: a pool value was refused by the check`);
    }
  }
  let sink = 0;
  const runBatch = (count: number): void => {
    for (let step = 0; step < count; step++) {
      if (check(values[step & (poolSize - 1)])) {
        sink++;
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
  const perSecond: number[] = [];
  for (let round = 0; round < rounds; round++) {
    globalThis.gc?.();
    let operations = 0;
    const started = performance.now();
    let now = started;
    while (now - started < roundMs) {
      runBatch(batch);
      operations += batch;
      now = performance.now();
    }
    perSecond.push(operations / ((now - started) / 1000));
  }
  if (sink === 0) {
    throw new Error('the check accepted no value');
  }
  const sorted = [...perSecond].sort((left, right) => left - right);
  return {
    engine,
    schema,
    bodyBytes: JSON.stringify(values[0]).length,
    node: process.version,
    medianOps: Math.round(median(sorted)),
    minOps: Math.round(sorted[0] ?? 0),
    maxOps: Math.round(sorted[sorted.length - 1] ?? 0),
    rounds: perSecond.map(Math.round),
    batch,
  };
}

function isMeasured(value: unknown): value is Measured {
  return (
    typeof value === 'object' &&
    value !== null &&
    'medianOps' in value &&
    typeof value.medianOps === 'number' &&
    'engine' in value &&
    typeof value.engine === 'string' &&
    'schema' in value &&
    typeof value.schema === 'string'
  );
}

function runChild(script: string, folder: string, engine: string, schema: Name): Measured {
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
      schema,
      '--comparators',
      folder,
    ],
    { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 },
  );
  if (run.status !== 0) {
    throw new Error(`${engine} ${schema} exited ${run.status}: ${run.stderr.slice(0, 400)}`);
  }
  const parsed: unknown = JSON.parse(run.stdout.trim().split('\n').pop() ?? '');
  if (!isMeasured(parsed)) {
    throw new TypeError(`${engine} ${schema}: unreadable measurement`);
  }
  return parsed;
}

function usage(message: string): never {
  process.stderr.write(`${message}\nusage: speed.ts --comparators <dir> [--schema S1|S2|S3|S4]\n`);
  process.exit(2);
}

function flagValue(argv: readonly string[], flag: string): string | undefined {
  const at = argv.indexOf(flag);
  return at === -1 ? undefined : argv[at + 1];
}

async function child(argv: readonly string[]): Promise<void> {
  const at = argv.indexOf('--child');
  const engine = argv[at + 1];
  const schema = argv[at + 2];
  const folder = flagValue(argv, '--comparators');
  if (engine === undefined || !isName(schema) || folder === undefined) {
    usage('--child needs an engine, a schema name and --comparators');
  }
  const prepared =
    engine === candidate ? prepareCandidate(schema) : await prepareComparator(resolve(folder), engine, schema);
  process.stdout.write(`${JSON.stringify(measureChild(engine, schema, prepared))}\n`);
}

function orchestrate(argv: readonly string[]): void {
  const folder = flagValue(argv, '--comparators');
  const only = flagValue(argv, '--schema');
  if (folder === undefined) {
    usage('--comparators <dir> is required');
  }
  if (only !== undefined && !isName(only)) {
    usage(`unknown schema ${only}`);
  }
  const root = resolve(folder);
  const script = process.argv[1];
  if (script === undefined) {
    usage('the script path is unknown');
  }
  const comparators = readdirSync(join(root, 'engines'))
    .filter((file) => file.endsWith('.mjs'))
    .map((file) => file.replace(/\.mjs$/, ''))
    .sort();
  const selected = names.filter((name) => only === undefined || name === only);
  const loadBefore = loadavg();
  const runs = selected.flatMap((schema) =>
    [candidate, ...comparators].map((engine) => runChild(script, root, engine, schema)),
  );
  const ratios = selected.flatMap((schema) => {
    const own = runs.find((run) => run.engine === candidate && run.schema === schema);
    return comparators.map((comparator) => {
      const other = runs.find((run) => run.engine === comparator && run.schema === schema);
      const ratio = own !== undefined && other !== undefined ? own.medianOps / other.medianOps : Number.NaN;
      return { schema, comparator, ratio: Number(ratio.toFixed(4)), rerunBand: ratio >= 0.95 && ratio < 1 };
    });
  });
  process.stdout.write(
    `${JSON.stringify({ node: process.version, pinnedCpu, warmupMs, roundMs, rounds, poolSize, loadavgBefore: loadBefore, loadavgAfter: loadavg(), runs, ratios }, null, 1)}\n`,
  );
}

if (process.argv.includes('--child')) {
  await child(process.argv.slice(2));
} else {
  orchestrate(process.argv.slice(2));
}
