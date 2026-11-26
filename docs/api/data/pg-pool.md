# @skeld/data/pg-pool

## toPgPool

Gives `@skeld/auth`'s PostgreSQL store a pool that runs on this database's own connections.

Throws BootError `INVALID_OPTION` for a SQLite database; a failed statement carries `code` and `severity`.

```ts
export function toPgPool(database: Database): StorePool;
```

```ts
toPgPool(createPostgresDatabase({ url: new Secret('postgres://app@db.example.com/app') })).options.max;
```

Source: `packages/data/src/pg-pool/pg-pool.ts:144`
