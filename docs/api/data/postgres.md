# @skeld/data/postgres

## PostgresOptions

The options of `createPostgresDatabase`; an unknown key is refused with BootError `INVALID_OPTION`.

Each bound is a positive integer: a timer at most 2,147,483,647 ms, a byte bound at most 1 GiB.

```ts
export interface PostgresOptions {
  readonly url: Secret<string>;
  readonly tls?: {
    /** The root certificates trusted for the server, in PEM (default Node's bundled roots). */
    readonly ca?: string | readonly string[];
    /** Whether channel binding is used when the server offers it or required (default `'when-offered'`). */
    readonly channelBinding?: 'when-offered' | 'required';
  };
  readonly insecure?: 'plaintext';
  readonly maxConnections?: number;
  readonly maxWaiters?: number;
  readonly acquireTimeoutMs?: number;
  readonly connectTimeoutMs?: number;
  readonly maxLifetimeMs?: number;
  readonly maxResultBytes?: number;
  readonly maxParameterBytes?: number;
}
```

| Field               | Summary                                                                                                               |
| ------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `url`               | `postgres://user[:password]@host[:port][/database][?name=value]`; TLS is verified unless `insecure` is `'plaintext'`. |
| `tls`               | How TLS is verified and whether channel binding is required.                                                          |
| `insecure`          | Connects without TLS and writes `data.insecure` at boot; a boot error beside a URL `sslmode`.                         |
| `maxConnections`    | Connections open at most (default 10); callers wait beyond it.                                                        |
| `maxWaiters`        | Callers waiting beyond `maxConnections` at most (default 50); one more is refused with `POOL_FULL`.                   |
| `acquireTimeoutMs`  | Time to wait for a connection, queueing and connecting, in milliseconds (default 5,000); then `POOL_TIMEOUT`.         |
| `connectTimeoutMs`  | Time to open one connection, in milliseconds (default 5,000); then `CONNECT_FAILED`.                                  |
| `maxLifetimeMs`     | A connection's lifetime, in milliseconds, plus 0 to 20 % (default 1,800,000); it closes at its next return.           |
| `maxResultBytes`    | Memory one result may hold, 288 bytes a row and 48 a value plus the values' own bytes (default 16 MiB, up to 1 GiB).  |
| `maxParameterBytes` | UTF-8 bytes of a query's text plus its parameters, or of a script's text, at most (default 4 MiB, up to 1 GiB).       |

Source: `packages/data/src/postgres/types.ts:10`

## createPostgresDatabase

Creates a PostgreSQL database; it connects when its plugin runs, over verified TLS unless `insecure` says otherwise.

Refuses an unknown or invalid option with BootError `INVALID_OPTION`; the boot fails when the first connect does.

```ts
export function createPostgresDatabase(options: PostgresOptions): Database;
```

```ts
createPostgresDatabase({ url: new Secret('postgres://app@db.internal/app') });
```

Source: `packages/data/src/postgres/postgres.ts:21`
