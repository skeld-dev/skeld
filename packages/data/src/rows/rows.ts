// Does:  Turns a session's result into rows: keyed by column, or projected, converted and checked by a row schema.
// Holds: Every row returned has a null prototype and is frozen, and a refused row means no rows are returned at all.

import type {
  BooleanSchema,
  ExposedSchema,
  IntegerSchema,
  NumberSchema,
  ObjectSchema,
  OptionalSchema,
  Schema,
  StringSchema,
  UnionSchema,
} from '@skeld/core/schema';
import { DataError } from '../data-error/data-error.ts';
import type { Row } from '../database/types.ts';
import type { SessionResult } from '../session/types.ts';

type ConvertingSchema =
  | IntegerSchema
  | NumberSchema
  | StringSchema
  | BooleanSchema
  | UnionSchema
  | OptionalSchema
  | ExposedSchema<unknown>;

interface ProjectedColumn {
  readonly key: string;
  readonly index: number;
  readonly schema: Schema;
}

const NO_CONVERSION: unique symbol = Symbol('no conversion');

const MIN_SAFE = BigInt(Number.MIN_SAFE_INTEGER);
const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER);

function refuseDuplicates(columns: readonly string[]): void {
  if (new Set(columns).size !== columns.length) {
    throw new DataError('INVALID_QUERY');
  }
}

function keyedRow(columns: readonly string[], values: readonly unknown[]): Row {
  const row: Record<string, unknown> = Object.create(null);
  for (const [index, column] of columns.entries()) {
    // Why: On a null-prototype object a column named __proto__ is an own property, never the prototype setter.
    row[column] = values[index];
  }
  return Object.freeze(row);
}

const CONVERTING_KINDS: ReadonlySet<string> = new Set([
  'integer',
  'number',
  'string',
  'boolean',
  'union',
  'optional',
  'exposed',
]);

// Why: Core's public types give a schema's kind but no union over it; each builder sets kind to match its interface.
function isConverting(schema: Schema): schema is ConvertingSchema {
  return CONVERTING_KINDS.has(schema.kind);
}

// Does:  Applies the first of the three exact conversions the declared kind allows, reading a union's members in order.
function convert(node: Schema, value: unknown): unknown {
  if (!isConverting(node)) {
    return NO_CONVERSION;
  }
  switch (node.kind) {
    case 'integer':
    case 'number':
      return typeof value === 'bigint' && value >= MIN_SAFE && value <= MAX_SAFE ? Number(value) : NO_CONVERSION;
    case 'string':
      return typeof value === 'bigint' ? value.toString() : NO_CONVERSION;
    case 'boolean':
      if (value === 0n || value === 0) {
        return false;
      }
      return value === 1n || value === 1 ? true : NO_CONVERSION;
    case 'union':
      for (const member of node.members) {
        const converted = convert(member, value);
        if (converted !== NO_CONVERSION) {
          return converted;
        }
      }
      return NO_CONVERSION;
    case 'optional':
    case 'exposed':
      return convert(node.inner, value);
  }
}

function projectedColumns(columns: readonly string[], schema: ObjectSchema): readonly ProjectedColumn[] {
  const indexes = new Map(columns.map((column, index) => [column, index]));
  const projected: ProjectedColumn[] = [];
  for (const [key, property] of Object.entries(schema.properties)) {
    const index = indexes.get(key);
    if (index !== undefined) {
      projected.push({ key, index, schema: property });
    }
  }
  return projected;
}

// Does:  Projects, converts and checks one row, then rebuilds it from the checked value with the declared keys only.
function checkedRow(projected: readonly ProjectedColumn[], schema: ObjectSchema, values: readonly unknown[]): Row {
  const candidate: Record<string, unknown> = Object.create(null);
  for (const { key, index, schema: property } of projected) {
    const value = values[index];
    const converted = convert(property, value);
    candidate[key] = converted === NO_CONVERSION ? value : converted;
  }
  const outcome = schema['~standard'].validate(candidate);
  if ('issues' in outcome) {
    throw new DataError('ROW_INVALID');
  }
  const checked: Readonly<Record<string, unknown>> = outcome.value;
  const row: Record<string, unknown> = Object.create(null);
  for (const { key } of projected) {
    if (Object.hasOwn(checked, key)) {
      row[key] = checked[key];
    }
  }
  return Object.freeze(row);
}

// Does:  Refuses a row schema that is not an object or is secret as a whole, whose checked value would be no row.
export function checkRowSchema(schema: ObjectSchema): void {
  if (schema.kind !== 'object' || schema.sensitivity === 'secret') {
    throw new DataError('INVALID_QUERY');
  }
}

export function readRows(result: SessionResult, schema: ObjectSchema | null): readonly Row[] {
  const { columns, rows } = result;
  refuseDuplicates(columns);
  if (schema === null) {
    return rows.map((values) => keyedRow(columns, values));
  }
  checkRowSchema(schema);
  const projected = projectedColumns(columns, schema);
  return rows.map((values) => checkedRow(projected, schema, values));
}
