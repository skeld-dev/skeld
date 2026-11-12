// Does:  Finds a request's client address: the socket peer, or the nearest untrusted X-Forwarded-For hop behind it.
// Holds: The header is read only when the peer is trusted, and the walk stops at the first entry that is not an IP.

import type { IncomingMessage } from 'node:http';
import type { BlockList } from 'node:net';
import { isIP } from 'node:net';
import { limit } from '#diag';
import type { Exchange } from './exchange.ts';

// Why: Real proxy chains are a few hops; the cap bounds the work an attacker's long header can cause.
const MAX_HOPS = 32;

function trusted(list: BlockList, address: string, version: number): boolean {
  return list.check(address, version === 4 ? 'ipv4' : 'ipv6');
}

// Does:  Walks X-Forwarded-For right to left from a trusted peer and returns the first address not trusted.
// Holds: Every address returned is either the peer or an entry that parsed as an IP address.
function forwardedClient(list: BlockList, peer: string, header: string): string {
  let client = peer;
  let stop = header.length;
  let hops = 0;
  while (hops < MAX_HOPS) {
    hops++;
    const comma = header.lastIndexOf(',', stop - 1);
    const entry = header.slice(comma + 1, stop).trim();
    const version = isIP(entry);
    if (version === 0) {
      break;
    }
    client = entry;
    if (!trusted(list, entry, version) || comma === -1) {
      break;
    }
    stop = comma;
  }
  limit('limit.forwarded_hops', hops, MAX_HOPS);
  return client;
}

// Does:  Resolves a request's client address from its socket peer and, behind a trusted peer, its X-Forwarded-For.
export function resolveClient(req: IncomingMessage, list: BlockList | null): string {
  // Why: The address is cached on the socket by the first read, which happens before the request can wait.
  const peer = req.socket.remoteAddress ?? '';
  if (list === null) {
    return peer;
  }
  const version = isIP(peer);
  if (version === 0 || !trusted(list, peer, version)) {
    return peer;
  }
  const header = req.headers['x-forwarded-for'];
  if (header === undefined) {
    return peer;
  }
  return forwardedClient(list, peer, typeof header === 'string' ? header : header.join(','));
}

// Does:  Returns the request's client address, computed on first read and kept for every later read.
export function clientAddressOf(exchange: Exchange): string {
  if (exchange.clientAddress === null) {
    exchange.clientAddress = resolveClient(exchange.req, exchange.runtime.trustProxy);
  }
  return exchange.clientAddress;
}
