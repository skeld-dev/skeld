// Does:  Declares a database, the owner its work is bound to, and the handles queries run through.
// Holds: Every query takes a Query, never a string, and a row read without a schema is typed unknown per column.

import type { Logger } from '@skeld/core/log';
import type { Infer, ObjectSchema } from '@skeld/core/schema';
import type { Scope } from '@skeld/core/server';
import type { Query } from '../sql/types.ts';

/** A database made by `createPostgresDatabase` or `createSqliteDatabase`; it connects when its plugin runs. */
export interface Database {
  /** The engine behind it. */
  readonly engine: 'postgres' | 'sqlite';
  /** Opens the pool at boot and closes it at shutdown; register it before any work that queries. */
  readonly plugin: (scope: Pick<Scope, 'signal' | 'log' | 'onClose' | 'closeTimeoutMs' | 'event'>) => Promise<void>;
  /**
   * Binds work to an owner, whose signal cancels it and whose logger takes its records.
   * @example db.for(request).query(sql`select 1`)
   */
  for(owner: Owner): BoundDatabase;
  /** Counts the pool's connections and waiters now. */
  stats(): PoolStats;
}

/** Anything database work is bound to: a request, a hook context, a scope or a gate's boot. */
export interface Owner {
  /** Cancels the owner's work when it aborts. */
  readonly signal: AbortSignal;
  /** Takes the records of the owner's work. */
  readonly log: Logger;
}

/** A handle that runs queries. */
export interface Queryable {
  /**
   * Runs a query and returns its rows, each column typed `unknown`.
   * @example await db.for(request).query(sql`select id from users`)
   */
  query(query: Query): Promise<readonly Row[]>;
  /**
   * Runs a query and returns its rows checked against a row schema, with the schema's keys only.
   * Rejects with `DataError` `ROW_INVALID`, and no rows, when any row fails its schema.
   * @example await db.for(request).query(sql`select id from users`, object({ id: integer() }))
   */
  query<S extends ObjectSchema>(query: Query, row: S): Promise<readonly Infer<S>[]>;
}

/** A database bound to an owner. */
export interface BoundDatabase extends Queryable {
  /**
   * Runs a callback in a transaction, committed when it resolves and rolled back when it rejects.
   * @example await db.for(request).transaction(async (tx) => tx.query(sql`select 1`))
   */
  transaction<T>(run: (tx: Queryable) => Promise<T>, options?: TransactionOptions): Promise<T>;
  /**
   * Holds one connection for the callback's duration.
   * @example await db.for(scope).reserve(async (connection) => connection.script('select 1'))
   */
  reserve<T>(run: (connection: ReservedConnection) => Promise<T>): Promise<T>;
}

/** One connection held for a callback. */
export interface ReservedConnection extends Queryable {
  /**
   * Runs a callback in a transaction on this connection.
   * @example await connection.transaction(async (tx) => tx.query(sql`select 1`))
   */
  transaction<T>(run: (tx: Queryable) => Promise<T>, options?: TransactionOptions): Promise<T>;
  /**
   * Runs text of several statements with no parameters; never pass it a request's value.
   * Text over `maxParameterBytes` is refused with `DataError` `PARAMETERS_TOO_LARGE`.
   * @example await connection.script('create table t (id int8); create index on t (id)')
   */
  script(text: string): Promise<void>;
}

/** How a transaction runs. */
export interface TransactionOptions {
  /** The isolation level (default the database's own). */
  readonly isolation?: 'read committed' | 'repeatable read' | 'serializable';
  /** Refuses writes inside the transaction (default `false`). */
  readonly readOnly?: boolean;
}

/** A row read without a schema: frozen, with a `null` prototype. */
export interface Row {
  readonly [column: string]: unknown;
}

/** The pool's counts at one moment. */
export interface PoolStats {
  /** Connections open. */
  readonly open: number;
  /** Connections held by work. */
  readonly checkedOut: number;
  /** Callers waiting for a connection. */
  readonly waiting: number;
}
