# @skeld/data/sqlite

## SqliteOptions

The options of `createSqliteDatabase`; an unknown key is refused with BootError `INVALID_OPTION`.

Each bound is a positive integer: a timer at most 2,147,483,647 ms, a byte bound at most 1 GiB.

```ts
export interface SqliteOptions {
  readonly path: string;
  readonly maxWaiters?: number;
  readonly acquireTimeoutMs?: number;
  readonly maxResultBytes?: number;
  readonly maxParameterBytes?: number;
}
```

| Field               | Summary                                                                                                              |
| ------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `path`              | The database file, created owner-only when missing, or `':memory:'`.                                                 |
| `maxWaiters`        | Callers waiting behind the one connection at most (default 50); one more is refused with `POOL_FULL`.                |
| `acquireTimeoutMs`  | Time to wait for the connection, in milliseconds (default 5,000); then `POOL_TIMEOUT`.                               |
| `maxResultBytes`    | Memory one result may hold, 288 bytes a row and 48 a value plus the values' own bytes (default 16 MiB, up to 1 GiB). |
| `maxParameterBytes` | UTF-8 bytes of a query's text plus its parameters, or of a script's text, at most (default 4 MiB, up to 1 GiB).      |

Source: `packages/data/src/sqlite/types.ts:8`

## createSqliteDatabase

Creates a SQLite database on a file, created owner-only when missing, or on `':memory:'`; it opens when its plugin runs.

Refuses an unknown or invalid option with BootError `INVALID_OPTION`; the boot fails when the file cannot be opened.

```ts
export function createSqliteDatabase(options: SqliteOptions): Database;
```

```ts
createSqliteDatabase({ path: ':memory:' });
```

Source: `packages/data/src/sqlite/sqlite.ts:20`
