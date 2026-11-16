// Does:  Builds the session handoff: establishing a session after the application's verify, and rotating one.
// Holds: A session is issued only by one sessionIssue at the generation read before verify ran, after verify said true.

import type { LogFields } from '@skeld/core/log';
import { AuthError } from '../auth-error/auth-error.ts';
import type { Centre, Runtime } from '../server/centre.ts';
import type { PartSessions } from '../server/internal-types.ts';
import type { Unavailable } from '../store/types.ts';
import { storeUnavailable } from '../store/unavailable.ts';
import { mintToken, readSessionCookie, sessionCookie } from './token.ts';
import type { Established, EstablishInput, Rotated, Sessions } from './types.ts';
import { checkUserId } from './user-id.ts';
import { firstUnknownKey } from '../server/unknown-key.ts';

// Why: The handoff's deadline for the application's verify, fixed by the contract.
const VERIFY_DEADLINE_MS = 10_000;

const ESTABLISH_KEYS: ReadonlySet<string> = new Set(['rawCookies', 'userId', 'verify', 'signal']);
const ROTATE_KEYS: ReadonlySet<string> = new Set(['rawCookies', 'signal']);
const NO_SESSION: Rotated = Object.freeze({ kind: 'refused', reason: 'no_session' });
const NOT_APPLIED: Unavailable = Object.freeze({ kind: 'unavailable', outcome: 'not_applied' });

type Verdict = 'accepted' | 'rejected' | 'unavailable' | 'threw' | 'malformed' | 'deadline' | 'aborted';

// Does:  Rejects an input object holding an own key, string or symbol, that its type does not name.
function checkKeys(input: unknown, known: ReadonlySet<string>): void {
  if (typeof input !== 'object' || input === null || firstUnknownKey(input, known) !== null) {
    throw new AuthError('INVALID_INPUT');
  }
}

// Does:  Calls verify once under its deadline; shutdown or the caller's signal ends the wait at once.
// Holds: A result or a throw that arrives after the deadline or an abort is ignored, and verify's text is never kept.
async function callVerify(verify: EstablishInput['verify'], abort: AbortSignal): Promise<Verdict> {
  if (abort.aborted) {
    return 'aborted';
  }
  const deadline = new AbortController();
  const ended = Promise.withResolvers<Verdict>();
  const onAbort = (): void => ended.resolve('aborted');
  abort.addEventListener('abort', onAbort, { once: true });
  const timer = setTimeout(() => {
    ended.resolve('deadline');
    deadline.abort();
  }, VERIFY_DEADLINE_MS);
  const answer = Promise.try(() => verify(AbortSignal.any([deadline.signal, abort]))).then(
    (value: unknown): Verdict => {
      if (value === 'unavailable') {
        return 'unavailable';
      }
      if (typeof value !== 'boolean') {
        return 'malformed';
      }
      return value ? 'accepted' : 'rejected';
    },
    (): Verdict => 'threw',
  );
  try {
    return await Promise.race([answer, ended.promise]);
  } finally {
    clearTimeout(timer);
    abort.removeEventListener('abort', onAbort);
  }
}

// Does:  Runs the handoff once; via and provider are written on its sign-in records.
async function establish(runtime: Runtime, input: EstablishInput, via: LogFields): Promise<Established> {
  const { store, events, log, session, shutdown } = runtime;
  checkKeys(input, ESTABLISH_KEYS);
  const userId = checkUserId(input.userId);
  const { signal } = input;
  const failed = (reason: string): void => {
    events.signinFailed(log, { 'auth.user': userId, ...via, 'auth.reason': reason });
  };
  const refused = (reason: 'rejected' | 'disabled' | 'stale' | 'callback'): Established => {
    failed(reason);
    return Object.freeze({ kind: 'refused', reason });
  };
  const unavailable = (answer: Unavailable): Unavailable => {
    failed('unavailable');
    return answer;
  };
  let fence: Awaited<ReturnType<typeof store.subjectEnsure>>;
  try {
    // Why: The fence is read before verify runs, so a disable or invalidation committed meanwhile makes issue fail.
    fence = await store.subjectEnsure({ userId }, signal);
  } catch (error) {
    return unavailable(storeUnavailable(events, log, error));
  }
  if (!fence.enabled) {
    return refused('disabled');
  }
  const verdict = await callVerify(input.verify, signal === undefined ? shutdown : AbortSignal.any([shutdown, signal]));
  if (verdict === 'aborted' || verdict === 'unavailable') {
    return unavailable(NOT_APPLIED);
  }
  if (verdict === 'rejected') {
    return refused('rejected');
  }
  if (verdict !== 'accepted') {
    events.callbackFailed(log, { 'auth.callback': 'handoff.verify', 'auth.cause': verdict });
    return refused('callback');
  }
  const token = mintToken();
  const replaces = readSessionCookie(input.rawCookies, session.cookieName)?.digest ?? null;
  let issued: Awaited<ReturnType<typeof store.sessionIssue>>;
  try {
    issued = await store.sessionIssue(
      {
        userId,
        generation: fence.generation,
        digest: token.digest,
        replaces,
        idleMs: session.idleMs,
        absoluteMs: session.absoluteMs,
      },
      signal,
    );
  } catch (error) {
    return unavailable(storeUnavailable(events, log, error));
  }
  if (issued.kind === 'lost') {
    return refused(issued.reason);
  }
  const absoluteLeftMs = issued.createdAt + session.absoluteMs - issued.now;
  events.signinSucceeded(log, { 'auth.user': userId, ...via });
  return Object.freeze({
    kind: 'established',
    session: Object.freeze({ status: 'session', userId, csrfToken: token.csrfToken, expiresAt: issued.expiresAt }),
    cookies: Object.freeze([sessionCookie(session.cookieName, token, Math.floor(absoluteLeftMs / 1000))]),
  });
}

async function rotate(
  runtime: Runtime,
  input: { readonly rawCookies: EstablishInput['rawCookies']; readonly signal?: AbortSignal },
): Promise<Rotated> {
  const { store, events, log, session } = runtime;
  checkKeys(input, ROTATE_KEYS);
  const { signal } = input;
  const current = readSessionCookie(input.rawCookies, session.cookieName);
  if (current === null) {
    return NO_SESSION;
  }
  const next = mintToken();
  try {
    const record = await store.sessionRead({ digest: current.digest }, signal);
    if (record === null) {
      return NO_SESSION;
    }
    // Why: The read only names the user; the rotate unit itself requires the live row of that user, under its lock.
    const rotated = await store.sessionRotate(
      { userId: record.userId, digest: current.digest, next: next.digest, idleMs: session.idleMs },
      signal,
    );
    if (rotated.kind === 'lost') {
      return NO_SESSION;
    }
    return Object.freeze({
      kind: 'rotated',
      session: Object.freeze({
        status: 'session',
        userId: record.userId,
        csrfToken: next.csrfToken,
        expiresAt: rotated.expiresAt,
      }),
      cookies: Object.freeze([
        sessionCookie(session.cookieName, next, Math.floor((rotated.absoluteExpiresAt - rotated.now) / 1000)),
      ]),
    });
  } catch (error) {
    return storeUnavailable(events, log, error);
  }
}

// Does:  Builds the application's handoff and the parts' handoff, which records the provider a part signed in with.
export function createSessions(centre: Centre): { readonly sessions: Sessions; readonly parts: PartSessions } {
  return Object.freeze({
    sessions: Object.freeze({
      establish: (input: EstablishInput) =>
        Promise.try(() => establish(centre.use(), input, { 'auth.via': 'handoff' })),
      rotate: (input: Parameters<Sessions['rotate']>[0]) => Promise.try(() => rotate(centre.use(), input)),
    }),
    parts: Object.freeze({
      establish: (input: EstablishInput, provider: string) =>
        Promise.try(() => establish(centre.use(), input, { 'auth.via': 'oidc', 'auth.provider': provider })),
    }),
  });
}
