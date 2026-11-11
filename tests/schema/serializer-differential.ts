// Does:  Proves that the serializer writes text exactly when the closure check accepts the projected value.
// Holds: Zero mismatches is the only passing result, and every written string is compared with JSON.stringify.

// biome-ignore lint/correctness/noUnresolvedImports: the seam carries only the darkstart-source condition, which Biome's resolver does not set (ADR-028)
import { generateSerializer } from '@darkstart/core/generated-check';
import * as t from '@darkstart/core/schema';
import type { Case, Spec } from './corpus.ts';
import { build, corpus, describeSpec, valueCount } from './corpus.ts';
import type { Json } from './diverse-fixture.ts';

const defaultSchemas = 4000;
const defaultSeed = 20261110;
const maxPrinted = 10;
const unitCount = 0x1_0000;
const stringLengths = [15, 16, 17] as const;
const stringBound = 32;

type Kind = 'verdict' | 'threw' | 'not-text' | 'parse' | 'projection' | 'stringify' | 'string-bytes';

interface Mismatch {
  readonly kind: Kind;
  readonly index: number;
  readonly position: number;
  readonly detail: string;
  readonly spec: string;
  readonly value: string;
}

function usage(message: string): never {
  process.stderr.write(`${message}\nusage: serializer-differential.ts [--schemas <n>] [--seed <n>]\n`);
  process.exit(2);
}

function readInteger(flag: string, text: string | undefined): number {
  const parsed = Number(text);
  if (text === undefined || !Number.isSafeInteger(parsed) || parsed < 1) {
    return usage(`${flag} needs a positive integer`);
  }
  return parsed;
}

function parseOptions(argv: readonly string[]): { readonly schemas: number; readonly seed: number } {
  let schemas = defaultSchemas;
  let seed = defaultSeed;
  for (let position = 0; position < argv.length; position += 2) {
    const flag = argv[position];
    if (flag === '--schemas') {
      schemas = readInteger(flag, argv[position + 1]);
    } else if (flag === '--seed') {
      seed = readInteger(flag, argv[position + 1]);
    } else {
      return usage(`unknown argument ${flag ?? ''}`);
    }
  }
  return { schemas, seed };
}

function clip(text: string, length: number): string {
  return text.length > length ? `${text.slice(0, length)}...(${text.length} chars)` : text;
}

function isObjectJson(value: unknown): value is { readonly [key: string]: unknown } {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasOwnKey(value: { readonly [name: string]: unknown }, key: string): boolean {
  return Object.hasOwn(value, key);
}

function dropOutsideUnions(spec: Spec, value: unknown): unknown {
  switch (spec.kind) {
    case 'object': {
      if (!isObjectJson(value)) {
        return value;
      }
      const kept: [string, unknown][] = [];
      for (const prop of spec.props) {
        if (hasOwnKey(value, prop.key)) {
          kept.push([prop.key, dropOutsideUnions(prop.spec, value[prop.key])]);
        }
      }
      return Object.fromEntries(kept);
    }
    case 'array':
      return Array.isArray(value) ? value.map((item) => dropOutsideUnions(spec.items, item)) : value;
    case 'record':
      return isObjectJson(value)
        ? Object.fromEntries(Object.keys(value).map((key) => [key, dropOutsideUnions(spec.value, value[key])]))
        : value;
    default:
      return value;
  }
}

function accepts(spec: Spec, value: unknown): boolean {
  return 'value' in build(spec)['~standard'].validate(value);
}

function projectDeclared(spec: Spec, value: unknown): unknown {
  switch (spec.kind) {
    case 'object': {
      if (!isObjectJson(value)) {
        return value;
      }
      const kept: [string, unknown][] = [];
      for (const prop of spec.props) {
        if (hasOwnKey(value, prop.key)) {
          kept.push([prop.key, projectDeclared(prop.spec, value[prop.key])]);
        }
      }
      return Object.fromEntries(kept);
    }
    case 'array':
      return Array.isArray(value) ? value.map((item) => projectDeclared(spec.items, item)) : value;
    case 'record':
      return isObjectJson(value)
        ? Object.fromEntries(Object.keys(value).map((key) => [key, projectDeclared(spec.value, value[key])]))
        : value;
    case 'union': {
      const member = spec.members.find((candidate) => accepts(candidate, value));
      return member === undefined ? value : projectDeclared(member, value);
    }
    default:
      return value;
  }
}

function same(left: unknown, right: unknown): boolean {
  if (Array.isArray(left) || Array.isArray(right)) {
    return (
      Array.isArray(left) &&
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((item, position) => same(item, right[position]))
    );
  }
  if (isObjectJson(left) && isObjectJson(right)) {
    const leftKeys = Object.keys(left).sort();
    const rightKeys = Object.keys(right).sort();
    return (
      leftKeys.length === rightKeys.length &&
      leftKeys.every((key, position) => key === rightKeys[position] && same(left[key], right[key]))
    );
  }
  return Object.is(left, right);
}

function record(kind: Kind, current: Case, position: number, detail: string): Mismatch {
  const value: Json | undefined = current.values[position]?.value;
  return {
    kind,
    index: current.index,
    position,
    detail: clip(detail, 400),
    spec: clip(describeSpec(current.spec), 600),
    value: clip(JSON.stringify(value), 400),
  };
}

function judge(current: Case, position: number, write: (value: unknown) => string | number): Mismatch[] {
  const held = current.values[position];
  if (held === undefined) {
    return [];
  }
  const dropped = dropOutsideUnions(current.spec, held.value);
  const accepted = 'value' in current.schema['~standard'].validate(dropped);
  let written: string | number;
  try {
    written = write(held.value);
  } catch (error) {
    return [record('threw', current, position, String(error))];
  }
  if (!accepted) {
    return typeof written === 'number'
      ? []
      : [record('verdict', current, position, `closure refused, serializer wrote ${clip(String(written), 200)}`)];
  }
  if (typeof written !== 'string') {
    return [record('verdict', current, position, `closure accepted, serializer refused with ${written}`)];
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(written);
  } catch (error) {
    return [record('parse', current, position, `${String(error)}: ${clip(written, 200)}`)];
  }
  const projection = projectDeclared(current.spec, dropped);
  const found: Mismatch[] = [];
  if (!same(parsed, projection)) {
    found.push(
      record(
        'projection',
        current,
        position,
        `text ${clip(written, 200)} expected ${clip(JSON.stringify(projection), 200)}`,
      ),
    );
  }
  if (!same(parsed, JSON.parse(JSON.stringify(projection)))) {
    found.push(
      record(
        'stringify',
        current,
        position,
        `text ${clip(written, 200)} differs from JSON.stringify of the projection`,
      ),
    );
  }
  return found;
}

function runCorpus(
  seed: number,
  schemas: number,
): { pairs: number; accepted: number; refused: number; mismatches: Mismatch[] } {
  const mismatches: Mismatch[] = [];
  let pairs = 0;
  let accepted = 0;
  for (const current of corpus(seed, schemas)) {
    let write: (value: unknown) => string | number;
    try {
      write = generateSerializer(current.schema).write;
    } catch (error) {
      mismatches.push(record('threw', current, 0, `generateSerializer threw: ${String(error)}`));
      continue;
    }
    current.values.forEach((held, position) => {
      pairs++;
      if ('value' in current.schema['~standard'].validate(dropOutsideUnions(current.spec, held.value))) {
        accepted++;
      }
      mismatches.push(...judge(current, position, write));
    });
  }
  return { pairs, accepted, refused: pairs - accepted, mismatches };
}

function stringCases(unit: number): string[] {
  const char = String.fromCharCode(unit);
  const cases = [char];
  for (const length of stringLengths) {
    const middle = Math.floor(length / 2);
    cases.push(
      char + 'a'.repeat(length - 1),
      'a'.repeat(middle) + char + 'a'.repeat(length - middle - 1),
      'a'.repeat(length - 1) + char,
      char.repeat(length),
    );
  }
  return cases;
}

function runStrings(): { checked: number; mismatches: string[] } {
  const write = generateSerializer(t.string({ maxLength: stringBound })).write;
  const mismatches: string[] = [];
  let checked = 0;
  for (let unit = 0; unit < unitCount; unit++) {
    for (const text of stringCases(unit)) {
      checked++;
      let written: string | number;
      try {
        written = write(text);
      } catch (error) {
        mismatches.push(`unit ${unit} length ${text.length}: threw ${String(error)}`);
        continue;
      }
      if (written !== JSON.stringify(text)) {
        mismatches.push(
          `unit ${unit} length ${text.length}: wrote ${clip(String(written), 80)}, JSON.stringify wrote ${clip(JSON.stringify(text), 80)}`,
        );
      }
    }
  }
  return { checked, mismatches };
}

const chosen = parseOptions(process.argv.slice(2));
const started = performance.now();
const corpusResult = runCorpus(chosen.seed, chosen.schemas);
const stringResult = runStrings();
const failures = corpusResult.mismatches;
process.stdout.write(
  `${JSON.stringify({
    run: 'serializer against the closure evaluator and the declared projection',
    schemas: chosen.schemas,
    valuesPerSchema: valueCount,
    pairs: corpusResult.pairs,
    accepted: corpusResult.accepted,
    refused: corpusResult.refused,
    mismatches: failures.length,
    stringsChecked: stringResult.checked,
    stringMismatches: stringResult.mismatches.length,
    seconds: Number(((performance.now() - started) / 1000).toFixed(2)),
    seed: chosen.seed,
  })}\n`,
);
if (failures.length > 0 || stringResult.mismatches.length > 0) {
  process.stdout.write(
    `${JSON.stringify(failures.slice(0, maxPrinted), null, 1)}\n${stringResult.mismatches.slice(0, maxPrinted).join('\n')}\n`,
  );
  process.exitCode = 1;
}
