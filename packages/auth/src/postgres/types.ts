// Does:  Declares the options of the PostgreSQL store and the structural pool and client types it needs.
// Holds: The pool is typed by the members the store uses; auth imports no driver.

/** The options of `createPostgresStore`. */
export interface PostgresStoreOptions {
  /** The application's pool; auth never ends it. */
  readonly pool: PgPool;
  /** Most clients the store holds at once, from 1 to `pool.options.max` (default half of it, at least 1). */
  readonly maxClients?: number;
  /** Seconds between cleanup passes, from 1 to 3,600 (default 60). */
  readonly cleanupIntervalSeconds?: number;
}

/** The members of a `pg` Pool the store uses. */
export interface PgPool {
  /** Checks out a client. */
  connect(): Promise<PgClient>;
  /** Adds an error listener; the store adds and removes only its own. */
  on(event: 'error', listener: (error: Error) => void): unknown;
  /** Removes an error listener. */
  removeListener(event: 'error', listener: (error: Error) => void): unknown;
  /** The pool's options. */
  readonly options: {
    /** The pool's client limit. */
    readonly max: number;
  };
}

/** The members of a checked-out `pg` client the store uses. */
export interface PgClient {
  /** Runs one parameterized query. */
  query(
    text: string,
    values?: readonly unknown[],
  ): Promise<{ readonly rows: readonly unknown[]; readonly rowCount: number | null }>;
  /** Returns the client to the pool, or destroys it with `true`. */
  release(destroy?: boolean): void;
  /** Adds an error listener; the store adds one at checkout and removes only its own. */
  on(event: 'error', listener: (error: Error) => void): unknown;
  /** Removes an error listener. */
  removeListener(event: 'error', listener: (error: Error) => void): unknown;
}
