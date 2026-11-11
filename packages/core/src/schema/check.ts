// Does:  Builds the closure check for a schema: the validator that generates no code.
// Holds: It accepts exactly the values the generated check accepts; neither may change without the other.

import { isModelSchema, type ModelSchema } from './node.ts';
import type {
  ArraySchema,
  Check,
  IntegerSchema,
  LiteralSchema,
  NumberSchema,
  ObjectSchema,
  RecordSchema,
  Schema,
  StringSchema,
  UnionSchema,
} from './types.ts';

export interface DeclaredProperty {
  readonly key: string;
  readonly schema: Schema;
  readonly optional: boolean;
  readonly inherited: boolean;
}

interface PropertyLink {
  readonly property: DeclaredProperty;
  readonly check: Check;
  readonly next: PropertyLink | null;
}

interface MemberLink {
  readonly check: Check;
  readonly next: MemberLink | null;
}

// Why: A node is compiled once; shared nodes and repeated calls reuse its check.
const checks = new WeakMap<Schema, Check>();

// Why: A node this model did not make, or one whose bound is not a number, can never be satisfied.
const never: Check = () => false;

export function isObjectValue(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// Does:  Normalises a declared upper bound: absent means no limit, and a value that is not a number becomes NaN.
export function upperBound(bound: number | undefined): number {
  if (bound === undefined || bound === Number.POSITIVE_INFINITY) {
    return Number.POSITIVE_INFINITY;
  }
  return Number.isFinite(bound) ? bound : Number.NaN;
}

export function lowerBound(bound: number | undefined): number {
  if (bound === undefined || bound === Number.NEGATIVE_INFINITY) {
    return Number.NEGATIVE_INFINITY;
  }
  return Number.isFinite(bound) ? bound : Number.NaN;
}

export function declaredProperties(schema: ObjectSchema): readonly DeclaredProperty[] {
  return Object.entries(schema.properties).map(([key, property]) => {
    const optional = isModelSchema(property) && property.kind === 'optional';
    return { key, schema: optional ? property.inner : property, optional, inherited: key in Object.prototype };
  });
}

// Does:  Reads a declared property, treating an inherited member of the same name as absent.
export function readDeclared(value: Readonly<Record<string, unknown>>, property: DeclaredProperty): unknown {
  return property.inherited && !Object.hasOwn(value, property.key) ? undefined : value[property.key];
}

function stringCheck(schema: StringSchema): Check {
  const most = upperBound(schema.maxLength);
  const least = lowerBound(schema.minLength);
  if (Number.isNaN(most) || Number.isNaN(least)) {
    return never;
  }
  return (value) => typeof value === 'string' && value.length <= most && value.length >= least;
}

function numericCheck(schema: IntegerSchema | NumberSchema): Check {
  const most = upperBound(schema.maximum);
  const least = lowerBound(schema.minimum);
  if (Number.isNaN(most) || Number.isNaN(least)) {
    return never;
  }
  if (schema.kind === 'integer') {
    return (value) => typeof value === 'number' && Number.isInteger(value) && value >= least && value <= most;
  }
  return (value) => typeof value === 'number' && Number.isFinite(value) && value >= least && value <= most;
}

function literalCheck(schema: LiteralSchema): Check {
  const expected = schema.value;
  if (typeof expected !== 'string' && typeof expected !== 'boolean' && !Number.isFinite(expected)) {
    return never;
  }
  return (value) => value === expected;
}

// Does:  Checks the declared properties and returns how many are present, or -1 as soon as one fails.
function presentCount(first: PropertyLink | null, value: Readonly<Record<string, unknown>>): number {
  let present = 0;
  for (let link = first; link !== null; link = link.next) {
    const { property } = link;
    if (property.inherited && !Object.hasOwn(value, property.key)) {
      if (property.optional) {
        continue;
      }
      return -1;
    }
    const item = value[property.key];
    if (property.optional && item === undefined) {
      continue;
    }
    if (!link.check(item)) {
      return -1;
    }
    present += 1;
  }
  return present;
}

function objectCheck(schema: ObjectSchema): Check {
  const least = lowerBound(schema.minProperties);
  if (Number.isNaN(least)) {
    return never;
  }
  const first = declaredProperties(schema).reduceRight<PropertyLink | null>(
    (next, property) => ({ property, check: compileCheck(property.schema), next }),
    null,
  );
  const closed = schema.open === undefined;
  return (value) => {
    if (!isObjectValue(value)) {
      return false;
    }
    const present = presentCount(first, value);
    if (present < 0 || present < least) {
      return false;
    }
    if (!closed) {
      return true;
    }
    let visited = 0;
    // biome-ignore lint/suspicious/noForIn: M6 refuses every key a for...in visits beyond the present declared ones, inherited ones too (ADR-027)
    for (const _key in value) {
      visited += 1;
      if (visited > present) {
        return false;
      }
    }
    return visited === present;
  };
}

function arrayCheck(schema: ArraySchema): Check {
  const most = upperBound(schema.maxItems);
  const least = lowerBound(schema.minItems);
  if (Number.isNaN(most) || Number.isNaN(least)) {
    return never;
  }
  const itemCheck = compileCheck(schema.items);
  return (value) => {
    if (!Array.isArray(value) || value.length > most || value.length < least) {
      return false;
    }
    for (let index = 0; index < value.length; index++) {
      if (!itemCheck(value[index])) {
        return false;
      }
    }
    return true;
  };
}

function recordCheck(schema: RecordSchema): Check {
  const most = upperBound(schema.maxProperties);
  if (Number.isNaN(most)) {
    return never;
  }
  const keyCheck = compileCheck(schema.key);
  const valueCheck = compileCheck(schema.value);
  return (value) => {
    if (!isObjectValue(value)) {
      return false;
    }
    let visited = 0;
    // biome-ignore lint/suspicious/noForIn: M8 checks and counts the keys a for...in visits (ADR-027)
    for (const key in value) {
      visited += 1;
      if (visited > most || !keyCheck(key) || !valueCheck(value[key])) {
        return false;
      }
    }
    return true;
  };
}

function unionCheck(schema: UnionSchema): Check {
  const first = schema.members.reduceRight<MemberLink | null>(
    (next, member) => ({ check: compileCheck(member), next }),
    null,
  );
  return (value) => {
    for (let link = first; link !== null; link = link.next) {
      if (link.check(value)) {
        return true;
      }
    }
    return false;
  };
}

function buildCheck(schema: ModelSchema): Check {
  switch (schema.kind) {
    case 'string':
      return stringCheck(schema);
    case 'integer':
    case 'number':
      return numericCheck(schema);
    case 'boolean':
      return (value) => typeof value === 'boolean';
    case 'null':
      return (value) => value === null;
    case 'literal':
      return literalCheck(schema);
    case 'object':
      return objectCheck(schema);
    case 'array':
      return arrayCheck(schema);
    case 'record':
      return recordCheck(schema);
    case 'union':
      return unionCheck(schema);
    case 'optional':
    case 'exposed':
      return compileCheck(schema.inner);
  }
}

export function compileCheck(schema: Schema): Check {
  if (!isModelSchema(schema)) {
    return never;
  }
  const cached = checks.get(schema);
  if (cached !== undefined) {
    return cached;
  }
  const check = buildCheck(schema);
  checks.set(schema, check);
  return check;
}
