// Does:  Defines toJsonSchema, the public JSON Schema export.
// Holds: The document always declares the 2020-12 dialect.

import { exportNode } from './export.ts';
import type { JsonSchema, Schema } from './types.ts';

/**
 * Exports a schema as a JSON Schema 2020-12 document.
 * Closed objects carry `additionalProperties: false`; classes and reasons export as `x-sensitivity`, `x-exposure`, `x-unbounded`, `x-open`.
 * @example toJsonSchema(t.string({ maxLength: 36 }))
 */
export function toJsonSchema(schema: Schema): JsonSchema {
  return { $schema: 'https://json-schema.org/draft/2020-12/schema', ...exportNode(schema) };
}

export type { JsonSchema } from './types.ts';
