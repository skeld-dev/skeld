// Does:  Declares the auth store's contract: its lifecycle, its 18 atomic operations and the records they resolve.
// Holds: The 18 operations are the store's whole surface; there is no query, transaction or SQL member.

import type { ApiKeyInfo } from '../api-key/types.ts';

/** A SHA-256 digest: exactly 32 bytes. */
export type Digest = Uint8Array;

/** A store or limiter that could not answer; `unknown` means the change may have been applied. */
export interface Unavailable {
  /** Marks the outcome. */
  readonly kind: 'unavailable';
  /** Whether nothing changed or the outcome is unknown; `unknown` is never reported as success. */
  readonly outcome: 'not_applied' | 'unknown';
}

/**
 * A store auth keeps its state in: subject fences, sessions, API keys, limit windows and OIDC attempts.
 * Every operation rejects `StoreFailure` `unavailable` before `attach` and after `close`.
 */
export interface AuthStore {
  /** Creates the schema when none exists, as a deploy step; it never alters or drops. Rejects `StoreFailure`. */
  install(): Promise<InstallResult>;
  /** Reads the version and starts cleanup; called once by the gate's boot. */
  attach(config: StoreAttach): Promise<AttachResult>;
  /** Waits for operations in flight, stops cleanup and closes what the store opened; it never ends a given pool. */
  close(): Promise<void>;
  /** The 18 atomic operations. */
  readonly ops: StoreOperations;
}

/** What `install` found: a new schema, the current one, or another version it left alone. */
export type InstallResult =
  | {
      /** What `install` found. */
      readonly kind: 'installed';
    }
  | { readonly kind: 'current' }
  | {
      readonly kind: 'mismatch';
      /** The version found. */
      readonly found: number;
    };

/** What `attach` found; a second call answers `in_use` and changes nothing. */
export type AttachResult =
  | {
      /** What `attach` found. */
      readonly kind: 'attached';
    }
  | { readonly kind: 'in_use' }
  | { readonly kind: 'not_installed' }
  | {
      readonly kind: 'mismatch';
      /** The version found. */
      readonly found: number;
    };

/** What `attach` receives. */
export interface StoreAttach {
  /** Reports a failure outside an operation's caller, such as a pool error or a failed cleanup pass; never throws. */
  readonly onFailure: (event: StoreEvent) => void;
}

/** A store failure reported through `onFailure`. */
export interface StoreEvent {
  /** The operation or step that failed. */
  readonly operation: string;
  /** What kind of failure it was. */
  readonly cause: 'unavailable' | 'unknown' | 'fault' | 'record';
  /** The SQLSTATE or the SQLite result code as decimal text; never engine text. */
  readonly code: string | null;
}

/** An operation that changed or read what it was asked to, judged at `now`. */
export type Done<T> = {
  /** Marks a done operation. */
  readonly kind: 'done';
  /** The unit's judging time, in epoch milliseconds from the store's clock. */
  readonly now: number;
} & T;

/** An operation whose condition did not hold; nothing changed. */
export interface Lost<R> {
  /** Marks the outcome. */
  readonly kind: 'lost';
  /** Which condition did not hold. */
  readonly reason: R;
  /** The unit's judging time, in epoch milliseconds from the store's clock. */
  readonly now: number;
}

/** A subject's session fence. */
export interface SubjectRecord {
  /** Whether sessions and API keys of the subject are accepted. */
  readonly enabled: boolean;
  /** Raised by every disable and revocation of all sessions; a session issued at an older one is refused. */
  readonly generation: number;
  /** The read's judging time, in epoch milliseconds. */
  readonly now: number;
}

/** A live session. */
export interface SessionRecord {
  /** The subject. */
  readonly userId: string;
  /** When the session was first issued, in epoch milliseconds. */
  readonly createdAt: number;
  /** When it was last renewed, in epoch milliseconds. */
  readonly lastSeenAt: number;
  /** When it ends without renewal, in epoch milliseconds. */
  readonly expiresAt: number;
  /** When it ends whatever renewal happens, in epoch milliseconds. */
  readonly absoluteExpiresAt: number;
  /** The read's judging time, in epoch milliseconds. */
  readonly now: number;
}

/** An unexpired API key with its subject's state, read in one statement. */
export interface ApiKeyRecord {
  /** The subject. */
  readonly userId: string;
  /** The SHA-256 of the key's secret. */
  readonly digest: Digest;
  /** The key's scopes, each `<policy>:<action>`. */
  readonly scopes: readonly string[];
  /** When the key expires, in epoch milliseconds, or `null` for never. */
  readonly expiresAt: number | null;
  /** Whether the subject is enabled; `false` when its fence is absent. */
  readonly enabled: boolean;
  /** The read's judging time, in epoch milliseconds. */
  readonly now: number;
}

/**
 * The store's 18 operations; each is one atomic unit that commits whole or changes nothing.
 * Each rejects only with `StoreFailure`; a signal that aborts after the unit began reports `applied: 'unknown'` or nothing.
 */
export interface StoreOperations {
  /** Creates the subject's fence, enabled at generation 1, when absent; returns it. */
  subjectEnsure(
    input: { readonly userId: string },
    signal?: AbortSignal,
  ): Promise<Done<{ readonly enabled: boolean; readonly generation: number }>>;
  /** Reads the subject's fence without a lock; `null` when absent. */
  subjectRead(input: { readonly userId: string }, signal?: AbortSignal): Promise<SubjectRecord | null>;
  /** Disables the subject, raises its generation and deletes its sessions. */
  subjectDisable(
    input: { readonly userId: string },
    signal?: AbortSignal,
  ): Promise<Done<{ readonly generation: number; readonly revoked: number }>>;
  /** Enables a subject disabled at exactly `generation`, raising the generation and deleting its sessions. */
  subjectEnable(
    input: { readonly userId: string; readonly generation: number },
    signal?: AbortSignal,
  ): Promise<Done<{ readonly generation: number; readonly revoked: number }> | Lost<'absent' | 'enabled' | 'stale'>>;
  /** Raises the subject's generation and deletes its sessions; `enabled` is unchanged. */
  subjectInvalidate(
    input: { readonly userId: string },
    signal?: AbortSignal,
  ): Promise<Done<{ readonly enabled: boolean; readonly generation: number; readonly revoked: number }>>;
  /** Issues a session for an enabled subject at exactly `generation`, deleting the `replaces` row whoever holds it. */
  sessionIssue(
    input: {
      readonly userId: string;
      readonly generation: number;
      readonly digest: Digest;
      readonly replaces: Digest | null;
      readonly idleMs: number;
      readonly absoluteMs: number;
    },
    signal?: AbortSignal,
  ): Promise<Done<{ readonly createdAt: number; readonly expiresAt: number }> | Lost<'stale' | 'disabled'>>;
  /** Reads one live session without a lock or cache; `null` when absent or expired. */
  sessionRead(input: { readonly digest: Digest }, signal?: AbortSignal): Promise<SessionRecord | null>;
  /** Extends a live session's idle expiry, never past its absolute expiry; never creates a row. */
  sessionRenew(
    input: { readonly digest: Digest; readonly idleMs: number },
    signal?: AbortSignal,
  ): Promise<Done<{ readonly expiresAt: number }> | Lost<'gone'>>;
  /** Replaces a live session of the subject with `next`, keeping its creation and absolute expiry. */
  sessionRotate(
    input: { readonly userId: string; readonly digest: Digest; readonly next: Digest; readonly idleMs: number },
    signal?: AbortSignal,
  ): Promise<
    Done<{ readonly createdAt: number; readonly expiresAt: number; readonly absoluteExpiresAt: number }> | Lost<'gone'>
  >;
  /** Deletes a session by digest; an absent row is `revoked: false`. */
  sessionRevoke(
    input: { readonly digest: Digest },
    signal?: AbortSignal,
  ): Promise<Done<{ readonly revoked: boolean; readonly userId: string | null }>>;
  /** Inserts a key for an enabled subject holding fewer than `max` unexpired keys, creating its fence when absent. */
  apiKeyIssue(
    input: {
      readonly userId: string;
      readonly keyId: string;
      readonly digest: Digest;
      readonly name: string;
      readonly scopes: readonly string[];
      readonly expiresInMs: number | null;
      readonly max: number;
    },
    signal?: AbortSignal,
  ): Promise<Done<{ readonly createdAt: number; readonly expiresAt: number | null }> | Lost<'limit' | 'disabled'>>;
  /** Reads an unexpired key with its subject's `enabled` in one statement; `null` when absent or expired. */
  apiKeyRead(input: { readonly keyId: string }, signal?: AbortSignal): Promise<ApiKeyRecord | null>;
  /** Lists at most `limit` unexpired keys of the subject, in no set order. */
  apiKeyList(
    input: { readonly userId: string; readonly limit: number },
    signal?: AbortSignal,
  ): Promise<Done<{ readonly keys: readonly ApiKeyInfo[] }>>;
  /** Deletes the key when its id and subject both match. */
  apiKeyRevoke(
    input: { readonly userId: string; readonly keyId: string },
    signal?: AbortSignal,
  ): Promise<Done<{ readonly revoked: boolean }>>;
  /** Counts one charge in a fixed window, restarting an expired one; at `max` nothing changes. */
  limitCharge(
    input: { readonly key: Digest; readonly max: number; readonly windowMs: number },
    signal?: AbortSignal,
  ): Promise<
    Done<{ readonly count: number; readonly resetAt: number }> | (Lost<'limit'> & { readonly retryAfterMs: number })
  >;
  /** Inserts one OIDC attempt that expires after `ttlMs`; a repeated `state` is a fault. */
  attemptCreate(
    input: {
      readonly state: Digest;
      readonly binding: Digest;
      readonly provider: string;
      readonly nonce: string;
      readonly verifier: string;
      readonly returnPath: string;
      readonly ttlMs: number;
    },
    signal?: AbortSignal,
  ): Promise<Done<{ readonly expiresAt: number }>>;
  /** Spends a live attempt of this browser and provider; another binding or provider leaves the row as it was. */
  attemptConsume(
    input: { readonly state: Digest; readonly binding: Digest; readonly provider: string },
    signal?: AbortSignal,
  ): Promise<
    Done<{ readonly nonce: string; readonly verifier: string; readonly returnPath: string }> | Lost<'gone' | 'binding'>
  >;
  /** Deletes at most `limit` expired rows of sessions, keys, limit windows and attempts; never a subject. */
  expiredRemove(input: { readonly limit: number }, signal?: AbortSignal): Promise<Done<{ readonly removed: number }>>;
}
