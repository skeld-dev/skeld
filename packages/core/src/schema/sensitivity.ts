// Does:  Finds the strongest classification reachable from a schema.
// Holds: Container children and wrappers cannot hide a secret or personal classification.

import { isModelSchema } from './node.ts';
import type { Schema, Sensitivity } from './types.ts';

function strongest(marks: readonly (Sensitivity | undefined)[]): Sensitivity | undefined {
  if (marks.includes('secret')) {
    return 'secret';
  }
  return marks.includes('personal') ? 'personal' : undefined;
}

export function reached(schema: Schema): Sensitivity | undefined {
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
