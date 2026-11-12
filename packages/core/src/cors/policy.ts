// Does:  Checks a cors option at boot and returns it as a frozen copy with its defaults filled in.
// Holds: An accepted policy has exact origins or '*' without credentials, lower-case token names, a bounded max age.

import { parseOrigin } from '../origin/origin.ts';
import { BootError } from '../server/boot-error.ts';
import type { CorsPolicy } from '../server/types.ts';

export interface ResolvedCors {
  readonly origins: '*' | readonly string[];
  readonly credentials: boolean;
  readonly allowedHeaders: readonly string[];
  readonly exposedHeaders: readonly string[];
  readonly maxAgeSeconds: number;
}

// Why: A header field name is a token (RFC 9110 section 5.1 and 5.6.2).
const TOKEN = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;
const DEFAULT_MAX_AGE = 600;
// Why: Firefox caps a preflight's max age at 86,400 s and Chromium at 7,200 s; a larger value is never honoured.
const MAX_MAX_AGE = 86_400;

function invalid(label: string, reason: string): BootError {
  return new BootError('INVALID_OPTION', `Invalid ${label}: ${reason}`, null, null);
}

function headerNames(value: unknown, label: string): readonly string[] {
  if (value === undefined) {
    return Object.freeze([]);
  }
  if (!Array.isArray(value)) {
    throw invalid(label, 'must be an array of header names');
  }
  const names = new Set<string>();
  for (const entry of value) {
    if (typeof entry !== 'string' || !TOKEN.test(entry)) {
      throw invalid(label, `${String(entry)} is not a header name (an HTTP token)`);
    }
    names.add(entry.toLowerCase());
  }
  return Object.freeze([...names]);
}

function origins(value: unknown, label: string): '*' | readonly string[] {
  if (value === '*') {
    return value;
  }
  if (!Array.isArray(value)) {
    throw invalid(label, "must be '*' or an array of origins");
  }
  if (value.length === 0) {
    throw invalid(label, 'must name at least one origin; use cors: false for none');
  }
  return Object.freeze([...new Set(value.map((entry: unknown) => parseOrigin(entry, label)))]);
}

function maxAge(value: unknown, label: string): number {
  if (value === undefined) {
    return DEFAULT_MAX_AGE;
  }
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > MAX_MAX_AGE) {
    throw invalid(label, `must be a whole number from 0 to ${MAX_MAX_AGE}, got ${String(value)}`);
  }
  return value;
}

// Does:  Returns the checked copy of a policy, false when turned off, null when not set; where names a group's routes.
export function resolveCors(
  value: CorsPolicy | false | undefined,
  option: string,
  where: string,
): ResolvedCors | false | null {
  if (value === undefined) {
    return null;
  }
  if (value === false) {
    return false;
  }
  const name = (field: string): string => `${option}${field}${where}`;
  if (typeof value !== 'object' || value === null) {
    throw invalid(name(''), 'must be a policy object or false');
  }
  const given: unknown = value.credentials;
  const credentials = given === undefined ? false : given;
  if (typeof credentials !== 'boolean') {
    throw invalid(name('.credentials'), 'must be a boolean');
  }
  const allowed = origins(value.origins, name('.origins'));
  // Why: The Fetch Standard's CORS check fails a credentialed request answered with '*'.
  if (allowed === '*' && credentials) {
    throw invalid(name('.credentials'), "cannot be true with origins '*'; list the origins");
  }
  return Object.freeze({
    origins: allowed,
    credentials,
    allowedHeaders: headerNames(value.allowedHeaders, name('.allowedHeaders')),
    exposedHeaders: headerNames(value.exposedHeaders, name('.exposedHeaders')),
    maxAgeSeconds: maxAge(value.maxAgeSeconds, name('.maxAgeSeconds')),
  });
}

export function isHeaderName(text: string): boolean {
  return TOKEN.test(text);
}
