// Does:  Declares the API-key part's types: its options, its trusted administration calls and the listed key.
// Holds: No type here carries a key's digest, and only the issued outcome carries its secret.

import type { Secret } from '@skeld/core/secret';
import type { ApiKeyPart } from '../server/internal-types.ts';
import type { Unavailable } from '../store/types.ts';

/** The options of `apiKeys`. */
export interface ApiKeyOptions {
  /** Most unexpired keys one user may hold, from 1 to 1,000 (default 100). */
  readonly maxPerUser?: number;
}

/**
 * The API-key part given to `createAuth`, with its trusted server-side administration calls; there are no key routes.
 * Each call rejects AuthError `INVALID_INPUT` for an input out of bounds, `NOT_READY` before `listen` and `CLOSED` after.
 */
export interface ApiKeys extends ApiKeyPart {
  /** Issues a key; the secret appears only in the `issued` outcome. */
  issue(input: {
    readonly userId: string;
    readonly name: string;
    readonly scopes: readonly string[];
    readonly expiresInSeconds?: number;
  }): Promise<
    | { readonly kind: 'issued'; readonly key: Secret<string>; readonly info: ApiKeyInfo }
    | { readonly kind: 'refused'; readonly reason: 'limit' | 'disabled' }
    | Unavailable
  >;
  /** Lists a user's unexpired keys. */
  list(input: {
    readonly userId: string;
  }): Promise<{ readonly kind: 'listed'; readonly keys: readonly ApiKeyInfo[] } | Unavailable>;
  /** Revokes one of a user's keys. */
  revoke(input: {
    readonly userId: string;
    readonly keyId: string;
  }): Promise<{ readonly kind: 'revoked' } | { readonly kind: 'absent' } | Unavailable>;
}

/** An API key as listed: never its secret or digest. */
export interface ApiKeyInfo {
  /** The key's id, 16 characters. */
  readonly keyId: string;
  /** The key's name. */
  readonly name: string;
  /** The key's scopes, each `<policy>:<action>`. */
  readonly scopes: readonly string[];
  /** When it was issued, in epoch milliseconds. */
  readonly createdAt: number;
  /** When it expires, in epoch milliseconds, or `null` for never. */
  readonly expiresAt: number | null;
}
