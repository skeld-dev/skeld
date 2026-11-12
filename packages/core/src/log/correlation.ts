// Does:  Reads a request's inbound x-request-id and traceparent under their grammars for its records.
// Holds: Each value returned matched its grammar whole; a header sent more than once, or as a list, gives null.

import type { IncomingHttpHeaders } from 'node:http';
import type { Correlation } from './shapes.ts';

// Why: Node joins a repeated header with ", ", which neither grammar admits, so a header sent twice is ignored.
const REQUEST_ID = /^[A-Za-z0-9._:=+/-]{1,128}$/;
// Why: Only version 00 of W3C Trace Context is accepted: 55 characters, its ids and flags in lower-case hex.
const TRACEPARENT = /^00-[0-9a-f]{32}-[0-9a-f]{16}-[0-9a-f]{2}$/;
const ALL_ZERO = /^0+$/;

const NONE: Correlation = Object.freeze({ inboundId: null, traceId: null, traceFlags: null });

export function readCorrelation(headers: IncomingHttpHeaders): Correlation {
  const id = headers['x-request-id'];
  const parent = headers.traceparent;
  if (id === undefined && parent === undefined) {
    return NONE;
  }
  const inboundId = typeof id === 'string' && REQUEST_ID.test(id) ? id : null;
  if (typeof parent !== 'string' || !TRACEPARENT.test(parent)) {
    return { inboundId, traceId: null, traceFlags: null };
  }
  const traceId = parent.slice(3, 35);
  // Why: W3C Trace Context makes an all-zero trace id or parent id invalid.
  if (ALL_ZERO.test(traceId) || ALL_ZERO.test(parent.slice(36, 52))) {
    return { inboundId, traceId: null, traceFlags: null };
  }
  return { inboundId, traceId, traceFlags: parent.slice(53) };
}
