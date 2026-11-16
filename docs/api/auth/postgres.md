# @skeld/auth/postgres

## PgClient

The members of a checked-out `pg` client the store uses.

```ts
export interface PgClient {
  query(
    text: string,
    values?: readonly unknown[],
  ): Promise<{ readonly rows: readonly unknown[]; readonly rowCount: number | null }>;
  release(destroy?: boolean): void;
  on(event: 'error', listener: (error: Error) => void): unknown;
  removeListener(event: 'error', listener: (error: Error) => void): unknown;
}
```

| Field            | Summary                                                                          |
| ---------------- | -------------------------------------------------------------------------------- |
| `query`          | Runs one parameterized query.                                                    |
| `release`        | Returns the client to the pool, or destroys it with `true`.                      |
| `on`             | Adds an error listener; the store adds one at checkout and removes only its own. |
| `removeListener` | Removes an error listener.                                                       |

Source: `packages/auth/src/postgres/types.ts:30`

## PgPool

The members of a `pg` Pool the store uses.

```ts
export interface PgPool {
  connect(): Promise<PgClient>;
  on(event: 'error', listener: (error: Error) => void): unknown;
  removeListener(event: 'error', listener: (error: Error) => void): unknown;
  readonly options: {
    /** The pool's client limit. */
    readonly max: number;
  };
}
```

| Field            | Summary                                                          |
| ---------------- | ---------------------------------------------------------------- |
| `connect`        | Checks out a client.                                             |
| `on`             | Adds an error listener; the store adds and removes only its own. |
| `removeListener` | Removes an error listener.                                       |
| `options`        | The pool's options.                                              |

Source: `packages/auth/src/postgres/types.ts:15`

## PostgresStoreOptions

The options of `createPostgresStore`.

```ts
export interface PostgresStoreOptions {
  readonly pool: PgPool;
  readonly maxClients?: number;
  readonly cleanupIntervalSeconds?: number;
}
```

| Field                    | Summary                                                                                              |
| ------------------------ | ---------------------------------------------------------------------------------------------------- |
| `pool`                   | The application's pool; auth never ends it.                                                          |
| `maxClients`             | Most clients the store holds at once, from 1 to `pool.options.max` (default half of it, at least 1). |
| `cleanupIntervalSeconds` | Seconds between cleanup passes, from 1 to 3,600 (default 60).                                        |

Source: `packages/auth/src/postgres/types.ts:5`

## createPostgresStore

Creates the auth store over the application's pg Pool; it queries nothing until `install` or `attach`.

Throws BootError `INVALID_OPTION` naming a bad option; the store never ends the Pool.

```ts
export function createPostgresStore(options: PostgresStoreOptions): AuthStore;
```

See `examples/auth/postgres-store.ts`.

Source: `packages/auth/src/postgres/postgres.ts:103`
