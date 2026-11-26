# @skeld/data/database

## BoundDatabase

A database bound to an owner.

```ts
export interface BoundDatabase extends Queryable {
  transaction<T>(run: (tx: Queryable) => Promise<T>, options?: TransactionOptions): Promise<T>;
  reserve<T>(run: (connection: ReservedConnection) => Promise<T>): Promise<T>;
}
```

| Field         | Summary                                                                                       |
| ------------- | --------------------------------------------------------------------------------------------- |
| `transaction` | Runs a callback in a transaction, committed when it resolves and rolled back when it rejects. |
| `reserve`     | Holds one connection for the callback's duration.                                             |

Source: `packages/data/src/database/types.ts:41`

## Database

A database made by `createPostgresDatabase` or `createSqliteDatabase`; it connects when its plugin runs.

```ts
export interface Database {
  readonly engine: 'postgres' | 'sqlite';
  readonly plugin: (scope: Pick<Scope, 'signal' | 'log' | 'onClose' | 'closeTimeoutMs' | 'event'>) => Promise<void>;
  for(owner: Owner): BoundDatabase;
  stats(): PoolStats;
}
```

| Field    | Summary                                                                                     |
| -------- | ------------------------------------------------------------------------------------------- |
| `engine` | The engine behind it.                                                                       |
| `plugin` | Opens the pool at boot and closes it at shutdown; register it before any work that queries. |
| `for`    | Binds work to an owner, whose signal cancels it and whose logger takes its records.         |
| `stats`  | Counts the pool's connections and waiters now.                                              |

Source: `packages/data/src/database/types.ts:10`

## Owner

Anything database work is bound to: a request, a hook context, a scope or a gate's boot.

```ts
export interface Owner {
  readonly signal: AbortSignal;
  readonly log: Logger;
}
```

| Field    | Summary                                  |
| -------- | ---------------------------------------- |
| `signal` | Cancels the owner's work when it aborts. |
| `log`    | Takes the records of the owner's work.   |

Source: `packages/data/src/database/types.ts:22`

## PoolStats

The pool's counts at one moment.

```ts
export interface PoolStats {
  readonly open: number;
  readonly checkedOut: number;
  readonly waiting: number;
}
```

| Field        | Summary                                                                             |
| ------------ | ----------------------------------------------------------------------------------- |
| `open`       | Connections open.                                                                   |
| `checkedOut` | Connections held by work.                                                           |
| `waiting`    | Callers waiting for a connection, those whose connection is still opening included. |

Source: `packages/data/src/database/types.ts:73`

## Queryable

A handle that runs queries.

```ts
export interface Queryable {
  query(query: Query): Promise<readonly Row[]>;
  query<S extends ObjectSchema>(query: Query, row: S): Promise<readonly Infer<S>[]>;
}
```

| Field   | Summary                                                         |
| ------- | --------------------------------------------------------------- |
| `query` | Runs a query and returns its rows, each column typed `unknown`. |

Source: `packages/data/src/database/types.ts:30`

## ReservedConnection

One connection held for a callback.

```ts
export interface ReservedConnection extends Queryable {
  transaction<T>(run: (tx: Queryable) => Promise<T>, options?: TransactionOptions): Promise<T>;
  script(text: string): Promise<void>;
}
```

| Field         | Summary                                                                              |
| ------------- | ------------------------------------------------------------------------------------ |
| `transaction` | Runs a callback in a transaction on this connection.                                 |
| `script`      | Runs text of several statements with no parameters; never pass it a request's value. |

Source: `packages/data/src/database/types.ts:49`

## Row

A row read without a schema: frozen, with a `null` prototype.

```ts
export interface Row {
  readonly [column: string]: unknown;
}
```

Source: `packages/data/src/database/types.ts:68`

## TransactionOptions

How a transaction runs.

```ts
export interface TransactionOptions {
  readonly isolation?: 'read committed' | 'repeatable read' | 'serializable';
  readonly readOnly?: boolean;
}
```

| Field       | Summary                                                  |
| ----------- | -------------------------------------------------------- |
| `isolation` | The isolation level (default the database's own).        |
| `readOnly`  | Refuses writes inside the transaction (default `false`). |

Source: `packages/data/src/database/types.ts:60`
