// Does:  Defines the builders, the only way to make a schema node.
// Holds: Every builder refuses a child that is not a node, and optional is accepted only as an object property.

import { createNode } from './create.ts';
import { isNode, type RuntimeNode } from './node.ts';
import type { Secret } from './secret.ts';
import type {
  ArrayOptions,
  ArraySchema,
  BooleanSchema,
  ExposedSchema,
  IntegerSchema,
  LiteralSchema,
  LiteralValue,
  NodeOptions,
  NullSchema,
  NumberOptions,
  NumberSchema,
  ObjectOptions,
  ObjectSchema,
  OptionalSchema,
  PartialOptions,
  PartialProperties,
  Properties,
  RecordOptions,
  RecordSchema,
  Schema,
  Sealed,
  Sensitivity,
  StringOptions,
  StringSchema,
  UnionSchema,
} from './types.ts';

// Why: A reason is the written justification for an opt-out; an empty string is no reason.
function isEmptyReason(reason: string): boolean {
  return reason.trim() === '';
}

/**
 * Creates a string schema; lengths count UTF-16 code units.
 * Without `maxLength` or a reason in `unbounded`, `listen` refuses the route (`UNBOUNDED_FIELD`); an empty reason throws `TypeError`.
 * @example t.string({ maxLength: 36 })
 */
export function string<S extends Sensitivity | undefined = undefined>(
  options: StringOptions & { readonly sensitivity?: S },
): StringSchema<Sealed<string, S>>;
export function string(options: StringOptions): RuntimeNode {
  if (options.unbounded !== undefined && isEmptyReason(options.unbounded)) {
    throw new TypeError('t.string: unbounded needs a reason, got an empty string');
  }
  return createNode({
    kind: 'string',
    maxLength: options.maxLength,
    minLength: options.minLength,
    unbounded: options.unbounded,
    sensitivity: options.sensitivity,
  });
}

/**
 * Creates an integer schema.
 * Bounds are inclusive; a bound that is not finite or a minimum above the maximum makes `listen` refuse the route (`INVALID_BOUND`).
 * @example t.integer({ minimum: 1, maximum: 100 })
 */
export function integer<S extends Sensitivity | undefined = undefined>(
  options?: NumberOptions & { readonly sensitivity?: S },
): IntegerSchema<Sealed<number, S>>;
export function integer(options?: NumberOptions): RuntimeNode {
  return createNode({
    kind: 'integer',
    minimum: options?.minimum,
    maximum: options?.maximum,
    sensitivity: options?.sensitivity,
  });
}

/**
 * Creates a schema for a finite number.
 * Bounds are inclusive; a bound that is not finite or a minimum above the maximum makes `listen` refuse the route (`INVALID_BOUND`).
 * @example t.number({ minimum: 0 })
 */
export function number<S extends Sensitivity | undefined = undefined>(
  options?: NumberOptions & { readonly sensitivity?: S },
): NumberSchema<Sealed<number, S>>;
export function number(options?: NumberOptions): RuntimeNode {
  return createNode({
    kind: 'number',
    minimum: options?.minimum,
    maximum: options?.maximum,
    sensitivity: options?.sensitivity,
  });
}

/**
 * Creates a boolean schema.
 * @example t.boolean()
 */
export function boolean<S extends Sensitivity | undefined = undefined>(
  options?: NodeOptions & { readonly sensitivity?: S },
): BooleanSchema<Sealed<boolean, S>>;
export function boolean(options?: NodeOptions): RuntimeNode {
  return createNode({ kind: 'boolean', sensitivity: options?.sensitivity });
}

/**
 * Creates a schema that accepts only `null`.
 * @example t.null()
 */
function nullSchema<S extends Sensitivity | undefined = undefined>(
  options?: NodeOptions & { readonly sensitivity?: S },
): NullSchema<Sealed<null, S>>;
function nullSchema(options?: NodeOptions): RuntimeNode {
  return createNode({ kind: 'null', sensitivity: options?.sensitivity });
}

/**
 * Creates a schema that accepts exactly one string, number or boolean.
 * Its value is part of the contract and never a credential; a number that is not finite or a second argument throws `TypeError`.
 * @example t.literal('admin')
 */
export function literal<const V extends LiteralValue>(value: V): LiteralSchema<V>;
export function literal(value: LiteralValue, options?: unknown): RuntimeNode {
  if (typeof value !== 'string' && typeof value !== 'boolean' && !Number.isFinite(value)) {
    throw new TypeError('t.literal: value must be a string, a finite number or a boolean');
  }
  if (options !== undefined) {
    throw new TypeError(
      "t.literal: takes no options; a literal's value is part of the contract and cannot carry sensitivity",
    );
  }
  return createNode({ kind: 'literal', value });
}

/**
 * Creates a closed object schema: a key it does not declare is refused.
 * With `open`, undeclared keys are accepted and dropped before the handler, and a body loses its derived cap; a property that is not a schema throws `TypeError`.
 * @example t.object({ id: t.string({ maxLength: 36 }), age: t.optional(t.integer()) })
 */
export function object<P extends Properties, S extends Sensitivity | undefined = undefined>(
  properties: P,
  options?: ObjectOptions & { readonly sensitivity?: S },
): ObjectSchema<P, S>;
export function object(properties: Properties, options?: ObjectOptions): RuntimeNode {
  if (options?.open !== undefined && isEmptyReason(options.open)) {
    throw new TypeError('t.object: open needs a reason, got an empty string');
  }
  const captured: Record<string, Schema> = Object.create(null);
  for (const key of Object.keys(properties)) {
    const child = properties[key];
    if (!isNode(child)) {
      throw new TypeError(`t.object: property "${key}" is not a schema`);
    }
    captured[key] = child;
  }
  return createNode({ kind: 'object', properties: captured, open: options?.open, sensitivity: options?.sensitivity });
}

/**
 * Creates an array schema.
 * Without `maxItems` or a reason in `unbounded`, `listen` refuses the route (`UNBOUNDED_FIELD`); an `optional` item schema throws `TypeError`.
 * @example t.array(t.string({ maxLength: 32 }), { maxItems: 10 })
 */
export function array<I extends Schema, S extends Sensitivity | undefined = undefined>(
  items: I,
  options: ArrayOptions & { readonly sensitivity?: S },
): ArraySchema<I, Sealed<I['~static'][], S>>;
export function array(items: Schema, options: ArrayOptions): RuntimeNode {
  if (options.unbounded !== undefined && isEmptyReason(options.unbounded)) {
    throw new TypeError('t.array: unbounded needs a reason, got an empty string');
  }
  if (!isNode(items)) {
    throw new TypeError('t.array: items is not a schema');
  }
  if (items.kind === 'optional') {
    throw new TypeError('t.array: items cannot be optional; optional is allowed only as an object property');
  }
  return createNode({
    kind: 'array',
    items,
    maxItems: options.maxItems,
    minItems: options.minItems,
    unbounded: options.unbounded,
    sensitivity: options.sensitivity,
  });
}

/**
 * Creates a schema for an object with arbitrary string keys.
 * The key schema carries no data class (a marked one throws `TypeError`; mark the record); without `maxProperties` or `unbounded`, `listen` refuses the route (`UNBOUNDED_FIELD`).
 * @example t.record(t.string({ maxLength: 16 }), t.integer(), { maxProperties: 50 })
 */
export function record<V extends Schema, S extends Sensitivity | undefined = undefined>(
  key: StringSchema,
  value: V,
  options: RecordOptions & { readonly sensitivity?: S },
): RecordSchema<V, Sealed<Record<string, V['~static']>, S>>;
export function record(key: StringSchema, value: Schema, options: RecordOptions): RuntimeNode {
  if (options.unbounded !== undefined && isEmptyReason(options.unbounded)) {
    throw new TypeError('t.record: unbounded needs a reason, got an empty string');
  }
  if (!isNode(key) || key.kind !== 'string') {
    throw new TypeError('t.record: key must be a string schema');
  }
  if (key.sensitivity !== undefined) {
    throw new TypeError('t.record: key cannot carry sensitivity; mark the record');
  }
  if (!isNode(value)) {
    throw new TypeError('t.record: value is not a schema');
  }
  if (value.kind === 'optional') {
    throw new TypeError('t.record: value cannot be optional; optional is allowed only as an object property');
  }
  return createNode({
    kind: 'record',
    key,
    value,
    maxProperties: options.maxProperties,
    unbounded: options.unbounded,
    sensitivity: options.sensitivity,
  });
}

/**
 * Creates a schema that accepts what any member accepts, trying members in order.
 * An empty list or an `optional` member throws `TypeError`.
 * @example t.union([t.literal('card'), t.literal('cash')])
 */
export function union<const M extends readonly Schema[], S extends Sensitivity | undefined = undefined>(
  members: M,
  options?: NodeOptions & { readonly sensitivity?: S },
): UnionSchema<M, Sealed<M[number]['~static'], S>>;
export function union(members: readonly Schema[], options?: NodeOptions): RuntimeNode {
  const captured = Array.from(members);
  if (captured.length === 0) {
    throw new TypeError('t.union: needs at least one member');
  }
  for (const [index, member] of captured.entries()) {
    if (!isNode(member)) {
      throw new TypeError(`t.union: member ${index} is not a schema`);
    }
    if (member.kind === 'optional') {
      throw new TypeError(
        `t.union: member ${index} cannot be optional; optional is allowed only as an object property`,
      );
    }
  }
  return createNode({ kind: 'union', members: captured, sensitivity: options?.sensitivity });
}

/**
 * Marks an object property as one that may be absent.
 * It has its meaning only as an object property; as an array item, a record value, a union member or inside `t.optional` it throws `TypeError`.
 * @example t.object({ note: t.optional(t.string({ maxLength: 200 })) })
 */
export function optional<S extends Schema>(inner: S): OptionalSchema<S>;
export function optional(inner: Schema): RuntimeNode {
  if (!isNode(inner)) {
    throw new TypeError('t.optional: inner is not a schema');
  }
  if (inner.kind === 'optional') {
    throw new TypeError('t.optional: inner cannot be optional');
  }
  return createNode({ kind: 'optional', inner });
}

/**
 * Allows a `secret` schema in a response, where its value is written raw.
 * The reason is exported as `x-exposure`; an inner schema not marked `secret`, or an empty reason, throws `TypeError`.
 * @example t.exposed(t.string({ maxLength: 64, sensitivity: 'secret' }), 'returned once at creation')
 */
export function exposed<T, W>(inner: Schema<Secret<T>, W>, reason: string): ExposedSchema<W>;
export function exposed(inner: Schema & { readonly sensitivity?: Sensitivity }, reason: string): RuntimeNode {
  if (!isNode(inner)) {
    throw new TypeError('t.exposed: inner is not a schema');
  }
  if (inner.sensitivity !== 'secret') {
    throw new TypeError("t.exposed: inner is not marked sensitivity: 'secret'");
  }
  if (isEmptyReason(reason)) {
    throw new TypeError('t.exposed: reason needs text, got an empty string');
  }
  return createNode({ kind: 'exposed', inner, reason });
}

function checkBase(member: string, base: ObjectSchema): void {
  if (!isNode(base) || base.kind !== 'object') {
    throw new TypeError(`t.${member}: base is not an object schema`);
  }
}

function selectKeys(member: string, base: ObjectSchema, keys: readonly (string | number)[]): Set<string> {
  const selected = new Set<string>();
  for (const key of keys) {
    const name = String(key);
    if (!Object.hasOwn(base.properties, name)) {
      throw new TypeError(`t.${member}: unknown key "${name}"`);
    }
    selected.add(name);
  }
  return selected;
}

function derived(base: ObjectSchema, properties: Properties, minProperties?: number): RuntimeNode {
  return createNode({ kind: 'object', properties, open: base.open, minProperties, sensitivity: base.sensitivity });
}

/**
 * Derives an object schema with only the listed properties of a base.
 * The result keeps the base's `open` and data class, so a `secret` base stays `secret`; an unknown key throws `TypeError`.
 * @example t.pick(t.object({ id: t.integer(), name: t.string({ maxLength: 64 }) }), ['name'])
 */
export function pick<P extends Properties, S extends Sensitivity | undefined, const K extends keyof P>(
  base: ObjectSchema<P, S>,
  keys: readonly K[],
): ObjectSchema<Pick<P, K>, S>;
export function pick(base: ObjectSchema, keys: readonly (string | number)[]): RuntimeNode {
  checkBase('pick', base);
  const selected = selectKeys('pick', base, keys);
  return derived(base, Object.fromEntries(Object.entries(base.properties).filter(([key]) => selected.has(key))));
}

/**
 * Derives an object schema with every property of a base except the listed ones.
 * A property added to the base later, a `personal` one included, reaches the result; it keeps the base's `open` and data class; an unknown key throws `TypeError`.
 * @example t.omit(t.object({ id: t.integer(), name: t.string({ maxLength: 64 }) }), ['id'])
 */
export function omit<P extends Properties, S extends Sensitivity | undefined, const K extends keyof P>(
  base: ObjectSchema<P, S>,
  keys: readonly K[],
): ObjectSchema<Omit<P, K>, S>;
export function omit(base: ObjectSchema, keys: readonly (string | number)[]): RuntimeNode {
  checkBase('omit', base);
  const selected = selectKeys('omit', base, keys);
  return derived(base, Object.fromEntries(Object.entries(base.properties).filter(([key]) => !selected.has(key))));
}

/**
 * Derives an object schema whose properties are all optional.
 * The result keeps the base's `open` and data class; `minProperties` refuses a value with fewer declared properties present.
 * @example t.partial(t.object({ name: t.string({ maxLength: 64 }) }), { minProperties: 1 })
 */
export function partial<P extends Properties, S extends Sensitivity | undefined>(
  base: ObjectSchema<P, S>,
  options?: PartialOptions,
): ObjectSchema<PartialProperties<P>, S>;
export function partial(base: ObjectSchema, options?: PartialOptions): RuntimeNode {
  checkBase('partial', base);
  const properties = Object.fromEntries(
    Object.entries(base.properties).map(([key, schema]) => [
      key,
      schema.kind === 'optional' ? schema : optional(schema),
    ]),
  );
  return derived(base, properties, options?.minProperties);
}

/**
 * Derives an object schema with a base's properties followed by new ones.
 * The result keeps the base's `open` and data class; a key the base already declares throws `TypeError` (omit it first).
 * @example t.extend(t.object({ id: t.integer() }), { active: t.boolean() })
 */
export function extend<P extends Properties, S extends Sensitivity | undefined, E extends Properties>(
  base: ObjectSchema<P, S>,
  props: E & { readonly [K in keyof P]?: never },
): ObjectSchema<P & E, S>;
export function extend(base: ObjectSchema, props: Properties): RuntimeNode {
  checkBase('extend', base);
  const captured: Record<string, Schema> = Object.create(null);
  for (const key of Object.keys(props)) {
    if (Object.hasOwn(base.properties, key)) {
      throw new TypeError(`t.extend: key "${key}" is already declared; omit it first`);
    }
    const child = props[key];
    if (!isNode(child)) {
      throw new TypeError(`t.extend: property "${key}" is not a schema`);
    }
    captured[key] = child;
  }
  return derived(base, Object.fromEntries([...Object.entries(base.properties), ...Object.entries(captured)]));
}

export { nullSchema as null };

export type { Secret } from './secret.ts';
export type {
  ArrayOptions,
  ArraySchema,
  BooleanSchema,
  ExposedSchema,
  Infer,
  IntegerSchema,
  Issue,
  JsonSchema,
  Kind,
  LiteralSchema,
  LiteralValue,
  NodeOptions,
  NullSchema,
  NumberOptions,
  NumberSchema,
  ObjectOptions,
  ObjectSchema,
  ObjectStatic,
  ObjectWire,
  OptionalSchema,
  PartialOptions,
  PartialProperties,
  Properties,
  RecordOptions,
  RecordSchema,
  Schema,
  Sealed,
  Sensitivity,
  StandardProps,
  StringOptions,
  StringSchema,
  UnionSchema,
  Wire,
} from './types.ts';
