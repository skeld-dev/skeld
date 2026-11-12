// Does:  Parses a Cookie header into its name and value pairs; a repeated name becomes an array of its values.
// Holds: The result has no prototype; it and its arrays are frozen; values are only trimmed of space and tab.

import { end, start } from '#diag';

export interface CookieEntries {
  readonly [name: string]: string | readonly string[];
}

const NO_COOKIES: CookieEntries = Object.freeze(Object.create(null));
const PAIR_SEPARATOR = ';';
const SPACE = 0x20;
const TAB = 0x09;
const EQUALS = 0x3d;

function isWhitespace(code: number): boolean {
  return code === SPACE || code === TAB;
}

// Why: The search stops at the pair's end, so a header of many pairs without = is still read in one pass.
function equalsIn(text: string, from: number, to: number): number {
  for (let index = from; index < to; index += 1) {
    if (text.charCodeAt(index) === EQUALS) {
      return index;
    }
  }
  return -1;
}

// Why: Mirrors how the user agent parsed the stored cookie: name and value trimmed (RFC 6265bis draft 22 section 5.6).
function trimmed(text: string, from: number, to: number): string {
  let first = from;
  let last = to;
  while (first < last && isWhitespace(text.charCodeAt(first))) {
    first += 1;
  }
  while (last > first && isWhitespace(text.charCodeAt(last - 1))) {
    last -= 1;
  }
  return text.slice(first, last);
}

export function parseCookies(header: string | undefined): CookieEntries {
  if (header === undefined || header === '') {
    return NO_COOKIES;
  }
  const span = start('req.cookies.parse');
  // Why: No prototype, so a name such as __proto__ or constructor is plain data.
  const result: Record<string, string | string[]> = Object.create(null);
  let from = 0;
  while (from <= header.length) {
    const separator = header.indexOf(PAIR_SEPARATOR, from);
    const to = separator === -1 ? header.length : separator;
    const equals = equalsIn(header, from, to);
    // Why: As the user agent parsed it, a pair without = has an empty name (RFC 6265bis draft 22 section 5.6).
    const name = equals === -1 ? '' : trimmed(header, from, equals);
    if (name !== '') {
      const value = trimmed(header, equals + 1, to);
      const seen = result[name];
      if (seen === undefined) {
        result[name] = value;
      } else if (typeof seen === 'string') {
        result[name] = [seen, value];
      } else {
        seen.push(value);
      }
    }
    from = to + 1;
  }
  for (const value of Object.values(result)) {
    if (typeof value !== 'string') {
      Object.freeze(value);
    }
  }
  end(span);
  return Object.freeze(result);
}
