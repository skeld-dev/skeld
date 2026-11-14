// Does:  Proves that the JSON Schema export agrees with the type system, with Ajv as the oracle.
// Holds: Every compared disagreement fails unless declared-key counting alone explains it.

import { Ajv2020 } from 'ajv/dist/2020.js';
import type { Schema } from '@skeld/core/schema';
import * as t from '@skeld/core/schema';
import { toJsonSchema } from '@skeld/core/json-schema';
import { corpus, declaresKey, hasAstral, hasOpenMinimum } from './corpus.ts';
import type { Json } from './diverse-fixture.ts';

const defaultSchemas = 4000;
const defaultSeed = 20261110;
const draft = 'https://json-schema.org/draft/2020-12/schema';
const extensionKeywords = ['x-unbounded', 'x-open', 'x-sensitivity', 'x-exposure'];
const maxPrinted = 10;
const keysAjvCannotHold = ['__proto__', ''];

interface Expectation {
  readonly name: string;
  readonly schema: Schema;
  readonly contains: Json;
  readonly absent?: readonly string[];
}

const reason = 'written by the service';
const small = t.string({ maxLength: 5 });
const pair = t.object({ a: t.string({ maxLength: 5 }), b: t.integer() });

const expectations: readonly Expectation[] = [
  {
    name: 'string with both bounds',
    schema: t.string({ maxLength: 10, minLength: 2 }),
    contains: { type: 'string', maxLength: 10, minLength: 2 },
    absent: ['x-unbounded'],
  },
  {
    name: 'string with an opt-out',
    schema: t.string({ unbounded: reason }),
    contains: { type: 'string', 'x-unbounded': reason },
    absent: ['maxLength'],
  },
  {
    name: 'integer',
    schema: t.integer({ minimum: 1, maximum: 9 }),
    contains: { type: 'integer', minimum: 1, maximum: 9 },
  },
  {
    name: 'number',
    schema: t.number({ minimum: -1.5, maximum: 2.5 }),
    contains: { type: 'number', minimum: -1.5, maximum: 2.5 },
  },
  {
    name: 'integer without bounds',
    schema: t.integer(),
    contains: { type: 'integer' },
    absent: ['minimum', 'maximum'],
  },
  { name: 'boolean', schema: t.boolean(), contains: { type: 'boolean' } },
  { name: 'null', schema: t.null(), contains: { type: 'null' } },
  { name: 'string literal', schema: t.literal('a'), contains: { const: 'a' } },
  { name: 'number literal', schema: t.literal(3), contains: { const: 3 } },
  { name: 'boolean literal', schema: t.literal(false), contains: { const: false } },
  {
    name: 'closed object with an optional property',
    schema: t.object({ a: small, b: t.optional(t.integer()) }),
    contains: {
      type: 'object',
      properties: { a: { type: 'string', maxLength: 5 }, b: { type: 'integer' } },
      required: ['a'],
      additionalProperties: false,
    },
  },
  {
    name: 'closed object with no property',
    schema: t.object({}),
    contains: { type: 'object', additionalProperties: false },
    absent: ['required'],
  },
  {
    name: 'open object',
    schema: t.object({ a: small }, { open: reason }),
    contains: { type: 'object', 'x-open': reason, required: ['a'] },
    absent: ['additionalProperties'],
  },
  {
    name: 'partial with minProperties',
    schema: t.partial(t.object({ a: small, b: t.integer() }), { minProperties: 1 }),
    contains: { type: 'object', minProperties: 1, additionalProperties: false },
    absent: ['required'],
  },
  {
    name: 'array with both bounds',
    schema: t.array(t.integer(), { maxItems: 3, minItems: 1 }),
    contains: { type: 'array', items: { type: 'integer' }, maxItems: 3, minItems: 1 },
  },
  {
    name: 'array with an opt-out',
    schema: t.array(t.boolean(), { unbounded: reason }),
    contains: { type: 'array', items: { type: 'boolean' }, 'x-unbounded': reason },
    absent: ['maxItems'],
  },
  {
    name: 'record with a bound',
    schema: t.record(t.string({ maxLength: 8 }), t.integer(), { maxProperties: 4 }),
    contains: {
      type: 'object',
      propertyNames: { type: 'string', maxLength: 8 },
      additionalProperties: { type: 'integer' },
      maxProperties: 4,
    },
  },
  {
    name: 'record with an opt-out',
    schema: t.record(t.string({ maxLength: 8 }), t.integer(), { unbounded: reason }),
    contains: { type: 'object', 'x-unbounded': reason },
    absent: ['maxProperties'],
  },
  {
    name: 'union',
    schema: t.union([t.literal('a'), t.integer({ minimum: 0 })]),
    contains: { anyOf: [{ const: 'a' }, { type: 'integer', minimum: 0 }] },
  },
  { name: 'optional at the root', schema: t.optional(t.integer()), contains: { type: 'integer' } },
  {
    name: 'secret string',
    schema: t.string({ maxLength: 5, sensitivity: 'secret' }),
    contains: { type: 'string', maxLength: 5, 'x-sensitivity': 'secret', writeOnly: true },
  },
  {
    name: 'personal string',
    schema: t.string({ maxLength: 5, sensitivity: 'personal' }),
    contains: { type: 'string', maxLength: 5, 'x-sensitivity': 'personal' },
    absent: ['writeOnly'],
  },
  {
    name: 'secret property and personal array item',
    schema: t.object({
      token: t.string({ maxLength: 5, sensitivity: 'secret' }),
      emails: t.array(t.string({ maxLength: 5, sensitivity: 'personal' }), { maxItems: 2 }),
    }),
    contains: {
      properties: {
        token: { 'x-sensitivity': 'secret', writeOnly: true },
        emails: { type: 'array', items: { 'x-sensitivity': 'personal' } },
      },
    },
  },
  {
    name: 'sensitive container',
    schema: t.object({ a: small }, { sensitivity: 'secret' }),
    contains: { type: 'object', 'x-sensitivity': 'secret', writeOnly: true },
  },
  {
    name: 'exposed secret',
    schema: t.exposed(t.string({ maxLength: 5, sensitivity: 'secret' }), reason),
    contains: { type: 'string', maxLength: 5, 'x-exposure': reason },
    absent: ['writeOnly'],
  },
  {
    name: 'picked object',
    schema: t.pick(pair, ['a']),
    contains: {
      type: 'object',
      properties: { a: { type: 'string', maxLength: 5 } },
      required: ['a'],
      additionalProperties: false,
    },
    absent: ['allOf', '$ref'],
  },
  {
    name: 'omitted object',
    schema: t.omit(pair, ['a']),
    contains: { properties: { b: { type: 'integer' } } },
    absent: ['allOf', '$ref'],
  },
  {
    name: 'extended object',
    schema: t.extend(pair, { c: t.boolean() }),
    contains: { required: ['a', 'b', 'c'], properties: { c: { type: 'boolean' } } },
    absent: ['allOf', '$ref'],
  },
];

function isObjectJson(value: unknown): value is { readonly [key: string]: unknown } {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function contains(actual: unknown, expected: Json): boolean {
  if (Array.isArray(expected)) {
    return (
      Array.isArray(actual) &&
      actual.length === expected.length &&
      expected.every((item, position) => contains(actual[position], item))
    );
  }
  if (isObjectJson(expected)) {
    return (
      isObjectJson(actual) &&
      Object.entries(expected).every(([key, item]) => Object.hasOwn(actual, key) && contains(actual[key], item))
    );
  }
  return actual === expected;
}

function parseOptions(argv: readonly string[]): {
  readonly schemas: number;
  readonly seed: number;
  readonly all: boolean;
} {
  let schemas = defaultSchemas;
  let seed = defaultSeed;
  const rest = argv.filter((item) => item !== '--all');
  for (let position = 0; position < rest.length; position += 2) {
    const flag = rest[position];
    const parsed = Number(rest[position + 1]);
    if ((flag !== '--schemas' && flag !== '--seed') || !Number.isSafeInteger(parsed) || parsed < 1) {
      process.stderr.write('usage: json-schema.ts [--schemas <n>] [--seed <n>] [--all]\n');
      process.exit(2);
    }
    if (flag === '--schemas') {
      schemas = parsed;
    } else {
      seed = parsed;
    }
  }
  return { schemas, seed, all: argv.includes('--all') };
}

function newAjv(): Ajv2020 {
  const ajv = new Ajv2020({ allErrors: false, logger: false, ownProperties: true });
  ajv.addVocabulary(extensionKeywords);
  ajv.addKeyword({
    keyword: 'x-declared-minimum',
    schemaType: 'object',
    validate: (rule: { keys: string[]; minimum: number }, value: unknown) =>
      !isObjectJson(value) || rule.keys.filter((key) => Object.hasOwn(value, key)).length >= rule.minimum,
  });
  return ajv;
}

// Why: JSON Schema counts all own keys; skeld's open-object minimum counts only declared keys.
function countDeclared(document: Record<string, unknown>): Record<string, unknown> {
  const adjusted = Object.fromEntries(
    Object.entries(document).map(([key, value]) => [
      key,
      Array.isArray(value)
        ? value.map((item) => (isObjectJson(item) ? countDeclared(item) : item))
        : isObjectJson(value)
          ? countDeclared(value)
          : value,
    ]),
  );
  if (
    document.type === 'object' &&
    typeof document['x-open'] === 'string' &&
    typeof document.minProperties === 'number'
  ) {
    adjusted['x-declared-minimum'] = {
      keys: isObjectJson(document.properties) ? Object.keys(document.properties) : [],
      minimum: document.minProperties,
    };
  }
  return adjusted;
}

function proveOpenMinimum(): string[] {
  const schema = t.partial(
    t.object({ name: t.string({ maxLength: 4 }), age: t.integer({ minimum: 0 }) }, { open: reason }),
    {
      minProperties: 1,
    },
  );
  const cases = [
    { value: { name: 'Ada' }, accepted: true, exported: true },
    { value: { age: 1, extra: true }, accepted: true, exported: true },
    { value: { extra: true }, accepted: false, exported: true },
    { value: {}, accepted: false, exported: false },
    { value: { name: 'too long', extra: true }, accepted: false, exported: false },
    { value: { age: -1, extra: true }, accepted: false, exported: false },
    { value: { name: 123 }, accepted: false, exported: false },
  ];
  const ajv = newAjv();
  const document = toJsonSchema(schema);
  const exported = ajv.compile(document);
  const adjusted = ajv.compile(countDeclared(document));
  const problems: string[] = [];
  for (const entry of cases) {
    if (
      exported(entry.value) !== entry.exported ||
      adjusted(entry.value) !== entry.accepted ||
      'value' in schema['~standard'].validate(entry.value) !== entry.accepted
    ) {
      problems.push(`open-object minimum or another constraint disagrees for ${JSON.stringify(entry.value)}`);
    }
  }
  return problems;
}

function proveKinds(): { readonly problems: string[]; readonly checked: number } {
  const problems: string[] = [];
  const ajv = newAjv();
  for (const expectation of expectations) {
    const document = toJsonSchema(expectation.schema);
    if (document.$schema !== draft) {
      problems.push(`${expectation.name}: $schema is ${String(document.$schema)}`);
    }
    if (!contains(document, expectation.contains)) {
      problems.push(
        `${expectation.name}: export ${JSON.stringify(document)} lacks ${JSON.stringify(expectation.contains)}`,
      );
    }
    for (const keyword of expectation.absent ?? []) {
      if (Object.hasOwn(document, keyword)) {
        problems.push(`${expectation.name}: export carries ${keyword}`);
      }
    }
    try {
      if (!ajv.validateSchema(document)) {
        problems.push(`${expectation.name}: not valid against the 2020-12 meta-schema: ${ajv.errorsText(ajv.errors)}`);
      }
      ajv.compile(document);
    } catch (error) {
      problems.push(`${expectation.name}: Ajv refused the export: ${String(error).slice(0, 200)}`);
    }
  }
  return { problems, checked: expectations.length };
}

interface Divergence {
  readonly index: number;
  readonly position: number;
  readonly category: string;
  readonly closure: boolean;
  readonly export: boolean;
  readonly value: string;
}

interface Agreement {
  readonly schemas: number;
  readonly compared: number;
  readonly excludedSchemas: number;
  readonly skippedAstral: number;
  readonly openSchemas: number;
  readonly openPairs: number;
  readonly openDiffer: number;
  readonly divergences: number;
  readonly first: readonly Divergence[];
}

function proveAgreement(schemas: number, seed: number, all: boolean): Agreement {
  const ajv = newAjv();
  const divergences: Divergence[] = [];
  let compared = 0;
  let skippedAstral = 0;
  let excludedSchemas = 0;
  let openSchemas = 0;
  let openPairs = 0;
  let openDiffer = 0;
  for (const current of corpus(seed, schemas)) {
    if (!all && declaresKey(current.spec, keysAjvCannotHold)) {
      excludedSchemas++;
      continue;
    }
    const open = hasOpenMinimum(current.spec);
    if (open) {
      openSchemas++;
    }
    const document = toJsonSchema(current.schema);
    const validate = ajv.compile(document);
    const adjusted = open ? ajv.compile(countDeclared(document)) : validate;
    current.values.forEach((held, position) => {
      if (hasAstral(held.value)) {
        skippedAstral++;
        return;
      }
      const closure = 'value' in current.schema['~standard'].validate(held.value);
      const exported = validate(held.value);
      compared++;
      if (open) {
        openPairs++;
      }
      const declared = adjusted(held.value);
      if (closure === exported && closure === declared) {
        return;
      }
      if (open && !closure && exported && !declared) {
        openDiffer++;
        return;
      }
      divergences.push({
        index: current.index,
        position,
        category: held.category,
        closure,
        export: exported,
        value: JSON.stringify(held.value).slice(0, 300),
      });
    });
  }
  return {
    schemas,
    compared,
    excludedSchemas,
    skippedAstral,
    openSchemas,
    openPairs,
    openDiffer,
    divergences: divergences.length,
    first: divergences.slice(0, maxPrinted),
  };
}

function main(argv: readonly string[]): void {
  const { schemas, seed, all } = parseOptions(argv);
  const kinds = proveKinds();
  kinds.problems.push(...proveOpenMinimum());
  process.stdout.write(
    `${kinds.problems.length === 0 ? 'pass' : 'fail'} export of ${kinds.checked} schemas covering every kind and option validates against the 2020-12 meta-schema and carries its keywords\n`,
  );
  for (const problem of kinds.problems.slice(0, maxPrinted)) {
    process.stdout.write(`  ${problem}\n`);
  }
  const agreement = proveAgreement(schemas, seed, all);
  const agreed = agreement.divergences === 0;
  process.stdout.write(
    `excluded: ${agreement.excludedSchemas} schemas (a key __proto__ or "" that Ajv 2020 ignores or mishandles)\nopen-minimum: ${agreement.openSchemas} schemas, ${agreement.openPairs} pairs, ${agreement.openDiffer} differ (the export accepts, skeld refuses; the reverse fails)\n`,
  );
  process.stdout.write(
    `${agreed ? 'pass' : 'fail'} Ajv 2020 on the export agrees with the closure check ${JSON.stringify({ ...agreement, seed })}\n`,
  );
  if (kinds.problems.length > 0 || !agreed) {
    process.exitCode = 1;
  }
}

main(process.argv.slice(2));
