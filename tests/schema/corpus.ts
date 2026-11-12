// Does:  Generates the corpus of random schemas and values that the differential proofs run on.
// Holds: Generation is seeded, so a run can be repeated exactly.

import type { Schema, Sensitivity } from '@skeld/core/schema';
import * as t from '@skeld/core/schema';
import type { Json } from './diverse-fixture.ts';

type Sens = Sensitivity | null;
type Path = readonly (string | number)[];
type Rng = () => number;
type Literal = string | number | boolean;

export type Category = 'valid' | 'leaf' | 'undeclared' | 'bound' | 'container' | 'missing';

interface Prop {
  readonly key: string;
  readonly spec: Spec;
  readonly optional: boolean;
}

type Recipe =
  | { readonly op: 'pick' | 'omit'; readonly base: ObjectSpec; readonly keys: readonly string[] }
  | { readonly op: 'partial'; readonly base: ObjectSpec }
  | { readonly op: 'extend'; readonly base: ObjectSpec; readonly added: readonly Prop[] };

interface StringSpec {
  readonly kind: 'string';
  readonly max: number | null;
  readonly min: number;
  readonly sens: Sens;
}

interface NumberSpec {
  readonly kind: 'integer' | 'number';
  readonly min: number | null;
  readonly max: number | null;
  readonly sens: Sens;
}

interface PlainSpec {
  readonly kind: 'boolean' | 'null';
  readonly sens: Sens;
}

interface LiteralSpec {
  readonly kind: 'literal';
  readonly value: Literal;
}

interface ObjectSpec {
  readonly kind: 'object';
  readonly props: readonly Prop[];
  readonly open: boolean;
  readonly minProps: number | null;
  readonly sens: Sens;
  readonly recipe: Recipe | null;
}

interface ArraySpec {
  readonly kind: 'array';
  readonly items: Spec;
  readonly max: number | null;
  readonly min: number;
  readonly sens: Sens;
}

interface RecordSpec {
  readonly kind: 'record';
  readonly keyMax: number;
  readonly keyMin: number;
  readonly value: Spec;
  readonly max: number | null;
  readonly sens: Sens;
}

interface UnionSpec {
  readonly kind: 'union';
  readonly members: readonly Spec[];
  readonly sens: Sens;
}

interface ExposedSpec {
  readonly kind: 'exposed';
  readonly inner: StringSpec | NumberSpec | PlainSpec;
}

export type Spec =
  | StringSpec
  | NumberSpec
  | PlainSpec
  | LiteralSpec
  | ObjectSpec
  | ArraySpec
  | RecordSpec
  | UnionSpec
  | ExposedSpec;

export interface CaseValue {
  readonly category: Category;
  readonly value: Json;
}

export interface Case {
  readonly seed: number;
  readonly index: number;
  readonly spec: Spec;
  readonly schema: Schema;
  readonly values: readonly CaseValue[];
}

interface Site {
  readonly path: Path;
  readonly spec: Spec;
  readonly value: Json;
}

const ordinaryKeys = [
  'id',
  'name',
  'email',
  'age',
  'tags',
  'meta',
  'x',
  'y',
  'z',
  'kind',
  'data',
  'score',
  'flag',
  'note',
  'title',
  'items',
  'owner',
  'count',
  'state',
  'label',
];

const specialKeys = [
  'constructor',
  'toString',
  '__proto__',
  'valueOf',
  'hasOwnProperty',
  'isPrototypeOf',
  'say "hi"',
  'line\nbreak',
  '',
  "it's",
  'back\\slash',
  'é',
  '0',
  '10',
  'a b',
  'tab\there',
];

const declaredSpecialKeys = specialKeys.filter((key) => key !== '__proto__' && key !== '');
const undeclaredKeys = ['extra', '__proto__', 'constructor', 'toString', 'zz', 'a"b', 'new\nline'];
const alphabet = Array.from({ length: 36 }, (_, index) =>
  index < 26 ? String.fromCharCode(97 + index) : String(index - 26),
);
const textUnits = ['a', 'b', 'c', 'x', 'é', 'ü', '中', '"', '\\', '\n', ' '];
const astral = '\u{1F600}';
export const valueCount = 12;
const categoryOrder: readonly Category[] = [
  'valid',
  'valid',
  'valid',
  'leaf',
  'undeclared',
  'bound',
  'container',
  'missing',
  'leaf',
  'undeclared',
  'bound',
  'container',
];

export function seeded(seed: number): Rng {
  let state = seed | 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let mixed = Math.imul(state ^ (state >>> 15), 1 | state);
    mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

function integer(rng: Rng, low: number, high: number): number {
  return low + Math.floor(rng() * (high - low + 1));
}

function choose<T>(rng: Rng, items: readonly T[]): T {
  const found = items[integer(rng, 0, items.length - 1)];
  if (found === undefined) {
    throw new RangeError('nothing to choose from');
  }
  return found;
}

function chance(rng: Rng, probability: number): boolean {
  return rng() < probability;
}

function isObjectJson(value: Json): value is { readonly [key: string]: Json } {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function sensitivity(rng: Rng, probability: number): Sens {
  return chance(rng, probability) ? choose<Sensitivity>(rng, ['secret', 'personal']) : null;
}

function distinctKeys(rng: Rng, count: number): readonly string[] {
  const keys: string[] = [];
  let guard = 0;
  while (keys.length < count && guard++ < count * 20) {
    const key = chance(rng, 0.006)
      ? choose(rng, ['__proto__', ''])
      : chance(rng, 0.35)
        ? choose(rng, declaredSpecialKeys)
        : choose(rng, ordinaryKeys);
    if (!keys.includes(key)) {
      keys.push(key);
    }
  }
  while (keys.length < count) {
    keys.push(`k${keys.length}`);
  }
  return keys;
}

function leafSpec(rng: Rng): Spec {
  const pick = rng();
  const sens = sensitivity(rng, 0.1);
  if (pick < 0.3) {
    const max = chance(rng, 0.06) ? null : integer(rng, 0, 12);
    return { kind: 'string', max, min: lowerBound(rng, max, 0.3, 3), sens };
  }
  if (pick < 0.55) {
    return numberSpec(rng, 'integer', sens);
  }
  if (pick < 0.7) {
    return numberSpec(rng, 'number', sens);
  }
  if (pick < 0.8) {
    return { kind: 'boolean', sens };
  }
  if (pick < 0.86) {
    return { kind: 'null', sens };
  }
  return { kind: 'literal', value: choose<Literal>(rng, ['a', 'on', 7, 0, -3, true, false, 'x y']) };
}

function lowerBound(rng: Rng, max: number | null, probability: number, ceiling: number): number {
  const top = Math.min(max ?? ceiling, ceiling);
  return top >= 1 && chance(rng, probability) ? integer(rng, 1, top) : 0;
}

function numberSpec(rng: Rng, kind: 'integer' | 'number', sens: Sens): NumberSpec {
  const low = chance(rng, 0.5) ? integer(rng, -20, 5) : null;
  const high = chance(rng, 0.5) ? (low === null ? integer(rng, -5, 30) : integer(rng, low, low + 30)) : null;
  return { kind, min: low, max: high, sens };
}

function exposedSpec(rng: Rng): ExposedSpec {
  const pick = rng();
  if (pick < 0.5) {
    return { kind: 'exposed', inner: { kind: 'string', max: integer(rng, 1, 10), min: 0, sens: 'secret' } };
  }
  if (pick < 0.8) {
    return { kind: 'exposed', inner: { kind: 'integer', min: null, max: integer(rng, 0, 99), sens: 'secret' } };
  }
  return { kind: 'exposed', inner: { kind: 'boolean', sens: 'secret' } };
}

function propsFor(rng: Rng, depth: number, count: number): readonly Prop[] {
  return distinctKeys(rng, count).map((key) => ({
    key,
    spec: genSpec(rng, depth + 1),
    optional: chance(rng, 0.3),
  }));
}

function objectSpec(rng: Rng, depth: number): ObjectSpec {
  const count = depth === 0 ? integer(rng, 0, 20) : integer(rng, 0, 5);
  const base: ObjectSpec = {
    kind: 'object',
    props: propsFor(rng, depth, count),
    open: chance(rng, 0.1),
    minProps: null,
    sens: sensitivity(rng, 0.08),
    recipe: null,
  };
  return chance(rng, 0.2) && base.props.length >= 2 ? derived(rng, depth, base) : base;
}

function derived(rng: Rng, depth: number, base: ObjectSpec): ObjectSpec {
  const keys = base.props.map((prop) => prop.key);
  const pick = rng();
  if (pick < 0.3) {
    const chosen = keys.filter(() => chance(rng, 0.6));
    return {
      ...base,
      props: base.props.filter((prop) => chosen.includes(prop.key)),
      recipe: { op: 'pick', base, keys: chosen },
      minProps: null,
    };
  }
  if (pick < 0.55) {
    const dropped = keys.filter(() => chance(rng, 0.4));
    return {
      ...base,
      props: base.props.filter((prop) => !dropped.includes(prop.key)),
      recipe: { op: 'omit', base, keys: dropped },
      minProps: null,
    };
  }
  if (pick < 0.8) {
    const minProps = chance(rng, 0.6) && keys.length >= 1 ? integer(rng, 1, Math.min(2, keys.length)) : null;
    return {
      ...base,
      props: base.props.map((prop) => ({ ...prop, optional: true })),
      recipe: { op: 'partial', base },
      minProps,
    };
  }
  const added = distinctKeys(rng, 10)
    .filter((key) => !keys.includes(key))
    .slice(0, integer(rng, 1, 3))
    .map((key) => ({ key, spec: genSpec(rng, depth + 1), optional: chance(rng, 0.3) }));
  return { ...base, props: [...base.props, ...added], recipe: { op: 'extend', base, added }, minProps: null };
}

function genSpec(rng: Rng, depth: number): Spec {
  const pick = rng();
  if (depth >= 3 || pick < 0.4) {
    return leafSpec(rng);
  }
  if (pick < 0.65) {
    return objectSpec(rng, depth);
  }
  if (pick < 0.75) {
    const max = chance(rng, 0.06) ? null : integer(rng, 0, 4);
    return {
      kind: 'array',
      items: genSpec(rng, depth + 1),
      max,
      min: lowerBound(rng, max, 0.25, 2),
      sens: sensitivity(rng, 0.05),
    };
  }
  if (pick < 0.84) {
    return {
      kind: 'record',
      keyMax: integer(rng, 1, 9),
      keyMin: chance(rng, 0.2) ? 1 : 0,
      value: genSpec(rng, depth + 1),
      max: chance(rng, 0.06) ? null : integer(rng, 0, 4),
      sens: sensitivity(rng, 0.05),
    };
  }
  if (pick < 0.94) {
    const members = Array.from({ length: integer(rng, 1, 4) }, () => genSpec(rng, depth + 1));
    return { kind: 'union', members, sens: sensitivity(rng, 0.05) };
  }
  return exposedSpec(rng);
}

function sensOption(sens: Sens): { readonly sensitivity?: Sensitivity } {
  return sens === null ? {} : { sensitivity: sens };
}

function buildString(spec: StringSpec): Schema {
  const rest = { ...(spec.min > 0 ? { minLength: spec.min } : {}), ...sensOption(spec.sens) };
  return t.string(spec.max === null ? { unbounded: 'corpus', ...rest } : { maxLength: spec.max, ...rest });
}

function buildNumber(spec: NumberSpec): Schema {
  const options = {
    ...(spec.min === null ? {} : { minimum: spec.min }),
    ...(spec.max === null ? {} : { maximum: spec.max }),
    ...sensOption(spec.sens),
  };
  return spec.kind === 'integer' ? t.integer(options) : t.number(options);
}

function buildSecretLeaf(spec: StringSpec | NumberSpec | PlainSpec): Schema {
  switch (spec.kind) {
    case 'string':
      return t.exposed(t.string({ maxLength: spec.max ?? 1, sensitivity: 'secret' }), 'corpus');
    case 'integer':
      return t.exposed(
        t.integer({ ...(spec.max === null ? {} : { maximum: spec.max }), sensitivity: 'secret' }),
        'corpus',
      );
    case 'number':
      return t.exposed(t.number({ sensitivity: 'secret' }), 'corpus');
    case 'boolean':
      return t.exposed(t.boolean({ sensitivity: 'secret' }), 'corpus');
    case 'null':
      return t.exposed(t.null({ sensitivity: 'secret' }), 'corpus');
    default:
      return spec satisfies never;
  }
}

function buildProps(props: readonly Prop[]): { readonly [key: string]: Schema } {
  return Object.fromEntries(
    props.map((prop) => [prop.key, prop.optional ? t.optional(build(prop.spec)) : build(prop.spec)]),
  );
}

function buildObject(spec: ObjectSpec): Schema {
  const recipe = spec.recipe;
  if (recipe === null) {
    const options = { ...(spec.open ? { open: 'corpus' } : {}), ...sensOption(spec.sens) };
    return t.object(buildProps(spec.props), options);
  }
  const base = buildObject(recipe.base);
  return derive(base, spec, recipe);
}

function derive(base: Schema, spec: ObjectSpec, recipe: Recipe): Schema {
  if (!isObjectSchema(base)) {
    throw new TypeError('the base of a derivation is an object');
  }
  switch (recipe.op) {
    case 'pick':
      return t.pick(base, recipe.keys);
    case 'omit':
      return t.omit(base, recipe.keys);
    case 'partial':
      return t.partial(base, spec.minProps === null ? {} : { minProperties: spec.minProps });
    case 'extend':
      return extendDynamic(base, buildProps(recipe.added));
    default:
      return recipe satisfies never;
  }
}

function isObjectSchema(schema: Schema): schema is ReturnType<typeof t.object> {
  return schema.kind === 'object';
}

function buildArray(spec: ArraySpec): Schema {
  const rest = { ...(spec.min > 0 ? { minItems: spec.min } : {}), ...sensOption(spec.sens) };
  const items = build(spec.items);
  return t.array(items, spec.max === null ? { unbounded: 'corpus', ...rest } : { maxItems: spec.max, ...rest });
}

function buildRecord(spec: RecordSpec): Schema {
  const key = t.string({ maxLength: spec.keyMax, ...(spec.keyMin > 0 ? { minLength: spec.keyMin } : {}) });
  const rest = sensOption(spec.sens);
  const value = build(spec.value);
  return t.record(
    key,
    value,
    spec.max === null ? { unbounded: 'corpus', ...rest } : { maxProperties: spec.max, ...rest },
  );
}

export function build(spec: Spec): Schema {
  switch (spec.kind) {
    case 'string':
      return buildString(spec);
    case 'integer':
    case 'number':
      return buildNumber(spec);
    case 'boolean':
      return t.boolean(sensOption(spec.sens));
    case 'null':
      return t.null(sensOption(spec.sens));
    case 'literal':
      return t.literal(spec.value);
    case 'object':
      return buildObject(spec);
    case 'array':
      return buildArray(spec);
    case 'record':
      return buildRecord(spec);
    case 'union':
      return t.union(spec.members.map(build), sensOption(spec.sens));
    case 'exposed':
      return buildSecretLeaf(spec.inner);
    default:
      return spec satisfies never;
  }
}

function text(rng: Rng, length: number): string {
  let out = '';
  let units = 0;
  while (units < length) {
    const useAstral = length - units >= 2 && chance(rng, 0.04);
    const piece = useAstral ? astral : choose(rng, textUnits);
    units += piece.length;
    out += piece;
  }
  return out;
}

function stringValue(rng: Rng, spec: StringSpec): string {
  const high = spec.max ?? Math.max(spec.min, 12);
  const length = chance(rng, 0.25) ? high : integer(rng, spec.min, high);
  return text(rng, length);
}

function numberValue(rng: Rng, spec: NumberSpec): number {
  const low = spec.min ?? (spec.max === null ? -20 : spec.max - 20);
  const high = spec.max ?? low + 20;
  const raw = chance(rng, 0.25) ? choose(rng, [low, high]) : low + rng() * (high - low);
  const value = spec.kind === 'integer' ? Math.round(raw) : Math.round(raw * 100) / 100;
  const clamped = Math.min(high, Math.max(low, value));
  return clamped === 0 ? 0 : clamped;
}

function recordKey(rng: Rng, spec: RecordSpec, taken: readonly string[]): string | null {
  for (let attempt = 0; attempt < 30; attempt++) {
    const length = integer(rng, spec.keyMin, spec.keyMax);
    const special = specialKeys.filter(
      (candidate) => candidate.length >= spec.keyMin && candidate.length <= spec.keyMax,
    );
    const key =
      special.length > 0 && chance(rng, 0.3)
        ? choose(rng, special)
        : Array.from({ length }, () => choose(rng, alphabet)).join('');
    if (!taken.includes(key)) {
      return key;
    }
  }
  return null;
}

function makeObject(rng: Rng, spec: ObjectSpec, path: Path, sites: Site[]): Json {
  const entries: [string, Json][] = [];
  const needed = spec.minProps ?? 0;
  spec.props.forEach((prop, position) => {
    const forced = needed - entries.length >= spec.props.length - position;
    if (!prop.optional || forced || chance(rng, 0.5)) {
      entries.push([prop.key, makeValue(rng, prop.spec, [...path, prop.key], sites)]);
    }
  });
  if (spec.open) {
    for (const key of undeclaredKeys.filter((candidate) => !spec.props.some((prop) => prop.key === candidate))) {
      if (chance(rng, 0.2)) {
        entries.push([key, integer(rng, 0, 9)]);
      }
    }
  }
  return Object.fromEntries(entries);
}

function makeRecord(rng: Rng, spec: RecordSpec, path: Path, sites: Site[]): Json {
  const count = integer(rng, 0, spec.max ?? 3);
  const entries: [string, Json][] = [];
  for (let index = 0; index < count; index++) {
    const key = recordKey(
      rng,
      spec,
      entries.map(([taken]) => taken),
    );
    if (key !== null) {
      entries.push([key, makeValue(rng, spec.value, [...path, key], sites)]);
    }
  }
  return Object.fromEntries(entries);
}

function makeValue(rng: Rng, spec: Spec, path: Path, sites: Site[]): Json {
  const value = makeValueOf(rng, spec, path, sites);
  sites.push({ path, spec, value });
  return value;
}

function makeValueOf(rng: Rng, spec: Spec, path: Path, sites: Site[]): Json {
  switch (spec.kind) {
    case 'string':
      return stringValue(rng, spec);
    case 'integer':
    case 'number':
      return numberValue(rng, spec);
    case 'boolean':
      return chance(rng, 0.5);
    case 'null':
      return null;
    case 'literal':
      return spec.value;
    case 'object':
      return makeObject(rng, spec, path, sites);
    case 'array': {
      const length = chance(rng, 0.25) ? (spec.max ?? 3) : integer(rng, spec.min, spec.max ?? 3);
      return Array.from({ length }, (_, index) => makeValue(rng, spec.items, [...path, index], sites));
    }
    case 'record':
      return makeRecord(rng, spec, path, sites);
    case 'union':
      return makeValue(rng, choose(rng, spec.members), path, sites);
    case 'exposed':
      return makeValueOf(rng, spec.inner, path, sites);
    default:
      return spec satisfies never;
  }
}

function replaceAt(root: Json, path: Path, next: Json): Json {
  const [head, ...rest] = path;
  if (head === undefined) {
    return next;
  }
  if (Array.isArray(root) && typeof head === 'number') {
    return root.map((item, index) => (index === head ? replaceAt(item, rest, next) : item));
  }
  if (isObjectJson(root)) {
    return Object.fromEntries(
      Object.entries(root).map(([key, item]) => [key, key === head ? replaceAt(item, rest, next) : item]),
    );
  }
  throw new TypeError('the path does not lead into the value');
}

function unwrapped(spec: Spec): Spec {
  return spec.kind === 'exposed' ? spec.inner : spec;
}

function wrongLiteral(value: Literal): string {
  return typeof value === 'string' ? `${value}!` : JSON.stringify(value);
}

function extendDynamic(base: Schema, added: { readonly [key: string]: Schema }): Schema {
  const made: Schema = Reflect.apply(t.extend, undefined, [base, added]);
  return made;
}

function wrongLeaf(rng: Rng, spec: Spec): Json {
  const inner = unwrapped(spec);
  switch (inner.kind) {
    case 'string':
      return choose<Json>(rng, [1, null, true, [], {}, ['a']]);
    case 'integer':
      return choose<Json>(rng, ['1', 1.5, null, true, [], {}, 0.1]);
    case 'number':
      return choose<Json>(rng, ['1', null, false, [], {}]);
    case 'boolean':
      return choose<Json>(rng, [0, 1, 'true', null, [], {}]);
    case 'null':
      return choose<Json>(rng, [0, '', false, [], {}]);
    case 'literal':
      return choose<Json>(rng, [wrongLiteral(inner.value), null, [], {}, 1.5]);
    default:
      return choose<Json>(rng, [null, 'x', 1]);
  }
}

function wrongContainer(rng: Rng, spec: Spec): Json {
  const inner = unwrapped(spec);
  switch (inner.kind) {
    case 'object':
    case 'record':
      return choose<Json>(rng, [[], null, 'x', 1, [{}]]);
    case 'array':
      return choose<Json>(rng, [{}, null, 'x', 1, { length: 0 }]);
    default:
      return choose<Json>(rng, [{}, [], null, { a: 1 }]);
  }
}

function overBound(rng: Rng, site: Site): Json | null {
  const spec = unwrapped(site.spec);
  switch (spec.kind) {
    case 'string':
      return spec.max !== null && chance(rng, 0.7)
        ? 'a'.repeat(spec.max + 1)
        : spec.min > 0
          ? 'a'.repeat(spec.min - 1)
          : null;
    case 'integer':
    case 'number':
      return spec.max !== null && chance(rng, 0.5) ? spec.max + 1 : spec.min === null ? null : spec.min - 1;
    case 'array':
      return arrayPastBound(rng, spec, site.value);
    case 'record':
      return recordPastBound(rng, spec, site.value);
    case 'object':
      return spec.minProps === null ? null : objectBelowMinimum(rng, spec);
    default:
      return null;
  }
}

function arrayPastBound(rng: Rng, spec: ArraySpec, value: Json): Json | null {
  if (!Array.isArray(value)) {
    return null;
  }
  if (spec.max !== null && (spec.min === 0 || chance(rng, 0.7))) {
    const sample = makeValue(rng, spec.items, [], []);
    return Array.from({ length: spec.max + 1 }, () => sample);
  }
  return spec.min > 0 ? value.slice(0, spec.min - 1) : null;
}

function recordPastBound(rng: Rng, spec: RecordSpec, value: Json): Json | null {
  if (spec.max === null || !isObjectJson(value)) {
    return null;
  }
  const entries: [string, Json][] = [];
  while (entries.length < spec.max + 1) {
    const key = recordKey(
      rng,
      spec,
      entries.map(([taken]) => taken),
    );
    if (key === null) {
      return null;
    }
    entries.push([key, makeValue(rng, spec.value, [], [])]);
  }
  return Object.fromEntries(entries);
}

function objectBelowMinimum(rng: Rng, spec: ObjectSpec): Json {
  const extra = spec.props.some((prop) => prop.key === 'extra') ? [] : [['extra', 1] satisfies [string, Json]];
  const kept = spec.props.slice(0, Math.max(0, (spec.minProps ?? 1) - 1));
  const entries = kept.map((prop): [string, Json] => [prop.key, makeValue(rng, prop.spec, [], [])]);
  return Object.fromEntries(spec.open && chance(rng, 0.7) ? [...entries, ...extra] : entries);
}

function withUndeclaredKey(rng: Rng, spec: Spec, value: Json): Json | null {
  const inner = unwrapped(spec);
  if (!isObjectJson(value) || (inner.kind !== 'object' && inner.kind !== 'record')) {
    return null;
  }
  const declared = inner.kind === 'object' ? inner.props.map((prop) => prop.key) : [];
  const start = integer(rng, 0, undeclaredKeys.length - 1);
  for (let step = 0; step < undeclaredKeys.length; step++) {
    const key = undeclaredKeys[(start + step) % undeclaredKeys.length];
    if (key !== undefined && !declared.includes(key) && !Object.hasOwn(value, key)) {
      return Object.fromEntries([...Object.entries(value), [key, 1]]);
    }
  }
  return null;
}

function withoutRequired(rng: Rng, spec: Spec, value: Json): Json | null {
  if (spec.kind !== 'object' || !isObjectJson(value)) {
    return null;
  }
  const required = spec.props.filter((prop) => !prop.optional && Object.hasOwn(value, prop.key));
  if (required.length === 0) {
    return null;
  }
  const special = required.filter((prop) => specialKeys.includes(prop.key));
  const dropped = choose(rng, special.length > 0 && chance(rng, 0.6) ? special : required).key;
  return Object.fromEntries(Object.entries(value).filter(([key]) => key !== dropped));
}

function mutate(rng: Rng, category: Category, sites: readonly Site[], root: Json): Json {
  const options = sites.flatMap((candidate): { readonly path: Path; readonly replacement: Json }[] => {
    const replacement = mutationFor(rng, category, candidate);
    return replacement === null ? [] : [{ path: candidate.path, replacement }];
  });
  if (options.length === 0) {
    const rootSite = sites[sites.length - 1];
    return rootSite === undefined
      ? wrongContainer(rng, { kind: 'null', sens: null })
      : wrongContainer(rng, rootSite.spec);
  }
  const picked = choose(rng, options);
  return replaceAt(root, picked.path, picked.replacement);
}

function mutationFor(rng: Rng, category: Category, site: Site): Json | null {
  switch (category) {
    case 'leaf':
      return isLeafKind(unwrapped(site.spec)) ? wrongLeaf(rng, site.spec) : null;
    case 'undeclared':
      return withUndeclaredKey(rng, site.spec, site.value);
    case 'bound':
      return overBound(rng, site);
    case 'container':
      return wrongContainer(rng, site.spec);
    case 'missing':
      return withoutRequired(rng, site.spec, site.value);
    default:
      return null;
  }
}

function isLeafKind(spec: Spec): boolean {
  return (
    spec.kind === 'string' ||
    spec.kind === 'integer' ||
    spec.kind === 'number' ||
    spec.kind === 'boolean' ||
    spec.kind === 'null' ||
    spec.kind === 'literal'
  );
}

function settle(value: Json): Json {
  return JSON.parse(JSON.stringify(value));
}

export function generateCase(seed: number, index: number): Case {
  const rng = seeded(Math.imul(seed, 1_000_003) + index);
  const root = chance(rng, 0.55) ? objectSpec(rng, 0) : genSpec(rng, 0);
  const spec = root.kind === 'exposed' ? leafSpec(rng) : root;
  const schema = build(spec);
  const bases = Array.from({ length: 3 }, () => {
    const sites: Site[] = [];
    const value = makeValue(rng, spec, [], sites);
    return { value, sites };
  });
  const values = categoryOrder.map((category, position): CaseValue => {
    const base = bases[position % 3];
    if (base === undefined) {
      throw new RangeError('no base value');
    }
    if (category === 'valid') {
      return { category, value: settle(base.value) };
    }
    return { category, value: settle(mutate(rng, category, base.sites, base.value)) };
  });
  return { seed, index, spec, schema, values };
}

export function* corpus(seed: number, count: number): Generator<Case> {
  for (let index = 0; index < count; index++) {
    yield generateCase(seed, index);
  }
}

export function hasAstral(value: Json): boolean {
  if (typeof value === 'string') {
    return /[\uD800-\uDFFF]/.test(value);
  }
  if (Array.isArray(value)) {
    return value.some(hasAstral);
  }
  if (isObjectJson(value)) {
    return Object.entries(value).some(([key, item]) => hasAstral(key) || hasAstral(item));
  }
  return false;
}

function propsOf(spec: Spec): readonly Spec[] {
  switch (spec.kind) {
    case 'object':
      return spec.props.map((prop) => prop.spec);
    case 'array':
      return [spec.items];
    case 'record':
      return [spec.value];
    case 'union':
      return spec.members;
    default:
      return [];
  }
}

export function hasOpenMinimum(spec: Spec): boolean {
  if (spec.kind === 'object' && spec.open && spec.minProps !== null) {
    return true;
  }
  return propsOf(spec).some(hasOpenMinimum);
}

export function declaresKey(spec: Spec, keys: readonly string[]): boolean {
  if (spec.kind === 'object' && spec.props.some((prop) => keys.includes(prop.key))) {
    return true;
  }
  return propsOf(spec).some((inner) => declaresKey(inner, keys));
}

export function describeSpec(spec: Spec): string {
  return JSON.stringify(spec, (_key, held: unknown) => (held === Number.POSITIVE_INFINITY ? 'Infinity' : held));
}
