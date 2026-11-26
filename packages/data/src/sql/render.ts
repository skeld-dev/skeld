// Does:  Flattens a registered query into one text and one parameter list in an engine's placeholder style.
// Holds: Placeholders and parameters stay in text order, and every parameter passed the parameter rule.

import { DataError } from '../data-error/data-error.ts';
import type { Parameter, Query } from './types.ts';

export type PlaceholderStyle = 'dollar' | 'question';

export interface RenderedQuery {
  readonly text: string;
  readonly parameters: readonly Parameter[];
}

interface QueryParts {
  readonly texts: readonly string[];
  readonly values: readonly unknown[];
}

const registered = new WeakMap<object, QueryParts>();

function isQuery(value: unknown): value is Query {
  return typeof value === 'object' && value !== null && registered.has(value);
}

// Does:  Makes the frozen, opaque value that stands for the parts and records it as a real query.
export function registerQuery(texts: readonly string[], values: readonly unknown[]): Query {
  // Why: The brand member exists only in the type, so an empty frozen object with no prototype stands for a Query.
  const query: Query = Object.freeze(Object.create(null));
  registered.set(query, { texts: Object.freeze([...texts]), values: Object.freeze([...values]) });
  return query;
}

function checkParameter(value: unknown): Parameter {
  switch (typeof value) {
    case 'string':
    case 'bigint':
    case 'boolean':
      return value;
    case 'number':
      if (Number.isFinite(value)) {
        return value;
      }
      break;
    case 'object':
      if (value === null || value instanceof Uint8Array) {
        return value;
      }
      if (value instanceof Date && !Number.isNaN(value.getTime())) {
        return value;
      }
      break;
    case 'undefined':
    case 'symbol':
    case 'function':
      break;
  }
  throw new DataError('INVALID_QUERY');
}

export function checkParameters(values: readonly unknown[]): readonly Parameter[] {
  return Object.freeze(values.map(checkParameter));
}

export function renderQuery(query: Query, style: PlaceholderStyle): RenderedQuery {
  const parameters: Parameter[] = [];
  const text: string[] = [];
  const append = (current: Query): void => {
    const parts = registered.get(current);
    if (parts === undefined) {
      throw new DataError('INVALID_QUERY');
    }
    parts.texts.forEach((part, index) => {
      // Why: A cooked part is undefined after an invalid escape, so the text that runs is not the text written.
      if (typeof part !== 'string') {
        throw new DataError('INVALID_QUERY');
      }
      text.push(part);
      if (index === parts.values.length) {
        return;
      }
      const value = parts.values[index];
      if (isQuery(value)) {
        append(value);
        return;
      }
      parameters.push(checkParameter(value));
      text.push(style === 'dollar' ? `$${parameters.length}` : '?');
    });
  };
  append(query);
  return Object.freeze({ text: text.join(''), parameters: Object.freeze(parameters) });
}
