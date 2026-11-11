// Does:  Splits a request target into its path and query.
// Holds: Nothing is percent-decoded here; decoding happens once, in the router.

import type { ParsedTarget } from './types.ts';

// Why: A request target may be absolute-form (RFC 9112 section 3.2.2); only its path is routed.
const ABSOLUTE_FORM = /^https?:\/\//i;

export function splitTarget(url: string): ParsedTarget {
  // Why: A conforming client never sends a fragment; one that arrives is dropped, not routed.
  const hash = url.indexOf('#');
  const target = hash === -1 ? url : url.slice(0, hash);
  const question = target.indexOf('?');
  const beforeQuery = question === -1 ? target : target.slice(0, question);
  const query = question === -1 ? '' : target.slice(question + 1);
  return { path: pathOf(beforeQuery), query };
}

function pathOf(beforeQuery: string): string {
  const scheme = ABSOLUTE_FORM.exec(beforeQuery);
  if (scheme === null) {
    return beforeQuery;
  }
  const pathStart = beforeQuery.indexOf('/', scheme[0].length);
  return pathStart === -1 ? '/' : beforeQuery.slice(pathStart);
}
