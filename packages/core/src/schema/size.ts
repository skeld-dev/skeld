import { isModelSchema } from './node.ts';
import type { ObjectSchema, Schema } from './types.ts';

const numberBytes = 32;

function stringBytes(maxLength: number): number {
  return 2 + 6 * maxLength;
}

function utf8Length(text: string): number {
  let length = 0;
  for (let index = 0; index < text.length; index++) {
    const unit = text.charCodeAt(index);
    if (unit < 0x80) {
      length += 1;
    } else if (unit < 0x800) {
      length += 2;
    } else if (unit >= 0xd800 && unit <= 0xdbff) {
      // JSON.stringify escapes a lone surrogate, so a high surrogate here always opens a pair.
      length += 4;
      index++;
    } else {
      length += 3;
    }
  }
  return length;
}

function listBytes(count: number, each: number): number {
  return count === 0 ? 2 : 2 + count * each + (count - 1);
}

function objectBytes(schema: ObjectSchema): number {
  if (schema.open !== undefined) {
    return Number.POSITIVE_INFINITY;
  }
  const entries = Object.entries(schema.properties);
  const members = entries.map(([key, property]) => utf8Length(JSON.stringify(key)) + 1 + maxEncodedBytes(property));
  return 2 + members.reduce((sum, bytes) => sum + bytes, 0) + Math.max(entries.length - 1, 0);
}

export function maxEncodedBytes(schema: Schema): number {
  if (!isModelSchema(schema)) {
    return 0;
  }
  switch (schema.kind) {
    case 'string':
      return schema.unbounded !== undefined || schema.maxLength === undefined
        ? Number.POSITIVE_INFINITY
        : stringBytes(schema.maxLength);
    case 'integer':
    case 'number':
      return numberBytes;
    case 'boolean':
      return 5;
    case 'null':
      return 4;
    case 'literal':
      if (typeof schema.value === 'string') {
        return stringBytes(schema.value.length);
      }
      return typeof schema.value === 'number' ? numberBytes : 5;
    case 'object':
      return objectBytes(schema);
    case 'array':
      return schema.unbounded !== undefined || schema.maxItems === undefined
        ? Number.POSITIVE_INFINITY
        : listBytes(schema.maxItems, maxEncodedBytes(schema.items));
    case 'record':
      return schema.unbounded !== undefined || schema.maxProperties === undefined
        ? Number.POSITIVE_INFINITY
        : listBytes(schema.maxProperties, maxEncodedBytes(schema.key) + 1 + maxEncodedBytes(schema.value));
    case 'union':
      return Math.max(...schema.members.map((member) => maxEncodedBytes(member)));
    case 'optional':
    case 'exposed':
      return maxEncodedBytes(schema.inner);
  }
}
