// Does:  Serves the OIDC callback: spends the attempt, exchanges the code, checks the ID Token and hands the user over.
// Holds: Once the attempt is spent it stays spent, and a session comes only from the handoff with the same user twice.

import { HttpError } from '@skeld/core/http-error';
import type { RouteReply, RouteRequest } from '@skeld/core/server';
import { expose, Secret } from '@skeld/core/secret';
import { callWithin, userIdOf } from '../jwt/callback.ts';
import { readProviderConfig } from '../outbound/cache.ts';
import { fetchJson, type JsonObject } from '../outbound/outbound.ts';
import type { OidcRoutes } from '../routes/routes.ts';
import { storeUnavailable } from '../store/unavailable.ts';
import { addressLimit, attemptCookie, unavailable } from './http.ts';
import { verifyIdToken } from './id-token.ts';
import type { ProviderPolicy } from './options.ts';
import { type Attached, providerOf } from './start.ts';
import { digestOf } from './tokens.ts';
import type { OidcIdentity, OidcResolution } from './types.ts';

const RESOLVE_DEADLINE_MS = 5_000;
const MAX_EMAIL = 254;
const MAX_NAME = 256;

type CallbackRoute = OidcRoutes['authOidcCallback'];
type Reply = RouteReply<CallbackRoute>;
type Request = RouteRequest<CallbackRoute>;
type FailureCode =
  | 'attempt_invalid'
  | 'provider_denied'
  | 'provider_error'
  | 'provider_response'
  | 'provider_unavailable'
  | 'mapping_denied'
  | 'mapping_failed'
  | 'subject_refused';

interface Flow {
  readonly attached: Attached;
  readonly provider: ProviderPolicy;
  readonly request: Request;
}

// Does:  Answers the 303 to the failure path and clears the attempt cookie the request sent.
function redirectFailure(flow: Flow, code: FailureCode): Reply {
  const { provider, request, attached } = flow;
  const sent = request.rawCookies.getAll(provider.cookieName).length > 0;
  return {
    status: 303,
    headers: { location: `${attached.policy.failurePath}?provider=${provider.name}&error=${code}` },
    cookies: sent ? [attemptCookie(provider.cookieName, '')] : [],
  };
}

function signinFailed(flow: Flow, reason: FailureCode | 'unavailable', userId?: string): void {
  const { attached, provider, request } = flow;
  attached.deps.events.signinFailed(request.log, {
    'auth.user': userId,
    'auth.via': 'oidc',
    'auth.provider': provider.name,
    'auth.reason': reason,
  });
}

// Does:  Writes the sign-in failure the callback decided before the handoff, then answers its redirect.
function fail(flow: Flow, code: FailureCode, userId?: string): Reply {
  signinFailed(flow, code, userId);
  return redirectFailure(flow, code);
}

const SHUTDOWN = Symbol('shutdown');

// Does:  Waits for the work unless shutdown begins first, which ends the wait at once.
function untilShutdown<T>(signal: AbortSignal, work: Promise<T>): Promise<T | typeof SHUTDOWN> {
  if (signal.aborted) {
    return Promise.resolve(SHUTDOWN);
  }
  const stopped = Promise.withResolvers<typeof SHUTDOWN>();
  const stop = (): void => stopped.resolve(SHUTDOWN);
  signal.addEventListener('abort', stop, { once: true });
  return Promise.race([work, stopped.promise]).finally(() => signal.removeEventListener('abort', stop));
}

// Does:  Answers shutdown after the attempt was spent: 503 clearing its cookie; establish's own record is not repeated.
function shutDown(flow: Flow, written: boolean): never {
  if (!written) {
    signinFailed(flow, 'unavailable');
  }
  throw new HttpError(503, 'AUTH_UNAVAILABLE', 'Service unavailable', {
    cookies: [attemptCookie(flow.provider.cookieName, '')],
  });
}

function formEncoded(text: string): string {
  return new URLSearchParams([['', text]]).toString().slice(1);
}

// Does:  Exchanges the code for an ID Token; a FailureCode when the token response cannot be had or is refused.
async function exchange(
  flow: Flow,
  tokenEndpoint: Parameters<typeof fetchJson>[0]['url'],
  code: string,
  verifier: string,
) {
  const { provider, request } = flow;
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: provider.redirectUri,
    code_verifier: verifier,
  }).toString();
  // Why: RFC 6749 section 2.3.1: client_secret_basic form-encodes the id and secret before the base64 of id:secret.
  const basic = Buffer.from(`${formEncoded(provider.clientId)}:${formEncoded(expose(provider.clientSecret))}`);
  const fetched = await fetchJson({
    url: tokenEndpoint,
    form: { body, authorization: new Secret(`Basic ${basic.toString('base64')}`) },
    signal: AbortSignal.any([request.signal, flow.attached.deps.signal]),
  });
  if (fetched.kind === 'failed') {
    const answered = ['status', 'redirect', 'size', 'json'].includes(fetched.reason);
    return answered ? 'provider_response' : 'provider_unavailable';
  }
  const idToken = fetched.body.id_token;
  return typeof idToken === 'string' ? { idToken } : 'provider_response';
}

function identityOf(provider: ProviderPolicy, subject: string, claims: JsonObject): OidcIdentity {
  const { email, email_verified: verified, name } = claims;
  const mail = typeof email === 'string' && email.length >= 1 && email.length <= MAX_EMAIL ? email : null;
  return {
    provider: provider.name,
    issuer: provider.issuer,
    subject,
    claims: {
      email: mail,
      emailVerified: verified === true && mail !== null,
      name: typeof name === 'string' && name.length >= 1 && name.length <= MAX_NAME ? name : null,
      all: claims,
    },
  };
}

function resolutionOf(value: unknown): OidcResolution | null {
  if (typeof value !== 'object' || value === null) {
    return null;
  }
  const kind: unknown = Reflect.get(value, 'kind');
  const userId: unknown = Reflect.get(value, 'userId');
  if (kind === 'deny') {
    return { kind };
  }
  const checked = kind === 'user' ? userIdOf(userId) : null;
  return checked === null ? null : { kind: 'user', userId: checked };
}

// Does:  Calls resolveUser once under its deadline; null after its auth.callback.failed, SHUTDOWN if stop aborts first.
async function resolve(
  flow: Flow,
  identity: OidcIdentity,
  signals: readonly AbortSignal[],
  stop: AbortSignal,
): Promise<OidcResolution | null | typeof SHUTDOWN> {
  const { attached, request } = flow;
  const called = await callWithin(
    (signal) => attached.policy.resolveUser(identity, signal),
    RESOLVE_DEADLINE_MS,
    signals,
    stop,
  );
  if (called.kind === 'stopped') {
    return SHUTDOWN;
  }
  const resolution = called.kind === 'answered' ? resolutionOf(called.value) : null;
  if (resolution === null) {
    const cause = called.kind === 'answered' ? 'malformed' : called.kind;
    attached.deps.events.callbackFailed(request.log, { 'auth.callback': 'oidc.resolve', 'auth.cause': cause });
  }
  return resolution;
}

// Does:  Establishes the session through the handoff, whose verify asks resolveUser again for the same user.
async function handOff(flow: Flow, identity: OidcIdentity, userId: string, returnPath: string): Promise<Reply> {
  const { attached, provider, request } = flow;
  const established = await attached.deps.sessions.establish(
    {
      rawCookies: request.rawCookies,
      userId,
      verify: async (signal) => {
        const again = await resolve(flow, identity, [signal], signal);
        return again !== SHUTDOWN && again?.kind === 'user' && again.userId === userId;
      },
      signal: request.signal,
    },
    provider.name,
  );
  if (established.kind === 'unavailable') {
    if (attached.deps.signal.aborted) {
      shutDown(flow, true);
    }
    throw unavailable();
  }
  if (established.kind === 'refused') {
    const subject = established.reason === 'disabled' || established.reason === 'stale';
    return redirectFailure(flow, subject ? 'subject_refused' : 'mapping_failed');
  }
  return {
    status: 303,
    headers: { location: returnPath },
    cookies: [...established.cookies, attemptCookie(provider.cookieName, '')],
  };
}

export async function callback(attached: Attached, request: Request): Promise<Reply> {
  const { deps } = attached;
  const limited = await addressLimit(deps, 'authOidcCallback', request);
  if (limited !== null) {
    return limited;
  }
  const provider = providerOf(attached.policy, request.params.provider);
  const flow: Flow = { attached, provider, request };
  const state = digestOf(request.query.state);
  const binding = digestOf(request.rawCookies.get(provider.cookieName));
  if (state === null || binding === null) {
    return fail(flow, 'attempt_invalid');
  }
  let attempt: Awaited<ReturnType<typeof deps.store.attemptConsume>>;
  try {
    attempt = await deps.store.attemptConsume({ state, binding, provider: provider.name }, request.signal);
  } catch (error) {
    storeUnavailable(deps.events, request.log, error);
    signinFailed(flow, 'unavailable');
    throw unavailable();
  }
  if (attempt.kind === 'lost') {
    return fail(flow, 'attempt_invalid');
  }
  return afterConsume(flow, attempt);
}

// Does:  Runs every step after the attempt was spent; each failure redirects and none restores the attempt.
async function afterConsume(
  flow: Flow,
  attempt: { readonly nonce: string; readonly verifier: string; readonly returnPath: string },
): Promise<Reply> {
  const { attached, provider, request } = flow;
  const { query } = request;
  const shutdown = attached.deps.signal;
  const config = await untilShutdown(
    shutdown,
    readProviderConfig(provider.discovery, provider.issuer, (reason) => {
      attached.deps.events.oidcProviderRefused(request.log, { 'auth.provider': provider.name, 'auth.reason': reason });
    }),
  );
  if (config === SHUTDOWN) {
    return shutDown(flow, false);
  }
  if (config.kind === 'unavailable') {
    return fail(flow, 'provider_unavailable');
  }
  if (query.iss === undefined ? config.value.issParameter : query.iss !== provider.issuer) {
    return fail(flow, 'provider_response');
  }
  if (query.error !== undefined) {
    return fail(flow, query.error === 'access_denied' ? 'provider_denied' : 'provider_error');
  }
  if (query.code === undefined) {
    return fail(flow, 'provider_response');
  }
  const exchanged = await untilShutdown(
    shutdown,
    exchange(flow, config.value.tokenEndpoint, expose(query.code), attempt.verifier),
  );
  if (exchanged === SHUTDOWN) {
    return shutDown(flow, false);
  }
  if (typeof exchanged === 'string') {
    return fail(flow, exchanged);
  }
  const checked = await untilShutdown(
    shutdown,
    verifyIdToken(exchanged.idToken, provider, config.value.jwksUri, attempt.nonce),
  );
  if (checked === SHUTDOWN) {
    return shutDown(flow, false);
  }
  if (checked.kind === 'unavailable') {
    attached.deps.events.keysUnavailable(request.log, { 'auth.source': provider.name, 'auth.reason': checked.reason });
    return fail(flow, 'provider_unavailable');
  }
  if (checked.kind === 'refused') {
    return fail(flow, 'provider_response');
  }
  const identity = identityOf(provider, checked.subject, checked.claims);
  const resolution = await resolve(flow, identity, [request.signal], shutdown);
  if (resolution === SHUTDOWN) {
    return shutDown(flow, false);
  }
  if (resolution === null) {
    return fail(flow, 'mapping_failed');
  }
  if (resolution.kind === 'deny') {
    return fail(flow, 'mapping_denied');
  }
  return handOff(flow, identity, resolution.userId, attempt.returnPath);
}
