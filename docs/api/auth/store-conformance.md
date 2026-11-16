# @skeld/auth/store-conformance

## ConformanceReport

The outcome of a conformance run; each case name is `<operation>.<case>`.

```ts
export interface ConformanceReport {
  readonly passed: readonly string[];
  readonly failed: readonly { readonly name: string; readonly detail: string }[];
  readonly skipped: readonly string[];
}
```

| Field     | Summary                                        |
| --------- | ---------------------------------------------- |
| `passed`  | The cases that passed.                         |
| `failed`  | The cases that failed, with what was observed. |
| `skipped` | The cases that could not run on this target.   |

Source: `packages/auth/src/store-conformance/types.ts:25`

## ConformanceTarget

One fresh store for one case, with a way to hold a row's lock from a second connection.

```ts
export interface ConformanceTarget {
  readonly store: AuthStore;
  readonly holdLock?: (
    table: 'subjects' | 'sessions' | 'api_keys' | 'limit_windows' | 'oidc_attempts',
    key: string | Digest,
    ms: number,
  ) => Promise<void>;
  readonly lockScope?: 'row' | 'database';
  readonly writeVersions?: (versions: readonly number[]) => Promise<void>;
  readonly dispose: () => Promise<void>;
}
```

| Field           | Summary                                                                                                         |
| --------------- | --------------------------------------------------------------------------------------------------------------- |
| `store`         | The store under test.                                                                                           |
| `holdLock`      | Takes the named row's lock from a second connection and holds it for `ms` milliseconds.                         |
| `lockScope`     | What a `holdLock` call blocks: the named row or the whole database; absent reads as `'database'`.               |
| `writeVersions` | Replaces the rows of `schema_version` with one row per given version; without it the version cases are skipped. |
| `dispose`       | Releases the store and everything the target made.                                                              |

Source: `packages/auth/src/store-conformance/types.ts:7`

## runStoreConformance

Runs the store contract's cases against fresh stores from `make`, each uninstalled, and reports every case.

Never throws for a failed case; a case needing a hook the target lacks is skipped, never passed.

```ts
export async function runStoreConformance(make: () => Promise<ConformanceTarget>): Promise<ConformanceReport>;
```

```ts
await runStoreConformance(async () => {
  const store = createSqliteStore({ path: ':memory:' });
  return { store, dispose: () => store.close() };
});
```

Source: `packages/auth/src/store-conformance/store-conformance.ts:16`
