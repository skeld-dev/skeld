// Does:  Binds each gated route to its credential kinds and identifies a request's one credential at the gate.
// Holds: A credential is judged only as its own kind, and an admitted session was read live from the store.

import { timingSafeEqual } from 'node:crypto';
import type { GateFinding, GateRefusal, GateRequest, GateRoute, IdentifyOutcome, RouteGate } from '@skeld/core/gate';
import type { Logger } from '@skeld/core/log';
import { count, end, start } from '#diag';
import { registerPrincipal } from '../policy/registry.ts';
import type { BoundPolicy, Principal } from '../policy/types.ts';
import { parseToken, type Token } from '../session/token.ts';
import { StoreFailure } from '../store/store.ts';
import type { Digest } from '../store/types.ts';
import type { Runtime } from './centre.ts';
import { storeUnavailable } from '../store/unavailable.ts';

const UNSAFE_METHODS: ReadonlySet<string> = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
// Why: RFC 6750 section 2.1: the b64token grammar after "Bearer ", bounded at 4,096 characters by the contract.
const BEARER = /^Bearer ([A-Za-z0-9\-._~+/]{1,4096}=*)$/;
const MAX_BEARER_TOKEN = 4096;
const API_KEY_PREFIX = 'skeld1.';

const CONFLICT: GateRefusal = Object.freeze({ kind: 'refuse', reason: 'credential_conflict' });
const CSRF: GateRefusal = Object.freeze({ kind: 'refuse', reason: 'csrf_token' });
const DENIED: GateRefusal = Object.freeze({ kind: 'refuse', reason: 'access_denied' });
const UNAVAILABLE: GateRefusal = Object.freeze({ kind: 'refuse', reason: 'unavailable' });
const ANONYMOUS: IdentifyOutcome<Principal> = Object.freeze({ kind: 'admit', principal: null });

function invalid(challenge: 'bearer' | null): GateRefusal {
  return Object.freeze({ kind: 'refuse', reason: 'credential_invalid', challenge });
}

interface Accepts {
  readonly session: boolean;
  readonly api_key: boolean;
  readonly jwt: boolean;
}

function isObject(value: unknown): value is object {
  return typeof value === 'object' && value !== null;
}

// Does:  Tells the kind of a verifier's answer: invalid, unavailable, verified with a principal of its kind, or null.
// Holds: A missing or unknown kind, or a verified answer without an object principal of the verifier's kind, is null.
function answerKind(value: unknown, kind: 'api_key' | 'jwt'): 'invalid' | 'unavailable' | 'verified' | null {
  const answer: unknown = isObject(value) ? Reflect.get(value, 'kind') : undefined;
  if (answer === 'invalid' || answer === 'unavailable') {
    return answer;
  }
  const principal: unknown = answer === 'verified' && isObject(value) ? Reflect.get(value, 'principal') : undefined;
  return isObject(principal) && Reflect.get(principal, 'kind') === kind ? 'verified' : null;
}

export type RouteBinder = (route: GateRoute) => RouteGate<Principal> | GateFinding | null;

function sameText(sent: string, expected: string): boolean {
  const a = Buffer.from(sent);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

// Does:  Builds the binder of one booted handle, with its record of renewals in flight.
export function createRouteBinder(runtime: Runtime): RouteBinder {
  const { store, events, session, limits, binder } = runtime;
  const renewals = new Map<string, Promise<number | null>>();

  // Does:  Renews one session's idle expiry; answers its new expiry, or null when it is gone or the renewal failed.
  // Holds: It never rejects: any failure ends in one auth.store.failed with cause renew, or none for an aborted unit.
  async function renewOnce(digest: Digest, log: Logger): Promise<number | null> {
    try {
      const renewed = await store.sessionRenew({ digest, idleMs: session.idleMs }, runtime.shutdown);
      count('auth.session.renew', renewed.kind);
      return renewed.kind === 'done' ? renewed.expiresAt : null;
    } catch (error) {
      count('auth.session.renew', 'failed');
      const failure = error instanceof StoreFailure ? error : null;
      // Why: The renewal runs unawaited, so a failure of any kind is recorded here and never left to reject.
      if (failure?.reason !== 'aborted' || failure.applied === 'unknown') {
        events.storeFailed(log, {
          'auth.operation': 'sessionRenew',
          'auth.cause': 'renew',
          'auth.code': failure?.code ?? undefined,
        });
      }
      return null;
    }
  }

  // Does:  Starts a renewal when the session was last seen renewSeconds ago, one per session; awaits it at twice that.
  // Holds: A renewal never changes the admission: a failed or gone renewal still admits on the live read.
  async function renew(token: Token, sinceMs: number, expiresAt: number, log: Logger): Promise<number> {
    if (sinceMs < session.renewMs || runtime.shutdown.aborted) {
      return expiresAt;
    }
    const key = Buffer.from(token.digest).toString('hex');
    let pending = renewals.get(key);
    if (pending === undefined) {
      pending = renewOnce(token.digest, log).finally(() => renewals.delete(key));
      renewals.set(key, pending);
    }
    if (sinceMs < 2 * session.renewMs) {
      return expiresAt;
    }
    return (await pending) ?? expiresAt;
  }

  // Does:  Judges the route's API-key scope and its policy limit; null when the principal may be admitted.
  async function refusal(principal: Principal, policy: BoundPolicy | null, request: GateRequest) {
    if (
      policy !== null &&
      principal.kind === 'api_key' &&
      !principal.scopes.includes(`${policy.policy}:${policy.action}`)
    ) {
      return DENIED;
    }
    if (policy?.limit) {
      const verdict = await limits.policy(policy.policy, policy.limit, principal, request);
      if (verdict.kind === 'limited') {
        return Object.freeze({ kind: 'refuse', reason: 'rate_limited', retryAfterSeconds: verdict.retryAfterSeconds });
      }
      if (verdict.kind !== 'pass') {
        return UNAVAILABLE;
      }
    }
    return null;
  }

  function admit(principal: Principal): IdentifyOutcome<Principal> {
    return Object.freeze({ kind: 'admit', principal: registerPrincipal(principal) });
  }

  async function bySession(value: string, policy: BoundPolicy | null, request: GateRequest) {
    const token = parseToken(value);
    if (token === null) {
      return invalid(null);
    }
    let record: Awaited<ReturnType<typeof store.sessionRead>>;
    try {
      record = await store.sessionRead({ digest: token.digest }, request.signal);
    } catch (error) {
      storeUnavailable(events, request.log, error);
      return UNAVAILABLE;
    }
    if (record === null) {
      return invalid(null);
    }
    if (UNSAFE_METHODS.has(request.method)) {
      const sent = request.headers['x-csrf-token'];
      if (typeof sent !== 'string' || !sameText(sent, token.csrfToken)) {
        return CSRF;
      }
    }
    const { userId, createdAt } = record;
    const refused = await refusal({ kind: 'session', userId, createdAt, expiresAt: record.expiresAt }, policy, request);
    if (refused !== null) {
      return refused;
    }
    // Why: Renewal is the last step, so only a request that is admitted can extend the session's idle expiry.
    const expiresAt = await renew(token, record.now - record.lastSeenAt, record.expiresAt, request.log);
    return admit({ kind: 'session', userId, createdAt, expiresAt });
  }

  async function byBearer(
    header: string | readonly string[],
    accepts: Accepts,
    policy: BoundPolicy | null,
    request: GateRequest,
  ) {
    const token = typeof header === 'string' ? BEARER.exec(header)?.[1] : undefined;
    if (token === undefined || token.length > MAX_BEARER_TOKEN) {
      return invalid('bearer');
    }
    // Why: The prefix alone picks the verifier, so a token refused as one kind is never tried as another.
    const kind = token.startsWith(API_KEY_PREFIX) ? 'api_key' : 'jwt';
    const verifier = kind === 'api_key' ? runtime.apiKeys : runtime.jwt;
    if (verifier === null || !accepts[kind]) {
      return invalid('bearer');
    }
    const verdict = await verifier.verify(token, request);
    const answer = answerKind(verdict, kind);
    if (answer === 'invalid') {
      return invalid('bearer');
    }
    if (answer === 'unavailable') {
      return UNAVAILABLE;
    }
    if (answer === null || verdict.kind !== 'verified') {
      // Why: An answer outside the verifier's union fails closed as a gate fault: core's fixed 500, nothing admitted.
      throw new TypeError('bearer verifier answered outside its union');
    }
    return (await refusal(verdict.principal, policy, request)) ?? admit(verdict.principal);
  }

  // Does:  Counts the credentials, then judges the one sent by its kind; an 'optional' route admits none as null.
  async function identify(
    request: GateRequest,
    accepts: Accepts,
    policy: BoundPolicy | null,
  ): Promise<IdentifyOutcome<Principal>> {
    const span = start('auth.gate.identify', request.route.name);
    try {
      const cookies = request.rawCookies.getAll(session.cookieName);
      const authorization = request.headers.authorization;
      if (cookies.length > 1 || (cookies.length === 1 && authorization !== undefined)) {
        return CONFLICT;
      }
      const [cookie] = cookies;
      if (cookie !== undefined) {
        return accepts.session ? await bySession(cookie, policy, request) : invalid(null);
      }
      if (authorization !== undefined) {
        return await byBearer(authorization, accepts, policy, request);
      }
      if (policy === null) {
        return ANONYMOUS;
      }
      return Object.freeze({
        kind: 'refuse',
        reason: 'credential_missing',
        challenge: accepts.api_key || accepts.jwt ? 'bearer' : null,
      });
    } finally {
      end(span);
    }
  }

  const installed: Accepts = Object.freeze({
    session: true,
    api_key: runtime.apiKeys !== null,
    jwt: runtime.jwt !== null,
  });

  return (route) => {
    const { access } = route;
    if (access === 'public') {
      return null;
    }
    if (access === 'optional') {
      const optional: RouteGate<Principal> = {
        cookie: true,
        identify: (request) => identify(request, installed, null),
        authorize: null,
        release: null,
      };
      return Object.freeze(optional);
    }
    const bound = binder.bind(route);
    if ('finding' in bound) {
      return bound;
    }
    if (bound.credentials.some((kind) => !installed[kind])) {
      return { finding: 'credential kind not installed' };
    }
    const accepts: Accepts = Object.freeze({
      session: bound.credentials.includes('session'),
      api_key: bound.credentials.includes('api_key'),
      jwt: bound.credentials.includes('jwt'),
    });
    const gated: RouteGate<Principal> = {
      cookie: accepts.session,
      identify: (request) => identify(request, accepts, bound),
      authorize: (principal, input, request) => bound.authorize(principal, input, request),
      release: (grant) => bound.release(grant),
    };
    return Object.freeze(gated);
  };
}
