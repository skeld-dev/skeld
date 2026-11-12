// Does:  Declares the type system's public types: schema nodes, options, inference and findings.
// Holds: A schema's ~static and ~wire types are phantom: they exist for the compiler and carry no run-time value.

import type { Secret } from './secret.ts';

/** The twelve kinds of schema the builders make. */
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

/**
 * A data class: `secret` for passwords, tokens and keys; `personal` for data about a person.
 * An error under a marked value reports one issue at its path and names no key or item inside it.
 */
export type Sensitivity = 'secret' | 'personal';

/** One validation failure, as `~standard.validate` reports it. */
export interface Issue {
  /** What is wrong; it never holds the received value. */
  readonly message: string;
  /**
   * Property names and array indexes from the root to the failing value.
   * Under a value marked `secret` or `personal` it stops at that value.
   */
  readonly path: readonly (string | number)[];
}

/** The Standard Schema v1 interface every schema carries under `~standard`. */
export interface StandardProps<I, O> {
  /** The Standard Schema version. */
  readonly version: 1;
  /** The library that made the schema. */
  readonly vendor: 'skeld';
  /**
   * Checks a value synchronously: `{ value }` with `secret` values wrapped, or `{ issues }`.
   * At most 100 issues; under a value marked `secret` or `personal`, one issue at its path.
   */
  readonly validate: (value: unknown) => { readonly value: O } | { readonly issues: readonly Issue[] };
  /** The input and output types, for type inference only; absent at run time. */
  readonly types?: { readonly input: I; readonly output: O } | undefined;
}

/**
 * A schema made by a builder of `@skeld/core/schema`: frozen, typed for both sides of the wire.
 * A plain object of the same shape is not a schema: the builders and `defineContract` refuse it.
 */
export interface Schema<T = unknown, W = unknown> {
  /** The schema's kind. */
  readonly kind: Kind;
  /** The type validation hands a handler; type-only, absent at run time. */
  readonly '~static': T;
  /** The type of the JSON value on the wire; type-only, absent at run time. */
  readonly '~wire': W;
  /** The Standard Schema v1 interface, so tools that read Standard Schema accept the schema. */
  readonly '~standard': StandardProps<W, T>;
}

/** The type validation hands a handler for a schema, with `secret` values as `Secret<T>`. */
export type Infer<S extends Schema> = S['~static'];

/** The JSON type of a schema on the wire, with `secret` values raw. */
export type Wire<S extends Schema> = S['~wire'];

/** The value type a data class gives: wrapped in `Secret` for `secret`, plain otherwise. */
export type Sealed<T, S> = S extends 'secret' ? Secret<T> : T;

/** The options of `t.boolean`, `t.null` and `t.union`. */
export interface NodeOptions {
  /**
   * The value's data class.
   * A `secret` value reaches a handler as `Secret<T>`; `listen` refuses it in a response unless `t.exposed` wraps it.
   */
  readonly sensitivity?: Sensitivity;
}

/** The options of `t.string`: a `maxLength`, or a reason in `unbounded`. */
export type StringOptions = (
  | {
      /**
       * Most UTF-16 code units the string may hold; in a body it sizes the route's derived body cap.
       * A count that is not a non-negative integer makes `listen` refuse the route (`INVALID_BOUND`).
       */
      readonly maxLength: number;
      readonly unbounded?: never;
    }
  | {
      /**
       * Why the string has no length bound, exported as `x-unbounded`.
       * In a body it lifts the route's derived body cap, leaving `bodyLimit`; an empty reason throws `TypeError`.
       */
      readonly unbounded: string;
      readonly maxLength?: never;
    }
) & {
  /** Fewest UTF-16 code units; above `maxLength` it makes `listen` refuse the route (`INVALID_BOUND`). */
  readonly minLength?: number;
  /**
   * The value's data class.
   * A `secret` value reaches a handler as `Secret<T>`; `listen` refuses it in a response unless `t.exposed` wraps it.
   */
  readonly sensitivity?: Sensitivity;
};

/** The options of `t.array`: a `maxItems`, or a reason in `unbounded`. */
export type ArrayOptions = (
  | {
      /**
       * Most items the array may hold; in a body it sizes the route's derived body cap.
       * A count that is not a non-negative integer makes `listen` refuse the route (`INVALID_BOUND`).
       */
      readonly maxItems: number;
      readonly unbounded?: never;
    }
  | {
      /**
       * Why the array has no item bound, exported as `x-unbounded`.
       * In a body it lifts the route's derived body cap, leaving `bodyLimit`; an empty reason throws `TypeError`.
       */
      readonly unbounded: string;
      readonly maxItems?: never;
    }
) & {
  /** Fewest items; above `maxItems` it makes `listen` refuse the route (`INVALID_BOUND`). */
  readonly minItems?: number;
  /**
   * The array's data class, which covers every item.
   * A `secret` array reaches a handler as `Secret<T>`; `listen` refuses it in a response unless `t.exposed` wraps it.
   */
  readonly sensitivity?: Sensitivity;
};

/** The options of `t.record`: a `maxProperties`, or a reason in `unbounded`. */
export type RecordOptions = (
  | {
      /**
       * Most keys the record may hold; in a body it sizes the route's derived body cap.
       * A count that is not a non-negative integer makes `listen` refuse the route (`INVALID_BOUND`).
       */
      readonly maxProperties: number;
      readonly unbounded?: never;
    }
  | {
      /**
       * Why the record has no key bound, exported as `x-unbounded`.
       * In a body it lifts the route's derived body cap, leaving `bodyLimit`; an empty reason throws `TypeError`.
       */
      readonly unbounded: string;
      readonly maxProperties?: never;
    }
) & {
  /**
   * The record's data class, which covers its keys and values.
   * A key schema carries no class of its own (`t.record` throws `TypeError`); a `secret` record arrives as `Secret<T>`.
   */
  readonly sensitivity?: Sensitivity;
};

/** The options of `t.integer` and `t.number`. */
export interface NumberOptions {
  /** Smallest value accepted, inclusive; a bound that is not finite makes `listen` refuse the route (`INVALID_BOUND`). */
  readonly minimum?: number;
  /** Largest value accepted, inclusive; below `minimum` it makes `listen` refuse the route (`INVALID_BOUND`). */
  readonly maximum?: number;
  /**
   * The value's data class.
   * A `secret` value reaches a handler as `Secret<T>`; `listen` refuses it in a response unless `t.exposed` wraps it.
   */
  readonly sensitivity?: Sensitivity;
}

/** The options of `t.object`. */
export interface ObjectOptions {
  /**
   * Why the object accepts undeclared keys, which are dropped before the handler sees the value.
   * In a body it lifts the route's derived body cap, leaving `bodyLimit`; an empty reason throws `TypeError`.
   */
  readonly open?: string;
  /**
   * The object's data class, which protects every property inside it.
   * `t.pick`, `t.omit`, `t.partial` and `t.extend` keep it; a `secret` object reaches a handler as `Secret<T>`.
   */
  readonly sensitivity?: Sensitivity;
}

/** The options of `t.partial`. */
export interface PartialOptions {
  /** Fewest declared properties that must be present, to refuse an empty PATCH body; undeclared keys never count. */
  readonly minProperties?: number;
}

/** The values `t.literal` accepts; a number must be finite. */
export type LiteralValue = string | number | boolean;

/** An object schema's properties, by key. */
export interface Properties {
  readonly [key: string]: Schema;
}

type OptionalKeys<P> = { [K in keyof P]: P[K] extends { readonly kind: 'optional' } ? K : never }[keyof P];

/** The value type of an object's properties, where a property made with `t.optional` is an optional key. */
export type ObjectStatic<P extends Properties> = { [K in Exclude<keyof P, OptionalKeys<P>>]: P[K]['~static'] } & {
  [K in OptionalKeys<P>]?: P[K]['~static'];
};

/** The wire type of an object's properties, where a property made with `t.optional` is an optional key. */
export type ObjectWire<P extends Properties> = { [K in Exclude<keyof P, OptionalKeys<P>>]: P[K]['~wire'] } & {
  [K in OptionalKeys<P>]?: P[K]['~wire'];
};

/** A string schema, as `t.string` returns it. */
export interface StringSchema<T = string> extends Schema<T, string> {
  /** The schema's kind. */
  readonly kind: 'string';
  /** Most UTF-16 code units accepted. */
  readonly maxLength?: number;
  /** Fewest UTF-16 code units accepted. */
  readonly minLength?: number;
  /** Why the string has no length bound. */
  readonly unbounded?: string;
  /** The data class the schema was declared with, if any. */
  readonly sensitivity?: Sensitivity;
}

/** An integer schema, as `t.integer` returns it. */
export interface IntegerSchema<T = number> extends Schema<T, number> {
  /** The schema's kind. */
  readonly kind: 'integer';
  /** Smallest value accepted, inclusive. */
  readonly minimum?: number;
  /** Largest value accepted, inclusive. */
  readonly maximum?: number;
  /** The data class the schema was declared with, if any. */
  readonly sensitivity?: Sensitivity;
}

/** A schema for a finite number, as `t.number` returns it. */
export interface NumberSchema<T = number> extends Schema<T, number> {
  /** The schema's kind. */
  readonly kind: 'number';
  /** Smallest value accepted, inclusive. */
  readonly minimum?: number;
  /** Largest value accepted, inclusive. */
  readonly maximum?: number;
  /** The data class the schema was declared with, if any. */
  readonly sensitivity?: Sensitivity;
}

/** A boolean schema, as `t.boolean` returns it. */
export interface BooleanSchema<T = boolean> extends Schema<T, boolean> {
  /** The schema's kind. */
  readonly kind: 'boolean';
  /** The data class the schema was declared with, if any. */
  readonly sensitivity?: Sensitivity;
}

/** A schema that accepts only `null`, as `t.null` returns it. */
export interface NullSchema<T = null> extends Schema<T, null> {
  /** The schema's kind. */
  readonly kind: 'null';
  /** The data class the schema was declared with, if any. */
  readonly sensitivity?: Sensitivity;
}

/** A schema that accepts one value, as `t.literal` returns it. */
export interface LiteralSchema<V extends LiteralValue = LiteralValue> extends Schema<V, V> {
  /** The schema's kind. */
  readonly kind: 'literal';
  /** The one value accepted. */
  readonly value: V;
}

/** An array schema, as `t.array` returns it. */
export interface ArraySchema<I extends Schema = Schema, T = I['~static'][]> extends Schema<T, I['~wire'][]> {
  /** The schema's kind. */
  readonly kind: 'array';
  /** The schema every item must pass. */
  readonly items: I;
  /** Most items accepted. */
  readonly maxItems?: number;
  /** Fewest items accepted. */
  readonly minItems?: number;
  /** Why the array has no item bound. */
  readonly unbounded?: string;
  /** The data class the schema was declared with, if any. */
  readonly sensitivity?: Sensitivity;
}

/** A schema for an object with arbitrary string keys, as `t.record` returns it. */
export interface RecordSchema<V extends Schema = Schema, T = Record<string, V['~static']>>
  extends Schema<T, Record<string, V['~wire']>> {
  /** The schema's kind. */
  readonly kind: 'record';
  /** The schema every key must pass; it carries no data class. */
  readonly key: StringSchema;
  /** The schema every value must pass. */
  readonly value: V;
  /** Most keys accepted. */
  readonly maxProperties?: number;
  /** Why the record has no key bound. */
  readonly unbounded?: string;
  /** The data class the schema was declared with, if any. */
  readonly sensitivity?: Sensitivity;
}

/** A schema that accepts what any member accepts, as `t.union` returns it. */
export interface UnionSchema<M extends readonly Schema[] = readonly Schema[], T = M[number]['~static']>
  extends Schema<T, M[number]['~wire']> {
  /** The schema's kind. */
  readonly kind: 'union';
  /** The member schemas, tried in declaration order. */
  readonly members: M;
  /** The data class the schema was declared with, if any. */
  readonly sensitivity?: Sensitivity;
}

/** The properties of a `t.partial` result: each one wrapped in `t.optional` unless it already was. */
export type PartialProperties<P extends Properties> = {
  readonly [K in keyof P]: P[K] extends { readonly kind: 'optional' } ? P[K] : OptionalSchema<P[K]>;
};

/** An object schema, as `t.object` and the four derivations return it. */
export interface ObjectSchema<P extends Properties = Properties, S extends Sensitivity | undefined = undefined>
  extends Schema<Sealed<ObjectStatic<P>, S>, ObjectWire<P>> {
  /** The schema's kind. */
  readonly kind: 'object';
  /** The declared properties, in declaration order. */
  readonly properties: P;
  /** Why undeclared keys are accepted; absent for a closed object. */
  readonly open?: string;
  /** Fewest declared properties that must be present. */
  readonly minProperties?: number;
  /** The data class the schema was declared with, if any. */
  readonly sensitivity?: Sensitivity;
}

/** A property schema that may be absent, as `t.optional` returns it. */
export interface OptionalSchema<S extends Schema = Schema> extends Schema<S['~static'], S['~wire']> {
  /** The schema's kind. */
  readonly kind: 'optional';
  /** The schema of the value when present. */
  readonly inner: S;
}

/** A `secret` schema allowed in a response, as `t.exposed` returns it; its value is written raw. */
export interface ExposedSchema<W> extends Schema<W, W> {
  /** The schema's kind. */
  readonly kind: 'exposed';
  /** The `secret` schema it wraps. */
  readonly inner: Schema<unknown, W>;
  /** Why the value may leave in a response, exported as `x-exposure`. */
  readonly reason: string;
}

/** A JSON Schema 2020-12 document, as plain JSON. */
export interface JsonSchema {
  readonly [keyword: string]: unknown;
}

export type Check = (value: unknown) => boolean;

export type Finish = (value: unknown) => unknown;

export type FinishMode = 'wrap' | 'raw';

export interface Finding {
  readonly code: 'UNBOUNDED_FIELD' | 'INVALID_BOUND' | 'SECRET_IN_RESPONSE' | 'NESTED_TOO_DEEP';
  readonly pointer: string;
  readonly message: string;
}
