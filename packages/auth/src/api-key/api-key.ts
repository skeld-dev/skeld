// Does:  Exports @skeld/auth/api-key: the API-key part, its trusted administration calls and its bearer verifier.
// Holds: The store sees only a key's SHA-256 digest; the key text leaves auth only in the issued outcome.

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { GateRequest } from '@skeld/core/gate';
import { Secret } from '@skeld/core/secret';
import { AuthError } from '../auth-error/auth-error.ts';
import { isAccessName } from '../policy/access-name.ts';
import { checkUserId } from '../session/user-id.ts';
import type { BearerVerdict, BearerVerifier, PartDeps } from '../server/internal-types.ts';
import { OptionFault } from '../server/option-fault.ts';
import { firstUnknownKey } from '../server/unknown-key.ts';
import { storeUnavailable } from '../store/unavailable.ts';
import type { Digest } from '../store/types.ts';
import type { ApiKeyInfo, ApiKeyOptions, ApiKeys } from './types.ts';

export type { ApiKeyInfo, ApiKeyOptions, ApiKeys } from './types.ts';

const PREFIX = 'skeld1.';
const ID_BYTES = 12;
const SECRET_BYTES = 32;
const KEY_TEXT = /^skeld1\.([A-Za-z0-9_-]{16})\.([A-Za-z0-9_-]{43})$/;
const KEY_ID = /^[A-Za-z0-9_-]{16}$/;
const NAME = /^[\x20-\x7E]{1,64}$/;
const MAX_SCOPES = 32;
const OPTION_KEYS: ReadonlySet<string> = new Set(['maxPerUser']);
const ISSUE_KEYS: ReadonlySet<string> = new Set(['userId', 'name', 'scopes', 'expiresInSeconds']);
const LIST_KEYS: ReadonlySet<string> = new Set(['userId']);
const REVOKE_KEYS: ReadonlySet<string> = new Set(['userId', 'keyId']);
const DEFAULT_MAX_PER_USER = 100;
const MIN_EXPIRY_SECONDS = 60;
const MAX_EXPIRY_SECONDS = 31_536_000;

const INVALID: BearerVerdict = Object.freeze({ kind: 'invalid' });
const VERIFY_UNAVAILABLE: BearerVerdict = Object.freeze({ kind: 'unavailable' });
const REVOKED = Object.freeze({ kind: 'revoked' as const });
const ABSENT = Object.freeze({ kind: 'absent' as const });

interface Attached {
  readonly deps: PartDeps;
  readonly maxPerUser: number;
}

function isInteger(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= min && value <= max;
}

function checked<T>(value: T, valid: boolean): T {
  if (!valid) {
    throw new AuthError('INVALID_INPUT');
  }
  return value;
}

// Does:  Refuses a call input that is not an object or holds an own key its type does not name.
function checkKeys(input: unknown, keys: ReadonlySet<string>): void {
  if (typeof input !== 'object' || input === null || firstUnknownKey(input, keys) !== null) {
    throw new AuthError('INVALID_INPUT');
  }
}

// Does:  Tests a scope: the text <policy>:<action>, each an access name.
function isScope(scope: unknown): boolean {
  if (typeof scope !== 'string') {
    return false;
  }
  const colon = scope.indexOf(':');
  return colon !== -1 && isAccessName(scope.slice(0, colon)) && isAccessName(scope.slice(colon + 1));
}

function digestOf(secret: Uint8Array): Digest {
  return new Uint8Array(createHash('sha256').update(secret).digest());
}

// Does:  Reads a bearer token as an API key's id and secret bytes, or null when it is not one in canonical form.
function parseKey(token: string): { readonly keyId: string; readonly secret: Buffer } | null {
  const match = KEY_TEXT.exec(token);
  const keyId = match?.[1];
  const text = match?.[2];
  if (keyId === undefined || text === undefined) {
    return null;
  }
  const secret = Buffer.from(text, 'base64url');
  // Why: 43 characters carry two bits more than 32 bytes; only the one spelling minted for the key is accepted.
  return secret.toString('base64url') === text ? { keyId, secret } : null;
}

/**
 * Creates the API-key part given to `createAuth`; it checks its options at `listen` (`maxPerUser` 1 to 1,000).
 * Keys are `skeld1.<id>.<secret>` bearer tokens; administration is these trusted calls, never routes.
 * @example const keys = apiKeys({ maxPerUser: 20 });
 */
export function apiKeys(options?: ApiKeyOptions): ApiKeys {
  let state: Attached | 'new' | 'closed' = 'new';

  function use(): Attached {
    if (state === 'closed') {
      throw new AuthError('CLOSED');
    }
    if (state === 'new') {
      throw new AuthError('NOT_READY');
    }
    return state;
  }

  const part: ApiKeys = {
    kind: 'api_key',

    attach(deps: PartDeps): BearerVerifier {
      if (state !== 'new') {
        throw new OptionFault('api_key', 'already attached');
      }
      const given: unknown = options;
      if (given !== undefined && (typeof given !== 'object' || given === null)) {
        throw new OptionFault('api_key', 'apiKeys: must be an object');
      }
      const unknownKey = given === undefined ? null : firstUnknownKey(given, OPTION_KEYS);
      if (unknownKey !== null) {
        throw new OptionFault('api_key', `apiKeys.${unknownKey}: is not a key of ApiKeyOptions`);
      }
      const maxPerUser = options?.maxPerUser ?? DEFAULT_MAX_PER_USER;
      if (!isInteger(maxPerUser, 1, 1000)) {
        throw new OptionFault('api_key', 'apiKeys.maxPerUser: must be an integer from 1 to 1,000');
      }
      state = Object.freeze({ deps, maxPerUser });
      deps.onClose(() => {
        state = 'closed';
      });
      return Object.freeze({
        async verify(token: string, request: GateRequest): Promise<BearerVerdict> {
          const parsed = parseKey(token);
          if (parsed === null) {
            return INVALID;
          }
          let record: Awaited<ReturnType<typeof deps.store.apiKeyRead>>;
          try {
            record = await deps.store.apiKeyRead({ keyId: parsed.keyId }, request.signal);
          } catch (error) {
            storeUnavailable(deps.events, request.log, error);
            return VERIFY_UNAVAILABLE;
          }
          if (record === null || !timingSafeEqual(digestOf(parsed.secret), record.digest) || !record.enabled) {
            return INVALID;
          }
          return Object.freeze({
            kind: 'verified',
            principal: Object.freeze({
              kind: 'api_key',
              userId: record.userId,
              keyId: parsed.keyId,
              scopes: Object.freeze([...record.scopes]),
            }),
          });
        },
      });
    },

    async issue(input) {
      const { deps, maxPerUser } = use();
      checkKeys(input, ISSUE_KEYS);
      const userId = checkUserId(input.userId);
      const name = checked(input.name, typeof input.name === 'string' && NAME.test(input.name));
      const given: unknown = input.scopes;
      const scopes = checked(
        input.scopes,
        Array.isArray(given) &&
          given.length >= 1 &&
          given.length <= MAX_SCOPES &&
          given.every(isScope) &&
          new Set(given).size === given.length,
      );
      const seconds = input.expiresInSeconds;
      if (seconds !== undefined && !isInteger(seconds, MIN_EXPIRY_SECONDS, MAX_EXPIRY_SECONDS)) {
        throw new AuthError('INVALID_INPUT');
      }
      const keyId = randomBytes(ID_BYTES).toString('base64url');
      const secret = randomBytes(SECRET_BYTES);
      const frozenScopes = Object.freeze([...scopes]);
      let result: Awaited<ReturnType<typeof deps.store.apiKeyIssue>>;
      try {
        result = await deps.store.apiKeyIssue({
          userId,
          keyId,
          digest: digestOf(secret),
          name,
          scopes: frozenScopes,
          expiresInMs: seconds === undefined ? null : seconds * 1000,
          max: maxPerUser,
        });
      } catch (error) {
        return storeUnavailable(deps.events, deps.log, error);
      }
      if (result.kind === 'lost') {
        return Object.freeze({ kind: 'refused', reason: result.reason });
      }
      deps.events.credentialChanged(deps.log, {
        'auth.user': userId,
        'auth.credential': 'api_key',
        'auth.change': 'added',
        'auth.key': keyId,
      });
      const info: ApiKeyInfo = Object.freeze({
        keyId,
        name,
        scopes: frozenScopes,
        createdAt: result.createdAt,
        expiresAt: result.expiresAt,
      });
      return Object.freeze({
        kind: 'issued',
        key: new Secret(`${PREFIX}${keyId}.${secret.toString('base64url')}`),
        info,
      });
    },

    async list(input) {
      const { deps, maxPerUser } = use();
      checkKeys(input, LIST_KEYS);
      const userId = checkUserId(input.userId);
      try {
        const done = await deps.store.apiKeyList({ userId, limit: maxPerUser });
        return Object.freeze({ kind: 'listed', keys: done.keys });
      } catch (error) {
        return storeUnavailable(deps.events, deps.log, error);
      }
    },

    async revoke(input) {
      const { deps } = use();
      checkKeys(input, REVOKE_KEYS);
      const userId = checkUserId(input.userId);
      const keyId = checked(input.keyId, typeof input.keyId === 'string' && KEY_ID.test(input.keyId));
      let done: Awaited<ReturnType<typeof deps.store.apiKeyRevoke>>;
      try {
        done = await deps.store.apiKeyRevoke({ userId, keyId });
      } catch (error) {
        return storeUnavailable(deps.events, deps.log, error);
      }
      if (!done.revoked) {
        return ABSENT;
      }
      deps.events.credentialChanged(deps.log, {
        'auth.user': userId,
        'auth.credential': 'api_key',
        'auth.change': 'removed',
        'auth.key': keyId,
      });
      return REVOKED;
    },
  };
  return Object.freeze(part);
}
