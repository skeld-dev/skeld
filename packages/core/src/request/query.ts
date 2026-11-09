import { end, start } from '#diag';
import type { QueryObject } from './types.ts';

export function parseQuery(query: string): QueryObject {
  const span = start('req.query.parse');
  const result: Record<string, string | string[]> = Object.create(null);
  for (const [key, value] of new URLSearchParams(query)) {
    const seen = result[key];
    if (seen === undefined) {
      result[key] = value;
    } else if (typeof seen === 'string') {
      result[key] = [seen, value];
    } else {
      seen.push(value);
    }
  }
  end(span);
  return result;
}
