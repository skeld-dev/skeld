# @skeld/core/schema

## t.string

Creates a string schema; lengths count UTF-16 code units.

Without `maxLength` or a reason in `unbounded`, `listen` refuses the route (`UNBOUNDED_FIELD`); an empty reason throws `TypeError`.

```ts
export function string<S extends Sensitivity | undefined = undefined>(
  options: StringOptions & { readonly sensitivity?: S },
): StringSchema<Sealed<string, S>>;
```

```ts
t.string({ maxLength: 36 });
```

Source: `packages/core/src/schema/schema.ts:45`

## t.integer

Creates an integer schema.

Bounds are inclusive; a bound that is not finite or a minimum above the maximum makes `listen` refuse the route (`INVALID_BOUND`).

```ts
export function integer<S extends Sensitivity | undefined = undefined>(
  options?: NumberOptions & { readonly sensitivity?: S },
): IntegerSchema<Sealed<number, S>>;
```

```ts
t.integer({ minimum: 1, maximum: 100 });
```

Source: `packages/core/src/schema/schema.ts:66`

## t.number

Creates a schema for a finite number.

Bounds are inclusive; a bound that is not finite or a minimum above the maximum makes `listen` refuse the route (`INVALID_BOUND`).

```ts
export function number<S extends Sensitivity | undefined = undefined>(
  options?: NumberOptions & { readonly sensitivity?: S },
): NumberSchema<Sealed<number, S>>;
```

```ts
t.number({ minimum: 0 });
```

Source: `packages/core/src/schema/schema.ts:83`

## t.boolean

Creates a boolean schema.

```ts
export function boolean<S extends Sensitivity | undefined = undefined>(
  options?: NodeOptions & { readonly sensitivity?: S },
): BooleanSchema<Sealed<boolean, S>>;
```

```ts
t.boolean();
```

Source: `packages/core/src/schema/schema.ts:99`

## t.null

Creates a schema that accepts only `null`.

```ts
function nullSchema<S extends Sensitivity | undefined = undefined>(
  options?: NodeOptions & { readonly sensitivity?: S },
): NullSchema<Sealed<null, S>>;
```

```ts
t.null();
```

Source: `packages/core/src/schema/schema.ts:110`

## t.literal

Creates a schema that accepts exactly one string, number or boolean.

Its value is part of the contract and never a credential; a number that is not finite or a second argument throws `TypeError`.

```ts
export function literal<const V extends LiteralValue>(value: V): LiteralSchema<V>;
```

```ts
t.literal('admin');
```

Source: `packages/core/src/schema/schema.ts:122`

## t.object

Creates a closed object schema: a key it does not declare is refused.

With `open`, undeclared keys are accepted and dropped before the handler, and a body loses its derived cap; a property that is not a schema throws `TypeError`.

```ts
export function object<P extends Properties, S extends Sensitivity | undefined = undefined>(
  properties: P,
  options?: ObjectOptions & { readonly sensitivity?: S },
): ObjectSchema<P, S>;
```

```ts
t.object({ id: t.string({ maxLength: 36 }), age: t.optional(t.integer()) });
```

Source: `packages/core/src/schema/schema.ts:140`

## t.array

Creates an array schema.

Without `maxItems` or a reason in `unbounded`, `listen` refuses the route (`UNBOUNDED_FIELD`); an `optional` item schema throws `TypeError`.

```ts
export function array<I extends Schema, S extends Sensitivity | undefined = undefined>(
  items: I,
  options: ArrayOptions & { readonly sensitivity?: S },
): ArraySchema<I, Sealed<I['~static'][], S>>;
```

```ts
t.array(t.string({ maxLength: 32 }), { maxItems: 10 });
```

Source: `packages/core/src/schema/schema.ts:164`

## t.record

Creates a schema for an object with arbitrary string keys.

The key schema carries no data class (a marked one throws `TypeError`; mark the record); without `maxProperties` or `unbounded`, `listen` refuses the route (`UNBOUNDED_FIELD`).

```ts
export function record<V extends Schema, S extends Sensitivity | undefined = undefined>(
  key: StringSchema,
  value: V,
  options: RecordOptions & { readonly sensitivity?: S },
): RecordSchema<V, Sealed<Record<string, V['~static']>, S>>;
```

```ts
t.record(t.string({ maxLength: 16 }), t.integer(), { maxProperties: 50 });
```

Source: `packages/core/src/schema/schema.ts:193`

## t.union

Creates a schema that accepts what any member accepts, trying members in order.

An empty list or an `optional` member throws `TypeError`.

```ts
export function union<const M extends readonly Schema[], S extends Sensitivity | undefined = undefined>(
  members: M,
  options?: NodeOptions & { readonly sensitivity?: S },
): UnionSchema<M, Sealed<M[number]['~static'], S>>;
```

```ts
t.union([t.literal('card'), t.literal('cash')]);
```

Source: `packages/core/src/schema/schema.ts:229`

## t.optional

Marks an object property as one that may be absent.

It has its meaning only as an object property; as an array item, a record value, a union member or inside `t.optional` it throws `TypeError`.

```ts
export function optional<S extends Schema>(inner: S): OptionalSchema<S>;
```

```ts
t.object({ note: t.optional(t.string({ maxLength: 200 })) });
```

Source: `packages/core/src/schema/schema.ts:256`

## t.exposed

Allows a `secret` schema in a response, where its value is written raw.

The reason is exported as `x-exposure`; an inner schema not marked `secret`, or an empty reason, throws `TypeError`.

```ts
export function exposed<T, W>(inner: Schema<Secret<T>, W>, reason: string): ExposedSchema<W>;
```

```ts
t.exposed(t.string({ maxLength: 64, sensitivity: 'secret' }), 'returned once at creation');
```

Source: `packages/core/src/schema/schema.ts:272`

## t.pick

Derives an object schema with only the listed properties of a base.

The result keeps the base's `open` and data class, so a `secret` base stays `secret`; an unknown key throws `TypeError`.

```ts
export function pick<P extends Properties, S extends Sensitivity | undefined, const K extends keyof P>(
  base: ObjectSchema<P, S>,
  keys: readonly K[],
): ObjectSchema<Pick<P, K>, S>;
```

```ts
t.pick(t.object({ id: t.integer(), name: t.string({ maxLength: 64 }) }), ['name']);
```

Source: `packages/core/src/schema/schema.ts:313`

## t.omit

Derives an object schema with every property of a base except the listed ones.

A property added to the base later, a `personal` one included, reaches the result; it keeps the base's `open` and data class; an unknown key throws `TypeError`.

```ts
export function omit<P extends Properties, S extends Sensitivity | undefined, const K extends keyof P>(
  base: ObjectSchema<P, S>,
  keys: readonly K[],
): ObjectSchema<Omit<P, K>, S>;
```

```ts
t.omit(t.object({ id: t.integer(), name: t.string({ maxLength: 64 }) }), ['id']);
```

Source: `packages/core/src/schema/schema.ts:328`

## t.partial

Derives an object schema whose properties are all optional.

The result keeps the base's `open` and data class; `minProperties` refuses a value with fewer declared properties present.

```ts
export function partial<P extends Properties, S extends Sensitivity | undefined>(
  base: ObjectSchema<P, S>,
  options?: PartialOptions,
): ObjectSchema<PartialProperties<P>, S>;
```

```ts
t.partial(t.object({ name: t.string({ maxLength: 64 }) }), { minProperties: 1 });
```

Source: `packages/core/src/schema/schema.ts:343`

## t.extend

Derives an object schema with a base's properties followed by new ones.

The result keeps the base's `open` and data class; a key the base already declares throws `TypeError` (omit it first).

```ts
export function extend<P extends Properties, S extends Sensitivity | undefined, E extends Properties>(
  base: ObjectSchema<P, S>,
  props: E & { readonly [K in keyof P]?: never },
): ObjectSchema<P & E, S>;
```

```ts
t.extend(t.object({ id: t.integer() }), { active: t.boolean() });
```

Source: `packages/core/src/schema/schema.ts:363`

## Secret

A value marked `secret`: it prints, stringifies and serializes as `[secret]`.

It is not assignable to the value it holds; only `expose` returns that value.

```ts
export class Secret<T> {
  constructor(value: T);
  toString(): string;
  toJSON(): string;
  [Symbol.for('nodejs.util.inspect.custom')](): string;
}
```

```ts
String(new Secret('hunter2'));
```

Source: `packages/core/src/schema/secret.ts:11`

## ArrayOptions

The options of `t.array`: a `maxItems`, or a reason in `unbounded`.

```ts
export type ArrayOptions = (
  | {
      readonly maxItems: number;
      readonly unbounded?: never;
    }
  | {
      readonly unbounded: string;
      readonly maxItems?: never;
    }
) & {
  readonly minItems?: number;
  readonly sensitivity?: Sensitivity;
};
```

| Field         | Summary                                                                              |
| ------------- | ------------------------------------------------------------------------------------ |
| `maxItems`    | Most items the array may hold; in a body it sizes the route's derived body cap.      |
| `unbounded`   | Why the array has no item bound, exported as `x-unbounded`.                          |
| `minItems`    | Fewest items; above `maxItems` it makes `listen` refuse the route (`INVALID_BOUND`). |
| `sensitivity` | The array's data class, which covers every item.                                     |

Source: `packages/core/src/schema/types.ts:115`

## ArraySchema

An array schema, as `t.array` returns it.

```ts
export interface ArraySchema<I extends Schema = Schema, T = I['~static'][]> extends Schema<T, I['~wire'][]> {
  readonly kind: 'array';
  readonly items: I;
  readonly maxItems?: number;
  readonly minItems?: number;
  readonly unbounded?: string;
  readonly sensitivity?: Sensitivity;
}
```

| Field         | Summary                                              |
| ------------- | ---------------------------------------------------- |
| `kind`        | The schema's kind.                                   |
| `items`       | The schema every item must pass.                     |
| `maxItems`    | Most items accepted.                                 |
| `minItems`    | Fewest items accepted.                               |
| `unbounded`   | Why the array has no item bound.                     |
| `sensitivity` | The data class the schema was declared with, if any. |

Source: `packages/core/src/schema/types.ts:284`

## BooleanSchema

A boolean schema, as `t.boolean` returns it.

```ts
export interface BooleanSchema<T = boolean> extends Schema<T, boolean> {
  readonly kind: 'boolean';
  readonly sensitivity?: Sensitivity;
}
```

| Field         | Summary                                              |
| ------------- | ---------------------------------------------------- |
| `kind`        | The schema's kind.                                   |
| `sensitivity` | The data class the schema was declared with, if any. |

Source: `packages/core/src/schema/types.ts:260`

## ExposedSchema

A `secret` schema allowed in a response, as `t.exposed` returns it; its value is written raw.

```ts
export interface ExposedSchema<W> extends Schema<W, W> {
  readonly kind: 'exposed';
  readonly inner: Schema<unknown, W>;
  readonly reason: string;
}
```

| Field    | Summary                                                          |
| -------- | ---------------------------------------------------------------- |
| `kind`   | The schema's kind.                                               |
| `inner`  | The `secret` schema it wraps.                                    |
| `reason` | Why the value may leave in a response, exported as `x-exposure`. |

Source: `packages/core/src/schema/types.ts:356`

## Infer

The type validation hands a handler for a schema, with `secret` values as `Secret<T>`.

```ts
export type Infer<S extends Schema> = S['~static'];
```

Source: `packages/core/src/schema/types.ts:69`

## IntegerSchema

An integer schema, as `t.integer` returns it.

```ts
export interface IntegerSchema<T = number> extends Schema<T, number> {
  readonly kind: 'integer';
  readonly minimum?: number;
  readonly maximum?: number;
  readonly sensitivity?: Sensitivity;
}
```

| Field         | Summary                                              |
| ------------- | ---------------------------------------------------- |
| `kind`        | The schema's kind.                                   |
| `minimum`     | Smallest value accepted, inclusive.                  |
| `maximum`     | Largest value accepted, inclusive.                   |
| `sensitivity` | The data class the schema was declared with, if any. |

Source: `packages/core/src/schema/types.ts:236`

## Issue

One validation failure, as `~standard.validate` reports it.

```ts
export interface Issue {
  readonly message: string;
  readonly path: readonly (string | number)[];
}
```

| Field     | Summary                                                              |
| --------- | -------------------------------------------------------------------- |
| `message` | What is wrong; it never holds the received value.                    |
| `path`    | Property names and array indexes from the root to the failing value. |

Source: `packages/core/src/schema/types.ts:28`

## JsonSchema

A JSON Schema 2020-12 document, as plain JSON.

```ts
export interface JsonSchema {
  readonly [keyword: string]: unknown;
}
```

Source: `packages/core/src/schema/types.ts:366`

## Kind

The twelve kinds of schema the builders make.

```ts
export type Kind =
  | 'string'
  | 'integer'
  | 'number'
  | 'boolean'
  | 'null'
  | 'literal'
  | 'object'
  | 'array'
  | 'record'
  | 'union'
  | 'optional'
  | 'exposed';
```

Source: `packages/core/src/schema/types.ts:7`

## LiteralSchema

A schema that accepts one value, as `t.literal` returns it.

```ts
export interface LiteralSchema<V extends LiteralValue = LiteralValue> extends Schema<V, V> {
  readonly kind: 'literal';
  readonly value: V;
}
```

| Field   | Summary                 |
| ------- | ----------------------- |
| `kind`  | The schema's kind.      |
| `value` | The one value accepted. |

Source: `packages/core/src/schema/types.ts:276`

## LiteralValue

The values `t.literal` accepts; a number must be finite.

```ts
export type LiteralValue = string | number | boolean;
```

Source: `packages/core/src/schema/types.ts:202`

## NodeOptions

The options of `t.boolean`, `t.null` and `t.union`.

```ts
export interface NodeOptions {
  readonly sensitivity?: Sensitivity;
}
```

| Field         | Summary                 |
| ------------- | ----------------------- |
| `sensitivity` | The value's data class. |

Source: `packages/core/src/schema/types.ts:78`

## NullSchema

A schema that accepts only `null`, as `t.null` returns it.

```ts
export interface NullSchema<T = null> extends Schema<T, null> {
  readonly kind: 'null';
  readonly sensitivity?: Sensitivity;
}
```

| Field         | Summary                                              |
| ------------- | ---------------------------------------------------- |
| `kind`        | The schema's kind.                                   |
| `sensitivity` | The data class the schema was declared with, if any. |

Source: `packages/core/src/schema/types.ts:268`

## NumberOptions

The options of `t.integer` and `t.number`.

```ts
export interface NumberOptions {
  readonly minimum?: number;
  readonly maximum?: number;
  readonly sensitivity?: Sensitivity;
}
```

| Field         | Summary                                                                                                           |
| ------------- | ----------------------------------------------------------------------------------------------------------------- |
| `minimum`     | Smallest value accepted, inclusive; a bound that is not finite makes `listen` refuse the route (`INVALID_BOUND`). |
| `maximum`     | Largest value accepted, inclusive; below `minimum` it makes `listen` refuse the route (`INVALID_BOUND`).          |
| `sensitivity` | The value's data class.                                                                                           |

Source: `packages/core/src/schema/types.ts:169`

## NumberSchema

A schema for a finite number, as `t.number` returns it.

```ts
export interface NumberSchema<T = number> extends Schema<T, number> {
  readonly kind: 'number';
  readonly minimum?: number;
  readonly maximum?: number;
  readonly sensitivity?: Sensitivity;
}
```

| Field         | Summary                                              |
| ------------- | ---------------------------------------------------- |
| `kind`        | The schema's kind.                                   |
| `minimum`     | Smallest value accepted, inclusive.                  |
| `maximum`     | Largest value accepted, inclusive.                   |
| `sensitivity` | The data class the schema was declared with, if any. |

Source: `packages/core/src/schema/types.ts:248`

## ObjectOptions

The options of `t.object`.

```ts
export interface ObjectOptions {
  readonly open?: string;
  readonly sensitivity?: Sensitivity;
}
```

| Field         | Summary                                                                                      |
| ------------- | -------------------------------------------------------------------------------------------- |
| `open`        | Why the object accepts undeclared keys, which are dropped before the handler sees the value. |
| `sensitivity` | The object's data class, which protects every property inside it.                            |

Source: `packages/core/src/schema/types.ts:182`

## ObjectSchema

An object schema, as `t.object` and the four derivations return it.

```ts
export interface ObjectSchema<P extends Properties = Properties, S extends Sensitivity | undefined = undefined>
  extends Schema<Sealed<ObjectStatic<P>, S>, ObjectWire<P>> {
  readonly kind: 'object';
  readonly properties: P;
  readonly open?: string;
  readonly minProperties?: number;
  readonly sensitivity?: Sensitivity;
}
```

| Field           | Summary                                                       |
| --------------- | ------------------------------------------------------------- |
| `kind`          | The schema's kind.                                            |
| `properties`    | The declared properties, in declaration order.                |
| `open`          | Why undeclared keys are accepted; absent for a closed object. |
| `minProperties` | Fewest declared properties that must be present.              |
| `sensitivity`   | The data class the schema was declared with, if any.          |

Source: `packages/core/src/schema/types.ts:333`

## ObjectStatic

The value type of an object's properties, where a property made with `t.optional` is an optional key.

```ts
export type ObjectStatic<P extends Properties> = { [K in Exclude<keyof P, OptionalKeys<P>>]: P[K]['~static'] } & {
  [K in OptionalKeys<P>]?: P[K]['~static'];
};
```

Source: `packages/core/src/schema/types.ts:212`

## ObjectWire

The wire type of an object's properties, where a property made with `t.optional` is an optional key.

```ts
export type ObjectWire<P extends Properties> = { [K in Exclude<keyof P, OptionalKeys<P>>]: P[K]['~wire'] } & {
  [K in OptionalKeys<P>]?: P[K]['~wire'];
};
```

Source: `packages/core/src/schema/types.ts:217`

## OptionalSchema

A property schema that may be absent, as `t.optional` returns it.

```ts
export interface OptionalSchema<S extends Schema = Schema> extends Schema<S['~static'], S['~wire']> {
  readonly kind: 'optional';
  readonly inner: S;
}
```

| Field   | Summary                               |
| ------- | ------------------------------------- |
| `kind`  | The schema's kind.                    |
| `inner` | The schema of the value when present. |

Source: `packages/core/src/schema/types.ts:348`

## PartialOptions

The options of `t.partial`.

```ts
export interface PartialOptions {
  readonly minProperties?: number;
}
```

| Field           | Summary                                                                                                      |
| --------------- | ------------------------------------------------------------------------------------------------------------ |
| `minProperties` | Fewest declared properties that must be present, to refuse an empty PATCH body; undeclared keys never count. |

Source: `packages/core/src/schema/types.ts:196`

## PartialProperties

The properties of a `t.partial` result: each one wrapped in `t.optional` unless it already was.

```ts
export type PartialProperties<P extends Properties> = {
  readonly [K in keyof P]: P[K] extends { readonly kind: 'optional' } ? P[K] : OptionalSchema<P[K]>;
};
```

Source: `packages/core/src/schema/types.ts:328`

## Properties

An object schema's properties, by key.

```ts
export interface Properties {
  readonly [key: string]: Schema;
}
```

Source: `packages/core/src/schema/types.ts:205`

## RecordOptions

The options of `t.record`: a `maxProperties`, or a reason in `unbounded`.

```ts
export type RecordOptions = (
  | {
      readonly maxProperties: number;
      readonly unbounded?: never;
    }
  | {
      readonly unbounded: string;
      readonly maxProperties?: never;
    }
) & {
  readonly sensitivity?: Sensitivity;
};
```

| Field           | Summary                                                                         |
| --------------- | ------------------------------------------------------------------------------- |
| `maxProperties` | Most keys the record may hold; in a body it sizes the route's derived body cap. |
| `unbounded`     | Why the record has no key bound, exported as `x-unbounded`.                     |
| `sensitivity`   | The record's data class, which covers its keys and values.                      |

Source: `packages/core/src/schema/types.ts:143`

## RecordSchema

A schema for an object with arbitrary string keys, as `t.record` returns it.

```ts
export interface RecordSchema<V extends Schema = Schema, T = Record<string, V['~static']>>
  extends Schema<T, Record<string, V['~wire']>> {
  readonly kind: 'record';
  readonly key: StringSchema;
  readonly value: V;
  readonly maxProperties?: number;
  readonly unbounded?: string;
  readonly sensitivity?: Sensitivity;
}
```

| Field           | Summary                                                   |
| --------------- | --------------------------------------------------------- |
| `kind`          | The schema's kind.                                        |
| `key`           | The schema every key must pass; it carries no data class. |
| `value`         | The schema every value must pass.                         |
| `maxProperties` | Most keys accepted.                                       |
| `unbounded`     | Why the record has no key bound.                          |
| `sensitivity`   | The data class the schema was declared with, if any.      |

Source: `packages/core/src/schema/types.ts:300`

## Schema

A schema made by a builder of `@skeld/core/schema`: frozen, typed for both sides of the wire.

A plain object of the same shape is not a schema: the builders and `defineContract` refuse it.

```ts
export interface Schema<T = unknown, W = unknown> {
  readonly kind: Kind;
  readonly '~static': T;
  readonly '~wire': W;
  readonly '~standard': StandardProps<W, T>;
}
```

| Field       | Summary                                                                                 |
| ----------- | --------------------------------------------------------------------------------------- |
| `kind`      | The schema's kind.                                                                      |
| `~static`   | The type validation hands a handler; type-only, absent at run time.                     |
| `~wire`     | The type of the JSON value on the wire; type-only, absent at run time.                  |
| `~standard` | The Standard Schema v1 interface, so tools that read Standard Schema accept the schema. |

Source: `packages/core/src/schema/types.ts:57`

## Sealed

The value type a data class gives: wrapped in `Secret` for `secret`, plain otherwise.

```ts
export type Sealed<T, S> = S extends 'secret' ? Secret<T> : T;
```

Source: `packages/core/src/schema/types.ts:75`

## Sensitivity

A data class: `secret` for passwords, tokens and keys; `personal` for data about a person.

An error under a marked value reports one issue at its path and names no key or item inside it.

```ts
export type Sensitivity = 'secret' | 'personal';
```

Source: `packages/core/src/schema/types.ts:25`

## StandardProps

The Standard Schema v1 interface every schema carries under `~standard`.

```ts
export interface StandardProps<I, O> {
  readonly version: 1;
  readonly vendor: 'skeld';
  readonly validate: (value: unknown) => { readonly value: O } | { readonly issues: readonly Issue[] };
  readonly types?: { readonly input: I; readonly output: O } | undefined;
}
```

| Field      | Summary                                                                                  |
| ---------- | ---------------------------------------------------------------------------------------- |
| `version`  | The Standard Schema version.                                                             |
| `vendor`   | The library that made the schema.                                                        |
| `validate` | Checks a value synchronously: `{ value }` with `secret` values wrapped, or `{ issues }`. |
| `types`    | The input and output types, for type inference only; absent at run time.                 |

Source: `packages/core/src/schema/types.ts:39`

## StringOptions

The options of `t.string`: a `maxLength`, or a reason in `unbounded`.

```ts
export type StringOptions = (
  | {
      readonly maxLength: number;
      readonly unbounded?: never;
    }
  | {
      readonly unbounded: string;
      readonly maxLength?: never;
    }
) & {
  readonly minLength?: number;
  readonly sensitivity?: Sensitivity;
};
```

| Field         | Summary                                                                                           |
| ------------- | ------------------------------------------------------------------------------------------------- |
| `maxLength`   | Most UTF-16 code units the string may hold; in a body it sizes the route's derived body cap.      |
| `unbounded`   | Why the string has no length bound, exported as `x-unbounded`.                                    |
| `minLength`   | Fewest UTF-16 code units; above `maxLength` it makes `listen` refuse the route (`INVALID_BOUND`). |
| `sensitivity` | The value's data class.                                                                           |

Source: `packages/core/src/schema/types.ts:87`

## StringSchema

A string schema, as `t.string` returns it.

```ts
export interface StringSchema<T = string> extends Schema<T, string> {
  readonly kind: 'string';
  readonly maxLength?: number;
  readonly minLength?: number;
  readonly unbounded?: string;
  readonly sensitivity?: Sensitivity;
}
```

| Field         | Summary                                              |
| ------------- | ---------------------------------------------------- |
| `kind`        | The schema's kind.                                   |
| `maxLength`   | Most UTF-16 code units accepted.                     |
| `minLength`   | Fewest UTF-16 code units accepted.                   |
| `unbounded`   | Why the string has no length bound.                  |
| `sensitivity` | The data class the schema was declared with, if any. |

Source: `packages/core/src/schema/types.ts:222`

## UnionSchema

A schema that accepts what any member accepts, as `t.union` returns it.

```ts
export interface UnionSchema<M extends readonly Schema[] = readonly Schema[], T = M[number]['~static']>
  extends Schema<T, M[number]['~wire']> {
  readonly kind: 'union';
  readonly members: M;
  readonly sensitivity?: Sensitivity;
}
```

| Field         | Summary                                              |
| ------------- | ---------------------------------------------------- |
| `kind`        | The schema's kind.                                   |
| `members`     | The member schemas, tried in declaration order.      |
| `sensitivity` | The data class the schema was declared with, if any. |

Source: `packages/core/src/schema/types.ts:317`

## Wire

The JSON type of a schema on the wire, with `secret` values raw.

```ts
export type Wire<S extends Schema> = S['~wire'];
```

Source: `packages/core/src/schema/types.ts:72`
