// Does:  Writes one outgoing cookie as a Set-Cookie value, by default with Path=/, HttpOnly, Secure and SameSite=Lax.
// Holds: A cookie breaking a rule throws an Error naming the cookie and rule, never its value; nothing is encoded.

import type { OutgoingCookie } from '../contract/types.ts';
import { isCookieName } from './name.ts';

// Why: RFC 6265bis draft 22 sections 5.5 and 5.6.2 limit a cookie's lifetime to 400 days (34,560,000 s).
const MAX_AGE_LIMIT = 34_560_000;
// Why: RFC 6265bis draft 22 section 5.6 has user agents ignore a cookie whose name and value exceed 4,096 octets.
const MAX_PAIR_BYTES = 4096;
// Why: An error message names at most this much of a cookie's name, so a long name cannot flood the log.
const NAME_SHOWN = 64;
// Why: RFC 6265bis draft 22 section 5.6 has user agents ignore an attribute value longer than 1,024 octets.
const MAX_ATTRIBUTE_BYTES = 1024;
const HOST_PREFIX = '__host-';
const SECURE_PREFIX = '__secure-';
const SEMICOLON = 0x3b;
const FIRST_PRINTABLE = 0x20;
const LAST_PRINTABLE = 0x7e;
const SAME_SITE: ReadonlySet<unknown> = new Set(['Strict', 'Lax', 'None']);

// Why: cookie-octet of RFC 6265bis draft 22 section 4.1.1: printable ASCII but space, DQUOTE, comma, ; and backslash.
function isCookieOctet(code: number): boolean {
  return (
    code === 0x21 ||
    (code >= 0x23 && code <= 0x2b) ||
    (code >= 0x2d && code <= 0x3a) ||
    (code >= 0x3c && code <= 0x5b) ||
    (code >= 0x5d && code <= 0x7e)
  );
}

function every(text: string, allowed: (code: number) => boolean): boolean {
  for (let index = 0; index < text.length; index += 1) {
    if (!allowed(text.charCodeAt(index))) {
      return false;
    }
  }
  return true;
}

// Why: av-octet of RFC 6265bis draft 22 section 4.1.1, so an attribute cannot end early or split the line.
function isAttributeOctet(code: number): boolean {
  return code >= FIRST_PRINTABLE && code <= LAST_PRINTABLE && code !== SEMICOLON;
}

function refused(name: string, rule: string): Error {
  const shown = name.length > NAME_SHOWN ? `${name.slice(0, NAME_SHOWN)}...` : name;
  return new Error(`cookie ${shown} refused: ${rule}`);
}

function attribute(name: string, label: string, value: unknown): string {
  if (typeof value !== 'string' || !every(value, isAttributeOctet)) {
    throw refused(name, `${label} must be printable ASCII without ;`);
  }
  if (value.length > MAX_ATTRIBUTE_BYTES) {
    throw refused(name, `${label} exceeds ${MAX_ATTRIBUTE_BYTES} bytes`);
  }
  return value;
}

function checkPrefix(name: string, secure: boolean, path: string, domain: string | undefined): void {
  const lower = name.toLowerCase();
  // Why: User agents match both prefixes case-insensitively (RFC 6265bis draft 22 section 5.4).
  if (lower.startsWith(HOST_PREFIX) && (!secure || path !== '/' || domain !== undefined)) {
    throw refused(name, 'a __Host- cookie needs secure, path / and no domain');
  }
  if (lower.startsWith(SECURE_PREFIX) && !secure) {
    throw refused(name, 'a __Secure- cookie needs secure');
  }
}

function checkMaxAge(name: string, maxAge: unknown): void {
  if (maxAge !== undefined && !(Number.isInteger(maxAge) && Number(maxAge) >= 0 && Number(maxAge) <= MAX_AGE_LIMIT)) {
    throw refused(name, `maxAge must be a whole number of seconds from 0 to ${MAX_AGE_LIMIT}`);
  }
}

export function serializeCookie(cookie: OutgoingCookie): string {
  const { name, value, maxAge, sameSite = 'Lax' } = cookie;
  if (typeof name !== 'string' || !isCookieName(name)) {
    throw new Error('cookie refused: its name is not an HTTP token');
  }
  if (typeof value !== 'string' || !every(value, isCookieOctet)) {
    throw refused(name, 'its value holds a character outside cookie-octet');
  }
  if (name.length + value.length > MAX_PAIR_BYTES) {
    throw refused(name, `name and value exceed ${MAX_PAIR_BYTES} bytes`);
  }
  const path = attribute(name, 'path', cookie.path ?? '/');
  // Why: A user agent uses the default path for one not starting with / (RFC 6265bis draft 22 section 5.6.4).
  if (!path.startsWith('/')) {
    throw refused(name, 'path must start with /');
  }
  const domain = cookie.domain === undefined ? undefined : attribute(name, 'domain', cookie.domain);
  // Why: Only an explicit false turns a protection off, so a truthy non-boolean keeps the secure default.
  const secure = cookie.secure !== false;
  const partitioned = cookie.partitioned === true;
  checkPrefix(name, secure, path, domain);
  checkMaxAge(name, maxAge);
  if (!SAME_SITE.has(sameSite)) {
    throw refused(name, 'sameSite must be Strict, Lax or None');
  }
  if ((sameSite === 'None' || partitioned) && !secure) {
    throw refused(name, 'sameSite None and partitioned need secure');
  }
  let line = `${name}=${value}; Path=${path}`;
  if (domain !== undefined) {
    line += `; Domain=${domain}`;
  }
  if (maxAge !== undefined) {
    line += `; Max-Age=${maxAge}`;
  }
  if (cookie.httpOnly !== false) {
    line += '; HttpOnly';
  }
  if (secure) {
    line += '; Secure';
  }
  line += `; SameSite=${sameSite}`;
  return partitioned ? `${line}; Partitioned` : line;
}
