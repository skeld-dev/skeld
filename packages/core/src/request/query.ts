// Does:  Parses a query string into an object; a repeated key becomes an array of its values.
// Holds: The result has no prototype; a repeated key is always an array and a single one always a string.

import { end, start } from '#diag';
import type { QueryObject } from './types.ts';

export function parseQuery(query: string): QueryObject {
  const span = start('req.query.parse');
  // Why: No prototype, so a key such as __proto__ or toString is plain data.
  const result: Record<string, string | string[]> = Object.create(null);
  for (const [key, value] of new URLSearchParams(query)) {
    const seen = result[key];
    if (seen === undefined) {
      // Why: The result has a null prototype, so a request-supplied name is an own key and cannot reach a prototype.
      // codeql[js/remote-property-injection]
      result[key] = value;
    } else if (typeof seen === 'string') {
      // Why: The result has a null prototype, so a request-supplied name is an own key and cannot reach a prototype.
      // codeql[js/remote-property-injection]
      result[key] = [seen, value];
    } else {
      seen.push(value);
    }
  }
  end(span);
  return result;
}
