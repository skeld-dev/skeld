// Does:  Sets the response headers an author names, refusing the framing and connection headers the engine owns.
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
} as const satisfies Record<ReservedHeaderName, true>;
const RESERVED: ReadonlySet<string> = new Set(Object.keys(RESERVED_NAMES));

function refuseReserved(name: string): void {
  if (RESERVED.has(name.toLowerCase())) {
    event('err.reserved_header', name);
    throw new Error(`header ${name} is reserved for the engine`);
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
