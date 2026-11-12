// Does:  Keeps the registry of classified values and reads a route's part schemas for request.classified.
// Holds: A value is recognised as Classified only by identity in the registry, never by its shape or its keys.

import type { RouteDefinition } from '../contract/types.ts';
import { isModelSchema } from '../schema/node.ts';
import type { Schema } from '../schema/types.ts';
import type { PartSchemas } from './shapes.ts';
import type { Classified } from './types.ts';

interface Pair {
  readonly schema: Schema | null;
  readonly value: unknown;
}

// Why: A WeakMap lookup is by identity and runs no trap, so a Proxy or a look-alike object is never mistaken for one.
const registry = new WeakMap<object, Pair>();

export function makeClassified(schema: Schema | null, value: unknown): Classified {
  const token: Classified = Object.freeze({ '~classified': true });
  registry.set(token, Object.freeze({ schema, value }));
  return token;
}

export function classifiedPair(value: unknown): Pair | undefined {
  return typeof value === 'object' && value !== null ? registry.get(value) : undefined;
}

function partOf(schema: Schema | undefined): PartSchemas['body'] {
  if (schema === undefined) {
    return null;
  }
  const keys = isModelSchema(schema) && schema.kind === 'object' ? new Map(Object.entries(schema.properties)) : null;
  return { whole: schema, keys };
}

// Does:  Reads the five part schemas of a route once, at listen; an undeclared part is null.
export function partSchemasOf(definition: RouteDefinition): PartSchemas {
  return {
    params: partOf(definition.params),
    query: partOf(definition.query),
    headers: partOf(definition.headers),
    cookies: partOf(definition.cookies),
    body: partOf(definition.body),
  };
}
