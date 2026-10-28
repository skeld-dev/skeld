import build from 'fast-json-stringify';
import type { TSchema } from 'typebox';
import { errorBodySchema } from '../contract/contract.ts';
import type { RouteDefinition } from '../contract/types.ts';
import { createCompileCache } from './compile-cache.ts';
import { SchemaCompileError } from './compile-error.ts';
import type { ResponseSerializers, Serializer } from './types.ts';

const serializers = createCompileCache((schema: TSchema): Serializer => build(schema));

function compileSerializer(schema: TSchema, status: number | null): Serializer {
  try {
    return serializers(schema);
  } catch (cause) {
    throw new SchemaCompileError('response', status, cause);
  }
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
