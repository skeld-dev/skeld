# @skeld/auth/sqlite

## SqliteStoreOptions

The options of `createSqliteStore`.

```ts
export interface SqliteStoreOptions {
  readonly path: string;
  readonly cleanupIntervalSeconds?: number;
}
```

| Field                    | Summary                                                       |
| ------------------------ | ------------------------------------------------------------- |
| `path`                   | The database file: an absolute path, or `':memory:'`.         |
| `cleanupIntervalSeconds` | Seconds between cleanup passes, from 1 to 3,600 (default 60). |

Source: `packages/auth/src/sqlite/types.ts:5`

## createSqliteStore

Creates the SQLite auth store; it opens nothing until `install` or `attach`.

Throws BootError `INVALID_OPTION` for an unknown key, a relative path or an interval outside 1 to 3,600 seconds.

```ts
export function createSqliteStore(options: SqliteStoreOptions): AuthStore;
```

```ts
createSqliteStore({ path: '/var/lib/app/auth.db' });
```

Source: `packages/auth/src/sqlite/sqlite.ts:183`
