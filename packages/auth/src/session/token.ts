// Does:  Mints session tokens, reads the request's session cookie, and derives a token's digest, CSRF token and cookie.
// Holds: The store sees only a token's SHA-256 digest; the token text leaves auth only in the session cookie.

import { createHash, createHmac, randomBytes } from 'node:crypto';
import type { OutgoingCookie, RawCookies } from '@skeld/core/server';
import type { Digest } from '../store/types.ts';

const TOKEN_BYTES = 32;
const TOKEN_TEXT = /^[A-Za-z0-9_-]{43}$/;
const CSRF_CONTEXT = 'skeld.auth.csrf.v1';

export interface Token {
  readonly text: string;
  readonly digest: Digest;
  readonly csrfToken: string;
}

function tokenOf(bytes: Uint8Array): Token {
  return Object.freeze({
    text: Buffer.from(bytes).toString('base64url'),
    digest: new Uint8Array(createHash('sha256').update(bytes).digest()),
    csrfToken: createHmac('sha256', bytes).update(CSRF_CONTEXT).digest('base64url'),
  });
}

export function mintToken(): Token {
  return tokenOf(randomBytes(TOKEN_BYTES));
}

// Does:  Reads a cookie value as a token, or null when it is not 43 base64url characters in their canonical spelling.
// Holds: One token has one accepted text: its 32 bytes encode back to exactly the text that was sent.
export function parseToken(value: string): Token | null {
  if (!TOKEN_TEXT.test(value)) {
    return null;
  }
  const bytes = Buffer.from(value, 'base64url');
  return bytes.toString('base64url') === value ? tokenOf(bytes) : null;
}

// Does:  Reads the one well-formed session cookie a request sent; null when it sent none, two, or a malformed one.
export function readSessionCookie(rawCookies: RawCookies, name: string): Token | null {
  const value = rawCookies.get(name);
  return value === undefined ? null : parseToken(value);
}

export function sessionCookie(name: string, token: Token, maxAgeSeconds: number): OutgoingCookie {
  return Object.freeze({
    name,
    value: token.text,
    path: '/',
    httpOnly: true,
    secure: true,
    sameSite: 'Lax',
    maxAge: Math.max(1, maxAgeSeconds),
  });
}

export function clearingCookie(name: string): OutgoingCookie {
  return Object.freeze({ name, value: '', path: '/', httpOnly: true, secure: true, sameSite: 'Lax', maxAge: 0 });
}
