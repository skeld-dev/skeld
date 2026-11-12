// Does:  Writes a classified value as JSON text under its schema: declared keys only, markers for what may not show.
// Holds: The value is read only through own data-property descriptors after a Proxy test; none of its code runs.

import { isProxy } from 'node:util/types';
import { compileCheck } from '../schema/check.ts';
import { isModelSchema } from '../schema/node.ts';
import { reached } from '../schema/sensitivity.ts';
import type {
  ArraySchema,
  BooleanSchema,
  IntegerSchema,
  LiteralValue,
  NullSchema,
  NumberSchema,
  ObjectSchema,
  RecordSchema,
  Schema,
  Sensitivity,
  StringSchema,
  UnionSchema,
} from '../schema/types.ts';
import { escapeText } from './escape.ts';
import {
  INVALID_MARKER,
  NAME_UNITS,
  NODES_MAX,
  PERSONAL_MARKER,
  SECRET_MARKER,
  TEXT_UNITS,
  TRUNCATED_MARKER,
  UNCLASSIFIED_MARKER,
} from './limits.ts';

const SECRET = `"${SECRET_MARKER}"`;
const PERSONAL = `"${PERSONAL_MARKER}"`;
const INVALID = `"${INVALID_MARKER}"`;
const UNCLASSIFIED = `"${UNCLASSIFIED_MARKER}"`;
const TRUNCATED = `"${TRUNCATED_MARKER}"`;

// Why: No check accepts a symbol, so a part the copy could not read never makes a union member match.
const UNREADABLE = Symbol('unreadable');

type ScalarSchema = StringSchema | IntegerSchema | NumberSchema | BooleanSchema | NullSchema;

type ContainerSchema = ObjectSchema | ArraySchema | RecordSchema | UnionSchema;

interface Budget {
  left: number;
}

function markerOf(sensitivity: Sensitivity): string {
  return sensitivity === 'secret' ? SECRET : PERSONAL;
}

function quoted(text: string): string {
  return `"${escapeText(text, TEXT_UNITS)}"`;
}

function nameOf(key: string): string {
  return `"${escapeText(key, NAME_UNITS)}"`;
}

function finite(value: number): string {
  return Number.isFinite(value) ? String(value) : 'null';
}

// Does:  An object the projection may read: not a Proxy, so a descriptor read runs no trap.
function readable(value: unknown): value is object {
  return typeof value === 'object' && value !== null && !isProxy(value);
}

// Does:  An own property's value when it is a data property; undefined when absent; UNREADABLE for an accessor.
function own(value: object, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (descriptor === undefined) {
    return undefined;
  }
  return 'value' in descriptor ? descriptor.value : UNREADABLE;
}

// Does:  Copies a value as plain data for a union's checks, reading as the projection does, at most budget nodes.
function copyOf(value: unknown, budget: Budget): unknown {
  if (budget.left === 0 || typeof value === 'function' || typeof value === 'symbol') {
    return UNREADABLE;
  }
  budget.left -= 1;
  if (typeof value !== 'object' || value === null) {
    return value;
  }
  if (isProxy(value)) {
    return UNREADABLE;
  }
  if (Array.isArray(value)) {
    const length = own(value, 'length');
    const items: unknown[] = [];
    for (let index = 0; typeof length === 'number' && index < length && budget.left > 0; index++) {
      items.push(copyOf(own(value, String(index)), budget));
    }
    // Why: A copy cut short must fail every check rather than pass as a shorter array.
    if (typeof length !== 'number' || items.length < length) {
      items.push(UNREADABLE);
    }
    return items;
  }
  const entries: Record<string, unknown> = Object.create(null);
  for (const key of Object.keys(value)) {
    if (budget.left === 0) {
      entries[key] = UNREADABLE;
      break;
    }
    entries[key] = copyOf(own(value, key), budget);
  }
  return entries;
}

function projectUnion(schema: UnionSchema, value: unknown, budget: Budget): string | null {
  const copy = copyOf(value, { left: budget.left });
  const member = schema.members.find((candidate) => compileCheck(candidate)(copy));
  if (member !== undefined) {
    return projectNode(member, copy, budget);
  }
  const mark = reached(schema);
  return mark === undefined ? INVALID : markerOf(mark);
}

// Does:  Projects one node; null means the key is left out (undefined under an optional node).
function projectNode(schema: Schema, value: unknown, budget: Budget): string | null {
  if (!isModelSchema(schema)) {
    return UNCLASSIFIED;
  }
  switch (schema.kind) {
    case 'optional':
      return value === undefined ? null : projectNode(schema.inner, value, budget);
    case 'exposed':
      return projectNode(schema.inner, value, budget);
    case 'literal':
      budget.left -= 1;
      return value === schema.value ? literalText(schema.value) : INVALID;
    case 'string':
    case 'integer':
    case 'number':
    case 'boolean':
    case 'null':
      budget.left -= 1;
      return schema.sensitivity === undefined ? scalarText(schema, value) : markerOf(schema.sensitivity);
    case 'object':
    case 'array':
    case 'record':
    case 'union':
      budget.left -= 1;
      return schema.sensitivity === undefined ? containerText(schema, value, budget) : markerOf(schema.sensitivity);
  }
}

function literalText(value: LiteralValue): string {
  return typeof value === 'string' ? quoted(value) : String(value);
}

function scalarText(schema: ScalarSchema, value: unknown): string {
  switch (schema.kind) {
    case 'string':
      return typeof value === 'string' ? quoted(value) : INVALID;
    case 'integer':
      return typeof value === 'number' && Number.isInteger(value) ? String(value) : INVALID;
    case 'number':
      return typeof value === 'number' ? finite(value) : INVALID;
    case 'boolean':
      return typeof value === 'boolean' ? String(value) : INVALID;
    case 'null':
      return value === null ? 'null' : INVALID;
  }
}

function containerText(schema: ContainerSchema, value: unknown, budget: Budget): string | null {
  switch (schema.kind) {
    case 'object':
      return readable(value) && !Array.isArray(value) ? objectText(schema, value, budget) : INVALID;
    case 'array':
      return readable(value) && Array.isArray(value) ? arrayText(schema, value, budget) : INVALID;
    case 'record':
      return readable(value) && !Array.isArray(value) ? recordText(schema, value, budget) : INVALID;
    case 'union':
      return projectUnion(schema, value, budget);
  }
}

function objectText(schema: ObjectSchema, value: object, budget: Budget): string {
  const members: string[] = [];
  for (const [key, property] of Object.entries(schema.properties)) {
    const item = own(value, key);
    if (item === undefined) {
      continue;
    }
    if (budget.left === 0) {
      members.push(`${nameOf(key)}:${TRUNCATED}`);
      break;
    }
    const text = item === UNREADABLE ? INVALID : projectNode(property, item, budget);
    if (text !== null) {
      members.push(`${nameOf(key)}:${text}`);
    }
  }
  return `{${members.join(',')}}`;
}

function arrayText(schema: ArraySchema, value: object, budget: Budget): string {
  const length = own(value, 'length');
  if (typeof length !== 'number') {
    return INVALID;
  }
  const items: string[] = [];
  for (let index = 0; index < length; index++) {
    if (budget.left === 0) {
      items.push(TRUNCATED);
      break;
    }
    const item = own(value, String(index));
    // Why: JSON has no undefined, so a hole or an undefined item is written as not of the item's schema.
    items.push((item === UNREADABLE ? null : projectNode(schema.items, item, budget)) ?? INVALID);
  }
  return `[${items.join(',')}]`;
}

function recordText(schema: RecordSchema, value: object, budget: Budget): string {
  const entries: string[] = [];
  for (const key of Object.keys(value)) {
    if (budget.left === 0) {
      entries.push(`${nameOf(key)}:${TRUNCATED}`);
      break;
    }
    const item = own(value, key);
    const text = item === UNREADABLE ? INVALID : projectNode(schema.value, item, budget);
    if (text !== null) {
      entries.push(`${nameOf(key)}:${text}`);
    }
  }
  return `{${entries.join(',')}}`;
}

// Does:  Writes a value paired with a schema, at most NODES_MAX nodes; null when the value is left out entirely.
// Holds: A node marked secret or personal is written as its marker before its value is looked at.
export function projectClassified(schema: Schema | null, value: unknown): string | null {
  return schema === null ? UNCLASSIFIED : projectNode(schema, value, { left: NODES_MAX });
}
