# @skeld/auth/store

## ApiKeyRecord

An unexpired API key with its subject's state, read in one statement.

```ts
export interface ApiKeyRecord {
  readonly userId: string;
  readonly digest: Digest;
  readonly scopes: readonly string[];
  readonly expiresAt: number | null;
  readonly enabled: boolean;
  readonly now: number;
}
```

| Field       | Summary                                                           |
| ----------- | ----------------------------------------------------------------- |
| `userId`    | The subject.                                                      |
| `digest`    | The SHA-256 of the key's secret.                                  |
| `scopes`    | The key's scopes, each `<policy>:<action>`.                       |
| `expiresAt` | When the key expires, in epoch milliseconds, or `null` for never. |
| `enabled`   | Whether the subject is enabled; `false` when its fence is absent. |
| `now`       | The read's judging time, in epoch milliseconds.                   |

Source: `packages/auth/src/store/types.ts:120`

## AttachResult

What `attach` found; a second call answers `in_use` and changes nothing.

```ts
export type AttachResult =
  | {
      readonly kind: 'attached';
    }
  | { readonly kind: 'in_use' }
  | { readonly kind: 'not_installed' }
  | {
      readonly kind: 'mismatch';
      readonly found: number;
    };
```

| Field   | Summary              |
| ------- | -------------------- |
| `kind`  | What `attach` found. |
| `found` | The version found.   |

Source: `packages/auth/src/store/types.ts:46`

## AuthStore

A store auth keeps its state in: subject fences, sessions, API keys, limit windows and OIDC attempts.

Every operation rejects `StoreFailure` `unavailable` before `attach` and after `close`.

```ts
export interface AuthStore {
  install(): Promise<InstallResult>;
  attach(config: StoreAttach): Promise<AttachResult>;
  close(): Promise<void>;
  readonly ops: StoreOperations;
}
```

| Field     | Summary                                                                                                     |
| --------- | ----------------------------------------------------------------------------------------------------------- |
| `install` | Creates the schema when none exists, as a deploy step; it never alters or drops. Rejects `StoreFailure`.    |
| `attach`  | Reads the version and starts cleanup; called once by the gate's boot.                                       |
| `close`   | Waits for operations in flight, stops cleanup and closes what the store opened; it never ends a given pool. |
| `ops`     | The 18 atomic operations.                                                                                   |

Source: `packages/auth/src/store/types.ts:21`

## Digest

A SHA-256 digest: exactly 32 bytes.

```ts
export type Digest = Uint8Array;
```

Source: `packages/auth/src/store/types.ts:7`

## Done

An operation that changed or read what it was asked to, judged at `now`.

```ts
export type Done<T> = {
  readonly kind: 'done';
  readonly now: number;
} & T;
```

| Field  | Summary                                                                |
| ------ | ---------------------------------------------------------------------- |
| `kind` | Marks a done operation.                                                |
| `now`  | The unit's judging time, in epoch milliseconds from the store's clock. |

Source: `packages/auth/src/store/types.ts:76`

## InstallResult

What `install` found: a new schema, the current one, or another version it left alone.

```ts
export type InstallResult =
  | {
      readonly kind: 'installed';
    }
  | { readonly kind: 'current' }
  | {
      readonly kind: 'mismatch';
      readonly found: number;
    };
```

| Field   | Summary               |
| ------- | --------------------- |
| `kind`  | What `install` found. |
| `found` | The version found.    |

Source: `packages/auth/src/store/types.ts:33`

## Lost

An operation whose condition did not hold; nothing changed.

```ts
export interface Lost<R> {
  readonly kind: 'lost';
  readonly reason: R;
  readonly now: number;
}
```

| Field    | Summary                                                                |
| -------- | ---------------------------------------------------------------------- |
| `kind`   | Marks the outcome.                                                     |
| `reason` | Which condition did not hold.                                          |
| `now`    | The unit's judging time, in epoch milliseconds from the store's clock. |

Source: `packages/auth/src/store/types.ts:84`

## SessionRecord

A live session.

```ts
export interface SessionRecord {
  readonly userId: string;
  readonly createdAt: number;
  readonly lastSeenAt: number;
  readonly expiresAt: number;
  readonly absoluteExpiresAt: number;
  readonly now: number;
}
```

| Field               | Summary                                                       |
| ------------------- | ------------------------------------------------------------- |
| `userId`            | The subject.                                                  |
| `createdAt`         | When the session was first issued, in epoch milliseconds.     |
| `lastSeenAt`        | When it was last renewed, in epoch milliseconds.              |
| `expiresAt`         | When it ends without renewal, in epoch milliseconds.          |
| `absoluteExpiresAt` | When it ends whatever renewal happens, in epoch milliseconds. |
| `now`               | The read's judging time, in epoch milliseconds.               |

Source: `packages/auth/src/store/types.ts:104`

## StoreAttach

What `attach` receives.

```ts
export interface StoreAttach {
  readonly onFailure: (event: StoreEvent) => void;
}
```

| Field       | Summary                                                                                                       |
| ----------- | ------------------------------------------------------------------------------------------------------------- |
| `onFailure` | Reports a failure outside an operation's caller, such as a pool error or a failed cleanup pass; never throws. |

Source: `packages/auth/src/store/types.ts:60`

## StoreEvent

A store failure reported through `onFailure`.

```ts
export interface StoreEvent {
  readonly operation: string;
  readonly cause: 'unavailable' | 'unknown' | 'fault' | 'record';
  readonly code: string | null;
}
```

| Field       | Summary                                                                    |
| ----------- | -------------------------------------------------------------------------- |
| `operation` | The operation or step that failed.                                         |
| `cause`     | What kind of failure it was.                                               |
| `code`      | The SQLSTATE or the SQLite result code as decimal text; never engine text. |

Source: `packages/auth/src/store/types.ts:66`

## StoreOperations

The store's 18 operations; each is one atomic unit that commits whole or changes nothing.

Each rejects only with `StoreFailure`; a signal that aborts after the unit began reports `applied: 'unknown'` or nothing.

```ts
export interface StoreOperations {
  subjectEnsure(
    input: { readonly userId: string },
    signal?: AbortSignal,
  ): Promise<Done<{ readonly enabled: boolean; readonly generation: number }>>;
  subjectRead(input: { readonly userId: string }, signal?: AbortSignal): Promise<SubjectRecord | null>;
  subjectDisable(
    input: { readonly userId: string },
    signal?: AbortSignal,
  ): Promise<Done<{ readonly generation: number; readonly revoked: number }>>;
  subjectEnable(
    input: { readonly userId: string; readonly generation: number },
    signal?: AbortSignal,
  ): Promise<Done<{ readonly generation: number; readonly revoked: number }> | Lost<'absent' | 'enabled' | 'stale'>>;
  subjectInvalidate(
    input: { readonly userId: string },
    signal?: AbortSignal,
  ): Promise<Done<{ readonly enabled: boolean; readonly generation: number; readonly revoked: number }>>;
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
  sessionRead(input: { readonly digest: Digest }, signal?: AbortSignal): Promise<SessionRecord | null>;
  sessionRenew(
    input: { readonly digest: Digest; readonly idleMs: number },
    signal?: AbortSignal,
  ): Promise<Done<{ readonly expiresAt: number }> | Lost<'gone'>>;
  sessionRotate(
    input: { readonly userId: string; readonly digest: Digest; readonly next: Digest; readonly idleMs: number },
    signal?: AbortSignal,
  ): Promise<
    Done<{ readonly createdAt: number; readonly expiresAt: number; readonly absoluteExpiresAt: number }> | Lost<'gone'>
  >;
  sessionRevoke(
    input: { readonly digest: Digest },
    signal?: AbortSignal,
  ): Promise<Done<{ readonly revoked: boolean; readonly userId: string | null }>>;
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
  apiKeyRead(input: { readonly keyId: string }, signal?: AbortSignal): Promise<ApiKeyRecord | null>;
  apiKeyList(
    input: { readonly userId: string; readonly limit: number },
    signal?: AbortSignal,
  ): Promise<Done<{ readonly keys: readonly ApiKeyInfo[] }>>;
  apiKeyRevoke(
    input: { readonly userId: string; readonly keyId: string },
    signal?: AbortSignal,
  ): Promise<Done<{ readonly revoked: boolean }>>;
  limitCharge(
    input: { readonly key: Digest; readonly max: number; readonly windowMs: number },
    signal?: AbortSignal,
  ): Promise<
    Done<{ readonly count: number; readonly resetAt: number }> | (Lost<'limit'> & { readonly retryAfterMs: number })
  >;
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
  attemptConsume(
    input: { readonly state: Digest; readonly binding: Digest; readonly provider: string },
    signal?: AbortSignal,
  ): Promise<
    Done<{ readonly nonce: string; readonly verifier: string; readonly returnPath: string }> | Lost<'gone' | 'binding'>
  >;
  expiredRemove(input: { readonly limit: number }, signal?: AbortSignal): Promise<Done<{ readonly removed: number }>>;
}
```

| Field               | Summary                                                                                                        |
| ------------------- | -------------------------------------------------------------------------------------------------------------- |
| `subjectEnsure`     | Creates the subject's fence, enabled at generation 1, when absent; returns it.                                 |
| `subjectRead`       | Reads the subject's fence without a lock; `null` when absent.                                                  |
| `subjectDisable`    | Disables the subject, raises its generation and deletes its sessions.                                          |
| `subjectEnable`     | Enables a subject disabled at exactly `generation`, raising the generation and deleting its sessions.          |
| `subjectInvalidate` | Raises the subject's generation and deletes its sessions; `enabled` is unchanged.                              |
| `sessionIssue`      | Issues a session for an enabled subject at exactly `generation`, deleting the `replaces` row whoever holds it. |
| `sessionRead`       | Reads one live session without a lock or cache; `null` when absent or expired.                                 |
| `sessionRenew`      | Extends a live session's idle expiry, never past its absolute expiry; never creates a row.                     |
| `sessionRotate`     | Replaces a live session of the subject with `next`, keeping its creation and absolute expiry.                  |
| `sessionRevoke`     | Deletes a session by digest; an absent row is `revoked: false`.                                                |
| `apiKeyIssue`       | Inserts a key for an enabled subject holding fewer than `max` unexpired keys, creating its fence when absent.  |
| `apiKeyRead`        | Reads an unexpired key with its subject's `enabled` in one statement; `null` when absent or expired.           |
| `apiKeyList`        | Lists at most `limit` unexpired keys of the subject, in no set order.                                          |
| `apiKeyRevoke`      | Deletes the key when its id and subject both match.                                                            |
| `limitCharge`       | Counts one charge in a fixed window, restarting an expired one; at `max` nothing changes.                      |
| `attemptCreate`     | Inserts one OIDC attempt that expires after `ttlMs`; a repeated `state` is a fault.                            |
| `attemptConsume`    | Spends a live attempt of this browser and provider; another binding or provider leaves the row as it was.      |
| `expiredRemove`     | Deletes at most `limit` expired rows of sessions, keys, limit windows and attempts; never a subject.           |

Source: `packages/auth/src/store/types.ts:139`

## SubjectRecord

A subject's session fence.

```ts
export interface SubjectRecord {
  readonly enabled: boolean;
  readonly generation: number;
  readonly now: number;
}
```

| Field        | Summary                                                                                              |
| ------------ | ---------------------------------------------------------------------------------------------------- |
| `enabled`    | Whether sessions and API keys of the subject are accepted.                                           |
| `generation` | Raised by every disable and revocation of all sessions; a session issued at an older one is refused. |
| `now`        | The read's judging time, in epoch milliseconds.                                                      |

Source: `packages/auth/src/store/types.ts:94`

## Unavailable

A store or limiter that could not answer; `unknown` means the change may have been applied.

```ts
export interface Unavailable {
  readonly kind: 'unavailable';
  readonly outcome: 'not_applied' | 'unknown';
}
```

| Field     | Summary                                                                                    |
| --------- | ------------------------------------------------------------------------------------------ |
| `kind`    | Marks the outcome.                                                                         |
| `outcome` | Whether nothing changed or the outcome is unknown; `unknown` is never reported as success. |

Source: `packages/auth/src/store/types.ts:10`

## StoreFailure

The error every store operation rejects with; `applied: 'unknown'` means the change may stand.

An unknown outcome is never reported as success and never repeated by auth.

```ts
export class StoreFailure extends Error {
  override readonly name = 'StoreFailure';
  readonly operation: string;
  readonly reason: 'unavailable' | 'fault' | 'aborted' | 'record';
  readonly applied: 'no' | 'unknown';
  readonly code: string | null;
  constructor(
    operation: string,
    reason: 'unavailable' | 'fault' | 'aborted' | 'record',
    applied: 'no' | 'unknown',
    code: string | null,
  );
}
```

```ts
new StoreFailure('sessionRead', 'unavailable', 'no', null);
```

Source: `packages/auth/src/store/store.ts:25`
