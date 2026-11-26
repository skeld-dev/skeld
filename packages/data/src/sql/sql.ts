// Does:  Builds queries from a tagged template or a quoted identifier, the only two ways query text is made.
// Holds: A value interpolated into sql becomes a parameter or a nested query, never text.

import { DataError } from '../data-error/data-error.ts';
import { registerQuery } from './render.ts';
import type { Parameter, Query } from './types.ts';

export type { Parameter, Query } from './types.ts';

/**
 * Builds a query; each interpolated value is sent as a parameter and each interpolated `Query` nests with its own.
 * A refused value (`undefined`, a non-finite number, an invalid `Date`, any other object) fails the query with `INVALID_QUERY` when it runs.
 * @example sql`select id from users where id = ${7}`
 */
export function sql(parts: TemplateStringsArray, ...values: readonly (Parameter | Query)[]): Query {
  return registerQuery(parts, values);
}

/**
 * Builds a quoted identifier from its parts, joined by `.`, with each `"` doubled.
 * Throws `DataError` `INVALID_QUERY` for no part, an empty part or a NUL.
 * @example identifier('app', 'users')
 */
export function identifier(...parts: readonly string[]): Query {
  if (parts.length === 0) {
    throw new DataError('INVALID_QUERY');
  }
  const quoted = parts.map((part) => {
    if (typeof part !== 'string' || part === '' || part.includes('\0')) {
      throw new DataError('INVALID_QUERY');
    }
    return `"${part.replaceAll('"', '""')}"`;
  });
  return registerQuery([quoted.join('.')], []);
}
