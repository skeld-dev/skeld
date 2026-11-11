// Does:  Replaces the secret and personal parts of a value with markers, for logs.
// Holds: A value under a sensitive node is never returned; a union value matching no member takes its strongest marker.

import { compileCheck } from './check.ts';
import { isModelSchema } from './node.ts';
import type { ObjectSchema, Schema, Sensitivity } from './types.ts';

function marker(sensitivity: Sensitivity): string {
  return sensitivity === 'secret' ? '[secret]' : '[personal]';
}

function strongest(marks: readonly (Sensitivity | undefined)[]): Sensitivity | undefined {
  if (marks.includes('secret')) {
    return 'secret';
  }
  return marks.includes('personal') ? 'personal' : undefined;
}

function isObjectValue(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function reached(schema: Schema): Sensitivity | undefined {
  if (!isModelSchema(schema)) {
    return undefined;
  }
  switch (schema.kind) {
    case 'string':
    case 'integer':
    case 'number':
    case 'boolean':
    case 'null':
      return schema.sensitivity;
    case 'literal':
      return undefined;
    case 'object':
      return strongest([schema.sensitivity, ...Object.values(schema.properties).map((property) => reached(property))]);
    case 'array':
      return strongest([schema.sensitivity, reached(schema.items)]);
    case 'record':
      return strongest([schema.sensitivity, reached(schema.value)]);
    case 'union':
      return strongest([schema.sensitivity, ...schema.members.map((member) => reached(member))]);
    case 'optional':
    case 'exposed':
      return reached(schema.inner);
  }
}

function redactObject(schema: ObjectSchema, value: Readonly<Record<string, unknown>>): unknown {
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => {
      // Why: An undeclared key is kept as it is; the schema says nothing about it.
      const property = Object.hasOwn(schema.properties, key) ? schema.properties[key] : undefined;
      return [key, property === undefined || item === undefined ? item : redact(property, item)];
    }),
  );
}

/**
 * Returns a copy of a value with each `secret` value as `[secret]` and each `personal` value as `[personal]`.
 * A marked container is replaced whole; a value not of the schema's shape is kept unless marked; the input is never changed.
 * @example redact(t.object({ token: t.string({ maxLength: 64, sensitivity: 'secret' }) }), { token: 'abc' })
 */
export function redact(schema: Schema, value: unknown): unknown {
  if (!isModelSchema(schema)) {
    // Why: Without a schema to say what is safe, the whole value is treated as secret.
    return marker('secret');
  }
  const sensitivity = 'sensitivity' in schema ? schema.sensitivity : undefined;
  if (sensitivity !== undefined) {
    return marker(sensitivity);
  }
  switch (schema.kind) {
    case 'string':
    case 'integer':
    case 'number':
    case 'boolean':
    case 'null':
    case 'literal':
      return value;
    case 'object':
      return isObjectValue(value) ? redactObject(schema, value) : value;
    case 'array':
      return Array.isArray(value) ? value.map((item: unknown) => redact(schema.items, item)) : value;
    case 'record':
      return isObjectValue(value)
        ? Object.fromEntries(
            Object.entries(value).map(([key, item]) => [key, item === undefined ? item : redact(schema.value, item)]),
          )
        : value;
    case 'union': {
      const member = schema.members.find((candidate) => compileCheck(candidate)(value));
      if (member !== undefined) {
        return redact(member, value);
      }
      const mark = strongest(schema.members.map((candidate) => reached(candidate)));
      return mark === undefined ? value : marker(mark);
    }
    case 'optional':
    case 'exposed':
      return redact(schema.inner, value);
  }
}
