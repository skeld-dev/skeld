import { hashPassword, needsRehash, type PasswordCost, verifyPassword } from '@skeld/auth/password';
import type { Limits, Sessions } from '@skeld/auth/server';
import { HttpError } from '@skeld/core/http-error';
import type { Secret } from '@skeld/core/secret';
import type { Handler } from '@skeld/core/server';
import type { appContract } from './contract.ts';
import type { Users } from './users.ts';

// The application's current hashing cost. Hashes made at a lower cost are replaced at the next sign-in.
export const PASSWORD_COST: PasswordCost = { memoryKiB: 19_456, passes: 3 };

const LOGIN_FAILED = { status: 401, code: 'LOGIN_FAILED', message: 'Username or password not accepted' } as const;

export function unavailable(): HttpError {
  return new HttpError(503, 'UNAVAILABLE', 'Service unavailable');
}

// Every failed sign-in gets this one answer, whatever the cause: no user, a wrong password, or a subject
// that auth refused (disabled during a credential change, or a stale verification).
const failed = () => ({ status: 401, body: LOGIN_FAILED }) as const;

export function createLogin(deps: {
  readonly sessions: Sessions;
  readonly limits: Limits<'login'>;
  readonly users: Users;
  // A hash of a random password at PASSWORD_COST, made at start, verified when there is no user to verify.
  readonly dummyHash: string;
}): Handler<typeof appContract, 'login'> {
  const { sessions, limits, users, dummyHash } = deps;

  return async (request) => {
    const { username, password } = request.body;
    const { signal } = request;

    // 1. Charge the limit before any hashing, so a flood of guesses costs the attacker, not the thread pool.
    const verdict = await limits.charge('login', { clientAddress: request.clientAddress }, signal);
    if (verdict.kind === 'limited') {
      return {
        status: 429,
        body: { status: 429, code: 'RATE_LIMITED', message: 'Too many requests' },
        headers: { 'retry-after': String(verdict.retryAfterSeconds) },
      };
    }
    if (verdict.kind === 'unavailable') {
      throw unavailable();
    }

    // 2. An unknown user still costs one verification, against the dummy hash, and gets the same answer.
    //    This removes the cheapest enumeration signal; it does not make response times equal.
    const user = users.findByName(username);
    if (user === undefined) {
      return answerFailure(await verifyPassword(password, dummyHash, { signal }));
    }

    // 3. Hand the decision to auth. verify reads the stored hash inside the call: auth has already taken its
    //    snapshot of the subject, so a credential change that finished before this read is judged on the new hash.
    // judged.hash is the stored hash verify read, or null while auth has not called verify.
    const judged: { hash: string | null } = { hash: null };
    const result = await sessions.establish({
      rawCookies: request.rawCookies,
      userId: user.id,
      signal,
      verify: async (verifySignal) => {
        const current = users.findById(user.id);
        judged.hash = current?.passwordHash ?? dummyHash;
        const checked = await verifyPassword(password, judged.hash, { signal: verifySignal });
        // A busy hash helper is not a wrong password: auth answers Unavailable and the client gets 503.
        if (checked.kind === 'busy') {
          return 'unavailable';
        }
        return checked.kind === 'match' && current !== undefined;
      },
    });

    if (result.kind === 'established') {
      if (judged.hash !== null && needsRehash(judged.hash, PASSWORD_COST)) {
        await upgradeHash(users, user.id, judged.hash, password, signal);
      }
      return { status: 200, body: result.session, cookies: result.cookies };
    }
    if (result.kind === 'unavailable' || result.reason === 'callback') {
      throw unavailable();
    }
    // Auth refused before calling verify (the subject is disabled): verify the dummy hash so this failure
    // costs a hash computation like every other.
    if (judged.hash === null) {
      return answerFailure(await verifyPassword(password, dummyHash, { signal }));
    }
    return failed();
  };
}

function answerFailure(checked: { readonly kind: string }) {
  if (checked.kind === 'busy') {
    throw unavailable();
  }
  return failed();
}

// A rehash keeps the same password, so it is not a credential change and needs no disable and enable.
// The write is conditional on the hash just verified: a password change that landed first is never undone.
async function upgradeHash(
  users: Users,
  userId: string,
  verified: string,
  password: Secret<string>,
  signal: AbortSignal,
): Promise<void> {
  const next = await hashPassword(password, { cost: PASSWORD_COST, signal });
  if (next.kind === 'hashed') {
    users.replaceHash(userId, verified, next.hash);
  }
}
