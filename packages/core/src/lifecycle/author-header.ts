// Does:  Sets the response headers an author names, refusing the framing, connection, cookie and CORS fields.
// Holds: A reserved name in any letter case throws before any header of the call is set.

import type { ServerResponse } from 'node:http';
import { event, header } from '#diag';
import type { OutgoingHeaders, ReservedHeaderName } from '../server/types.ts';

// Why: Connection-specific fields per RFC 9110 section 7.6.1; RFC 9112 section 6.2 bars two framing headers at once.
const RESERVED_NAMES = {
  'transfer-encoding': true,
  'content-length': true,
  connection: true,
  'keep-alive': true,
  'proxy-connection': true,
  te: true,
  trailer: true,
  upgrade: true,
  // Why: Cookies go through setCookie and the reply's cookies, which check each one and write it as its own line.
  'set-cookie': true,
  // Why: CORS headers come from the cors option, which grants them per route and keeps them on error responses.
  'access-control-allow-origin': true,
  'access-control-allow-credentials': true,
  'access-control-expose-headers': true,
  'access-control-allow-methods': true,
  'access-control-allow-headers': true,
  'access-control-max-age': true,
} as const satisfies Record<ReservedHeaderName, true>;
const RESERVED: ReadonlySet<string> = new Set(Object.keys(RESERVED_NAMES));

function refusalHint(lower: string): string {
  if (lower === 'set-cookie') {
    return "; use setCookie or the reply's cookies";
  }
  return lower.startsWith('access-control-') ? '; use the cors option' : '';
}

function refuseReserved(name: string): void {
  const lower = name.toLowerCase();
  if (RESERVED.has(lower)) {
    event('err.reserved_header', name);
    const hint = refusalHint(lower);
    throw new Error(`header ${name} is reserved for the engine${hint}`);
  }
}

export function setAuthorHeader(res: ServerResponse, name: string, value: string | number | readonly string[]): void {
  refuseReserved(name);
  header(name, value);
  res.setHeader(name, value);
}

export function setAuthorHeaders(res: ServerResponse, headers: OutgoingHeaders): void {
  const entries = Object.entries(headers);
  for (const [name] of entries) {
    refuseReserved(name);
  }
  for (const [name, value] of entries) {
    header(name, value);
    res.setHeader(name, value);
  }
}
