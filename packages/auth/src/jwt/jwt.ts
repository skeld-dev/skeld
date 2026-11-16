// Does:  Exports @skeld/auth/jwt: the JWT part, which verifies external bearer tokens under a policy fixed at boot.
// Holds: map sees only a token that passed every check, and only a well-formed answer of map becomes a principal.

import type { GateRequest } from '@skeld/core/gate';
import { AuthError } from '../auth-error/auth-error.ts';
import { findKey } from '../outbound/cache.ts';
import type { VerifyKey } from '../outbound/jwk.ts';
import type { BearerVerdict, BearerVerifier, PartDeps } from '../server/internal-types.ts';
import { OptionFault } from '../server/option-fault.ts';
import { callWithin, userIdOf } from './callback.ts';
import { type Jws, readJws, signatureHolds, timesHold } from './jws.ts';
import { checkJwtOptions, type JwtPolicy } from './options.ts';
import type { Jwt, JwtOptions } from './types.ts';

export type { Jwk, Jwt, JwtMap, JwtMapped, JwtOptions } from './types.ts';

const MAP_DEADLINE_MS = 5_000;
const MAX_SUBJECT = 256;
const INVALID: BearerVerdict = Object.freeze({ kind: 'invalid' });
const UNAVAILABLE: BearerVerdict = Object.freeze({ kind: 'unavailable' });

type KeyFound = { readonly kind: 'key'; readonly key: VerifyKey } | { readonly kind: 'invalid' | 'unavailable' };

async function keyOf(policy: JwtPolicy, jws: Jws, deps: PartDeps, request: GateRequest): Promise<KeyFound> {
  const { source } = policy;
  if (source.kind === 'keys') {
    const key = source.keys.get(jws.kid);
    return key === undefined ? { kind: 'invalid' } : { kind: 'key', key };
  }
  const found = await findKey(source.url, jws.kid);
  if (found.kind === 'unavailable') {
    deps.events.keysUnavailable(request.log, { 'auth.source': 'jwt', 'auth.reason': found.reason });
    return { kind: 'unavailable' };
  }
  return found.kind === 'key' ? found : { kind: 'invalid' };
}

function claimsHold(policy: JwtPolicy, jws: Jws): boolean {
  const { iss, aud, sub } = jws.payload;
  const audience = Array.isArray(aud) ? aud.includes(policy.audience) : aud === policy.audience;
  return (
    iss === policy.issuer &&
    audience &&
    timesHold(jws.payload, false) &&
    typeof sub === 'string' &&
    sub.length >= 1 &&
    sub.length <= MAX_SUBJECT
  );
}

function callbackFailed(deps: PartDeps, request: GateRequest, cause: 'threw' | 'deadline' | 'malformed'): never {
  deps.events.callbackFailed(request.log, { 'auth.callback': 'jwt.map', 'auth.cause': cause });
  throw new AuthError('CALLBACK_FAILED');
}

// Does:  Verifies one bearer token; rejects AuthError CALLBACK_FAILED when map throws, is late or answers malformed.
async function verifyToken(
  policy: JwtPolicy,
  deps: PartDeps,
  token: string,
  request: GateRequest,
): Promise<BearerVerdict> {
  const jws = readJws(token);
  if (jws === null || !policy.algorithms.has(jws.alg)) {
    return INVALID;
  }
  const found = await keyOf(policy, jws, deps, request);
  if (found.kind !== 'key') {
    return found.kind === 'invalid' ? INVALID : UNAVAILABLE;
  }
  if (!signatureHolds(jws, found.key) || !claimsHold(policy, jws)) {
    return INVALID;
  }
  const issuer = policy.issuer;
  const subject = String(jws.payload.sub);
  const claims = jws.payload;
  const called = await callWithin((signal) => policy.map({ issuer, subject, claims }, signal), MAP_DEADLINE_MS, [
    deps.signal,
    request.signal,
  ]);
  if (called.kind === 'stopped') {
    return UNAVAILABLE;
  }
  if (called.kind !== 'answered') {
    return callbackFailed(deps, request, called.kind);
  }
  const mapped = mappedOf(called.value);
  if (mapped === null) {
    return callbackFailed(deps, request, 'malformed');
  }
  if (mapped.kind === 'deny') {
    return INVALID;
  }
  return { kind: 'verified', principal: { kind: 'jwt', issuer, subject, userId: mapped.userId, claims } };
}

function mappedOf(
  value: unknown,
): { readonly kind: 'deny' } | { readonly kind: 'accept'; userId: string | null } | null {
  if (typeof value !== 'object' || value === null) {
    return null;
  }
  const kind: unknown = Reflect.get(value, 'kind');
  const userId: unknown = Reflect.get(value, 'userId');
  if (kind === 'deny') {
    return { kind };
  }
  if (kind !== 'accept') {
    return null;
  }
  if (userId === null) {
    return { kind, userId };
  }
  const checked = userIdOf(userId);
  return checked === null ? null : { kind, userId: checked };
}

/**
 * Creates the JWT part given to `createAuth`; it verifies tokens of one issuer and audience and issues none.
 * Its options are checked at boot (BootError `GATE_FAILED`, component `jwt`); exactly one of `keys` and `jwksUrl`.
 * @example jwt({ issuer: 'https://id.example', audience: 'api', algorithms: ['RS256'], jwksUrl: 'https://id.example/jwks.json', map: (v) => ({ kind: 'accept', userId: v.subject }) })
 */
export function jwt(options: JwtOptions): Jwt {
  let attached = false;
  return Object.freeze({
    kind: 'jwt',
    attach(deps: PartDeps): BearerVerifier {
      if (attached) {
        throw new OptionFault('jwt', 'already attached');
      }
      const policy = checkJwtOptions(options);
      attached = true;
      return Object.freeze({
        verify: (token: string, request: GateRequest) => verifyToken(policy, deps, token, request),
      });
    },
  });
}
