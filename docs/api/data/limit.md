# @skeld/data/limit

## LimitOptions

The options of `limitRoutes`.

```ts
export interface LimitOptions {
  readonly database: Database;
  readonly rules: { readonly [name: string]: LimitRule };
  readonly chargeTimeoutMs?: number;
}
```

| Field             | Summary                                                                                               |
| ----------------- | ----------------------------------------------------------------------------------------------------- |
| `database`        | The database that holds the counters; its plugin is registered before `limitRoutes`.                  |
| `rules`           | The rules by name: a lower-case letter, then letters, digits, `.`, `_` or `-`, 64 characters at most. |
| `chargeTimeoutMs` | Time one charge may take, in milliseconds, from 1 to 2,147,483,647 (default 1,000).                   |

Source: `packages/data/src/limit/types.ts:9`

## LimitRule

A limit shared by its routes: `max` requests per address in each window.

```ts
export interface LimitRule {
  readonly max: number;
  readonly windowSeconds: number;
  readonly routes: readonly Pick<RouteDefinition, 'method' | 'path'>[];
}
```

| Field           | Summary                                                                     |
| --------------- | --------------------------------------------------------------------------- |
| `max`           | Requests allowed in one window, from 1 to 1,000,000.                        |
| `windowSeconds` | The window's length in seconds, from 1 to 86,400.                           |
| `routes`        | The contract's routes the rule covers; a route belongs to one rule at most. |

Source: `packages/data/src/limit/types.ts:19`

## LimitScope

The scope members `limitRoutes` registers through; a server or a plugin's scope has them.

```ts
export interface LimitScope {
  addHook(name: 'onRequest', hook: OnRequestHook): void;
  register(plugin: (scope: BootScope) => Promise<void>, options?: RegisterOptions): void;
  onRoutes(callback: (routes: readonly RouteInfo[]) => void): void;
}
```

| Field      | Summary                              |
| ---------- | ------------------------------------ |
| `addHook`  | Adds the limiter's `onRequest` hook. |
| `register` | Adds the limiter's boot step.        |
| `onRoutes` | Adds the limiter's route check.      |

Source: `packages/data/src/limit/types.ts:32`

## limitRoutes

Limits the scope's routes per client address, counted in the database whose plugin is registered first.

Throws BootError `INVALID_OPTION`; `listen` rejects for a rule on an unserved route or a missing table.

```ts
export function limitRoutes(scope: LimitScope, options: LimitOptions): void;
```

See `examples/data/app.ts`.

Source: `packages/data/src/limit/limit.ts:73`

## installLimitTable

Creates the limiter's table and its index when they do not exist; run it once, at migration, never per request.

Rejects with `DataError`; on PostgreSQL it needs the right to create the schema `skeld_data`.

```ts
export async function installLimitTable(database: Database, owner: Owner): Promise<void>;
```

See `examples/data/app.ts`.

Source: `packages/data/src/limit/limit.ts:110`
