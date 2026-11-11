// Does:  Builds the projection of params, query and headers: declared keys only, strings converted where declared.
// Holds: Only declared own keys are kept; a string that is not an exact literal of the declared type stays a string.

import { isModelSchema } from '../schema/node.ts';
import type { ObjectSchema, Schema } from '../schema/types.ts';

type LeafConverter = (text: string) => number | boolean | null;
type PropertyConverter = (value: unknown) => unknown;

interface ProjectedKey {
  readonly key: string;
  readonly convert: PropertyConverter | null;
}

const INTEGER_LITERAL = /^-?(0|[1-9][0-9]*)$/;
// Why: The JSON number grammar (RFC 8259 section 6); Number() alone would also accept hex, spaces and Infinity.
const NUMBER_LITERAL = /^-?(0|[1-9][0-9]*)(\.[0-9]+)?([eE][+-]?[0-9]+)?$/;

function toInteger(text: string): number | null {
  if (!INTEGER_LITERAL.test(text)) {
    return null;
  }
  const value = Number(text);
  // Why: Beyond the safe range Number() rounds, so the value checked would not be the value sent.
  return Number.isSafeInteger(value) ? value : null;
}

function toNumber(text: string): number | null {
  if (!NUMBER_LITERAL.test(text)) {
    return null;
  }
  const value = Number(text);
  return Number.isFinite(value) ? value : null;
}

function toBoolean(text: string): boolean | null {
  if (text === 'true') {
    return true;
  }
  return text === 'false' ? false : null;
}

function firstConverted(members: readonly LeafConverter[]): LeafConverter {
  return (text) => {
    for (const member of members) {
      const converted = member(text);
      if (converted !== null) {
        return converted;
      }
    }
    return null;
  };
}

function leafConverter(schema: Schema): LeafConverter | null {
  if (!isModelSchema(schema)) {
    return null;
  }
  switch (schema.kind) {
    case 'integer':
      return toInteger;
    case 'number':
      return toNumber;
    case 'boolean':
      return toBoolean;
    case 'literal':
      if (typeof schema.value === 'number') {
        return toNumber;
      }
      return typeof schema.value === 'boolean' ? toBoolean : null;
    case 'union': {
      const members = schema.members.map(leafConverter).filter((member) => member !== null);
      return members.length === 0 ? null : firstConverted(members);
    }
    case 'optional':
    case 'exposed':
      return leafConverter(schema.inner);
    case 'string':
    case 'null':
    case 'object':
    case 'array':
    case 'record':
      return null;
  }
}

function convertText(leaf: LeafConverter, value: unknown): unknown {
  return typeof value === 'string' ? (leaf(value) ?? value) : value;
}

function propertyConverter(schema: Schema): PropertyConverter | null {
  if (!isModelSchema(schema)) {
    return null;
  }
  if (schema.kind === 'optional' || schema.kind === 'exposed') {
    return propertyConverter(schema.inner);
  }
  if (schema.kind !== 'array') {
    const leaf = leafConverter(schema);
    return leaf === null ? null : (value) => convertText(leaf, value);
  }
  const leaf = leafConverter(schema.items);
  return (value) => {
    // Why: A query key sent once arrives as a string; an array schema receives it as a one-item array.
    const items = typeof value === 'string' ? [value] : value;
    if (leaf === null || !Array.isArray(items)) {
      return items;
    }
    return items.map((item) => convertText(leaf, item));
  };
}

function isKeyedPart(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null;
}

// Does:  Returns the function that copies a part's declared keys into a prototype-less object, converting as it goes.
export function compileProjection(schema: ObjectSchema): (raw: unknown) => unknown {
  const plan: readonly ProjectedKey[] = Object.entries(schema.properties).map(([key, property]) => ({
    key,
    convert: propertyConverter(property),
  }));
  return (raw) => {
    if (!isKeyedPart(raw)) {
      return raw;
    }
    const projected: Record<string, unknown> = Object.create(null);
    for (const { key, convert } of plan) {
      // Why: Own keys only, so a declared name such as toString never reads an inherited member.
      if (!Object.hasOwn(raw, key)) {
        continue;
      }
      const value = raw[key];
      if (value !== undefined) {
        projected[key] = convert === null ? value : convert(value);
      }
    }
    return projected;
  };
}
