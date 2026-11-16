// Does:  Declares the options of the SQLite store.
// Holds: The store opens only the one path it is given.

/** The options of `createSqliteStore`. */
export interface SqliteStoreOptions {
  /** The database file: an absolute path, or `':memory:'`. */
  readonly path: string;
  /** Seconds between cleanup passes, from 1 to 3,600 (default 60). */
  readonly cleanupIntervalSeconds?: number;
}
