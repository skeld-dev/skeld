// Does:  Keeps a request's cookies on its exchange: the ones it sent, parsed on first read, and the ones it will set.
// Holds: The Cookie header is parsed at most once per request; a cookie is collected only once it serialized.

import { event } from '#diag';
import type { OutgoingCookie } from '../contract/types.ts';
import { type CookieEntries, parseCookies } from '../cookie/parse.ts';
import { serializeCookie } from '../cookie/serialize.ts';
import type { RawCookies } from '../server/types.ts';
import type { Exchange } from './exchange.ts';

const NONE: readonly string[] = Object.freeze([]);

function rawCookies(entries: CookieEntries): RawCookies {
  return Object.freeze({
    get(name: string): string | undefined {
      const value = entries[name];
      // Why: Servers should not rely on the order of two cookies of one name (RFC 6265bis draft 22 section 4.2.2).
      return typeof value === 'string' ? value : undefined;
    },
    getAll(name: string): readonly string[] {
      const value = entries[name];
      if (value === undefined) {
        return NONE;
      }
      return typeof value === 'string' ? Object.freeze([value]) : value;
    },
  });
}

export function cookieEntriesOf(exchange: Exchange): CookieEntries {
  exchange.cookieEntries ??= parseCookies(exchange.req.headers.cookie);
  return exchange.cookieEntries;
}

export function rawCookiesOf(exchange: Exchange): RawCookies {
  exchange.rawCookies ??= rawCookies(cookieEntriesOf(exchange));
  return exchange.rawCookies;
}

function serialized(cookie: OutgoingCookie): string {
  try {
    return serializeCookie(cookie);
  } catch (error) {
    event('err.cookie');
    throw error;
  }
}

// Does:  Adds a cookie's Set-Cookie line to the collected ones, or throws when the cookie is invalid.
// Holds: A later cookie of the same name, path and domain replaces the earlier one in its place.
export function collectCookie(collected: Map<string, string> | null, cookie: OutgoingCookie): Map<string, string> {
  const line = serialized(cookie);
  const target = collected ?? new Map<string, string>();
  // Why: Name, path and domain identify a stored cookie (RFC 6265bis draft 22 section 5.7); none holds NUL.
  target.set(`${cookie.name}\0${cookie.path ?? '/'}\0${cookie.domain ?? ''}`, line);
  return target;
}

export function collectCookies(
  collected: Map<string, string> | null,
  cookies: readonly OutgoingCookie[],
): Map<string, string> | null {
  let target = collected;
  for (const cookie of cookies) {
    target = collectCookie(target, cookie);
  }
  return target;
}
