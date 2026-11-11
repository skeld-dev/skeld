// Does:  Exports a schema node as a JSON Schema node.
// Holds: A secret node is marked writeOnly with x-sensitivity; a closed object exports additionalProperties: false.

import { isModelSchema } from './node.ts';
import type { JsonSchema, ObjectSchema, Schema, Sensitivity } from './types.ts';

type Keyword = readonly [string, unknown];

function when(keyword: string, value: unknown): readonly Keyword[] {
  return value === undefined ? [] : [[keyword, value]];
}

function marked(keywords: readonly Keyword[], sensitivity: Sensitivity | undefined): JsonSchema {
  if (sensitivity === undefined) {
    return Object.fromEntries(keywords);
  }
  const writeOnly: readonly Keyword[] = sensitivity === 'secret' ? [['writeOnly', true]] : [];
  return Object.fromEntries([...keywords, ['x-sensitivity', sensitivity], ...writeOnly]);
}

function exportObject(schema: ObjectSchema): JsonSchema {
  const entries = Object.entries(schema.properties);
  const required = entries.filter(([, property]) => property.kind !== 'optional').map(([key]) => key);
  const closure: Keyword = schema.open === undefined ? ['additionalProperties', false] : ['x-open', schema.open];
  return marked(
    [
      ['type', 'object'],
      ['properties', Object.fromEntries(entries.map(([key, property]) => [key, exportNode(property)]))],
      ...when('required', required.length === 0 ? undefined : required),
      closure,
      ...when('minProperties', schema.minProperties),
    ],
    schema.sensitivity,
  );
}

export function exportNode(schema: Schema): JsonSchema {
  if (!isModelSchema(schema)) {
    // Why: A node this model did not make exports as the schema that nothing satisfies.
    return { not: {} };
  }
  switch (schema.kind) {
    case 'string':
      return marked(
        [
          ['type', 'string'],
          ...when('maxLength', schema.maxLength),
          ...when('minLength', schema.minLength),
          ...when('x-unbounded', schema.unbounded),
        ],
        schema.sensitivity,
      );
    case 'integer':
    case 'number':
      return marked(
        [['type', schema.kind], ...when('minimum', schema.minimum), ...when('maximum', schema.maximum)],
        schema.sensitivity,
      );
    case 'boolean':
    case 'null':
      return marked([['type', schema.kind]], schema.sensitivity);
    case 'literal':
      return { const: schema.value };
    case 'object':
      return exportObject(schema);
    case 'array':
      return marked(
        [
          ['type', 'array'],
          ['items', exportNode(schema.items)],
          ...when('maxItems', schema.maxItems),
          ...when('minItems', schema.minItems),
          ...when('x-unbounded', schema.unbounded),
        ],
        schema.sensitivity,
      );
    case 'record':
      return marked(
        [
          ['type', 'object'],
          ['propertyNames', exportNode(schema.key)],
          ['additionalProperties', exportNode(schema.value)],
          ...when('maxProperties', schema.maxProperties),
          ...when('x-unbounded', schema.unbounded),
        ],
        schema.sensitivity,
      );
    case 'union':
      return marked([['anyOf', schema.members.map((member) => exportNode(member))]], schema.sensitivity);
    case 'optional':
      return exportNode(schema.inner);
    case 'exposed':
      return Object.fromEntries([
        // Why: An exposed secret may be read in a response, so it loses writeOnly and records its reason.
        ...Object.entries(exportNode(schema.inner)).filter(([keyword]) => keyword !== 'writeOnly'),
        ['x-exposure', schema.reason],
      ]);
  }
}
