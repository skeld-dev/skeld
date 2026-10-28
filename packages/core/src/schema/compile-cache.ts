import type { TSchema } from 'typebox';

export function createCompileCache<S extends TSchema, V>(compile: (schema: S) => V): (schema: S) => V {
  const cache = new WeakMap<S, V>();
  return (schema) => {
    const cached = cache.get(schema);
    if (cached !== undefined) {
      return cached;
    }
    const compiled = compile(schema);
    cache.set(schema, compiled);
    return compiled;
  };
}
