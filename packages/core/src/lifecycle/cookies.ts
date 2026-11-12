// Does:  Keeps a request's cookies on its exchange: the ones it sent, parsed on first read, and the ones it will set.
// Holds: The Cookie header is parsed at most once per request; a cookie is collected only once it serialized.

import { event } from '#diag';
import type { OutgoingCookie } from '../contract/types.ts';
import { type CookieEntries, parseCookies } from '../cookie/parse.ts';
import { serializeCookie } from '../cookie/serialize.ts';
import type { RawCookies } from '../server/types.ts';
import { engineFault } from './engine-fault.ts';
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

// Does:  Reads an author's cookie once into a plain one, so a getter that throws does so outside the serializer.
function snapshot(cookie: OutgoingCookie): OutgoingCookie {
  const { name, value, path, domain, maxAge, httpOnly, secure, sameSite, partitioned } = cookie;
  const plain: { -readonly [K in keyof OutgoingCookie]: OutgoingCookie[K] } = { name, value };
  if (path !== undefined) {
    plain.path = path;
  }
  if (domain !== undefined) {
    plain.domain = domain;
  }
  if (maxAge !== undefined) {
    plain.maxAge = maxAge;
  }
  if (httpOnly !== undefined) {
    plain.httpOnly = httpOnly;
  }
  if (secure !== undefined) {
    plain.secure = secure;
  }
  if (sameSite !== undefined) {
    plain.sameSite = sameSite;
  }
  if (partitioned !== undefined) {
    plain.partitioned = partitioned;
  }
  return plain;
}

// Does:  Serializes a plain cookie; a rule it breaks is thrown as the engine's own fault with the serializer's message.
function serialized(cookie: OutgoingCookie): string {
  try {
    return serializeCookie(cookie);
  } catch (error) {
    event('err.cookie');
    // Why: The serializer throws only Errors of its own; the author's getters already ran in the snapshot.
    throw engineFault('invalid_cookie', error instanceof Error ? error.message : String(error), null);
  }
}

// Does:  Adds a cookie's Set-Cookie line to the collected ones, or throws when the cookie is invalid.
// Holds: A later cookie of the same name, path and domain replaces the earlier one in its place.
export function collectCookie(collected: Map<string, string> | null, author: OutgoingCookie): Map<string, string> {
  const cookie = snapshot(author);
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
