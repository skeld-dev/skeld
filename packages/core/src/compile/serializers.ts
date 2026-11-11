import { errorBodySchema } from '../contract/contract.ts';
import type { RouteDefinition } from '../contract/types.ts';
import type { Schema } from '../schema/types.ts';
import { SchemaCompileError } from './compile-error.ts';
import { generateSerializer } from './generate.ts';
import type { ResponseSerializers, Serializer } from './types.ts';

const serializers = new WeakMap<Schema, Serializer>();

function compileSerializer(schema: Schema, status: number | null): Serializer {
  const cached = serializers.get(schema);
  if (cached !== undefined) {
    return cached;
  }
  let serializer: Serializer;
  try {
    serializer = generateSerializer(schema);
  } catch (cause) {
    if (cause instanceof EvalError) {
      throw cause;
    }
    throw new SchemaCompileError('response', status, cause);
  }
  serializers.set(schema, serializer);
  return serializer;
}

export function compileResponseSerializers(route: RouteDefinition): ResponseSerializers {
  return new Map(
    Object.entries(route.responses).map(([key, schema]) => {
      const status = Number(key);
      return [status, schema === null ? null : compileSerializer(schema, status)];
    }),
  );
}

export function getErrorBodySerializer(): Serializer {
  return compileSerializer(errorBodySchema, null);
}
