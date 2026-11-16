// Does:  Builds the handlers of auth's session routes: session status, sign-out and dead-cookie cleanup.
// Holds: A cookie is cleared only after the store confirmed the session is revoked or that no live session holds it.

import { HttpError } from '@skeld/core/http-error';
import type { GatedHandlers } from '@skeld/core/server';
import type { SessionRoutes } from '../routes/routes.ts';
import { clearingCookie, parseToken, readSessionCookie } from '../session/token.ts';
import type { Centre } from './centre.ts';
import { storeUnavailable } from '../store/unavailable.ts';
import type { AuthAccessOf } from './types.ts';

const NO_STORE = Object.freeze({ 'cache-control': 'no-store' });

function unavailable(): HttpError {
  return new HttpError(503, 'AUTH_UNAVAILABLE', 'Service unavailable');
}

export function createSessionHandlers<G extends AuthAccessOf<never>>(centre: Centre): GatedHandlers<SessionRoutes, G> {
  return Object.freeze({
    authSession(request) {
      const { session } = centre.use();
      const token = readSessionCookie(request.rawCookies, session.cookieName);
      const { principal } = request;
      if (principal?.kind !== 'session' || token === null) {
        return { status: 200, body: { status: 'none' }, headers: NO_STORE };
      }
      const body = {
        status: 'session',
        userId: principal.userId,
        csrfToken: token.csrfToken,
        expiresAt: principal.expiresAt,
      } as const;
      return { status: 200, body, headers: NO_STORE };
    },

    async authSignOut(request) {
      const { store, events, session } = centre.use();
      const token = readSessionCookie(request.rawCookies, session.cookieName);
      if (token === null) {
        throw unavailable();
      }
      let revoked: Awaited<ReturnType<typeof store.sessionRevoke>>;
      try {
        revoked = await store.sessionRevoke({ digest: token.digest }, request.signal);
      } catch (error) {
        storeUnavailable(events, request.log, error);
        throw unavailable();
      }
      if (revoked.revoked && revoked.userId !== null) {
        events.sessionRevoked(request.log, { 'auth.user': revoked.userId, 'auth.cause': 'sign_out' });
      }
      return { status: 204, headers: NO_STORE, cookies: [clearingCookie(session.cookieName)] };
    },

    async authSessionClear(request) {
      const { store, events, session, limits } = centre.use();
      const verdict = await limits.address('authSessionClear', request);
      if (verdict.kind === 'limited') {
        const body = { status: 429, code: 'RATE_LIMITED', message: 'Too many requests' };
        return { status: 429, body, headers: { ...NO_STORE, 'retry-after': String(verdict.retryAfterSeconds) } };
      }
      if (verdict.kind !== 'pass') {
        throw unavailable();
      }
      for (const value of request.rawCookies.getAll(session.cookieName)) {
        const token = parseToken(value);
        if (token === null) {
          continue;
        }
        let record: Awaited<ReturnType<typeof store.sessionRead>>;
        try {
          // biome-ignore lint/performance/noAwaitInLoops: each cookie the request sent is confirmed dead before any is cleared
          record = await store.sessionRead({ digest: token.digest }, request.signal);
        } catch (error) {
          storeUnavailable(events, request.log, error);
          throw unavailable();
        }
        if (record !== null) {
          throw new HttpError(409, 'SESSION_LIVE', 'Session is live');
        }
      }
      return { status: 204, headers: NO_STORE, cookies: [clearingCookie(session.cookieName)] };
    },
  });
}
