// Does:  Declares the options of a SQLite database: its file and the bounds that apply to one connection.
// Holds: No option sets a connection count or a connect or lifetime timer: SQLite has one connection.

/**
 * The options of `createSqliteDatabase`; an unknown key is refused with BootError `INVALID_OPTION`.
 * Each bound is a positive integer: a timer at most 2,147,483,647 ms, a byte bound at most 1 GiB.
 */
export interface SqliteOptions {
  /** The database file, created owner-only when missing, or `':memory:'`. */
  readonly path: string;
  /** Callers waiting behind the one connection at most (default 50); one more is refused with `POOL_FULL`. */
  readonly maxWaiters?: number;
  /** Time to wait for the connection, in milliseconds (default 5,000); then `POOL_TIMEOUT`. */
  readonly acquireTimeoutMs?: number;
  /**
   * Memory one result may hold, 288 bytes a row and 48 a value plus the values' own bytes (default 16 MiB, up to 1 GiB).
   * Over it, `RESULT_TOO_LARGE`.
   */
  readonly maxResultBytes?: number;
  /**
   * UTF-8 bytes of a query's text plus its parameters, or of a script's text, at most (default 4 MiB, up to 1 GiB).
   * Over it, `PARAMETERS_TOO_LARGE` is raised and nothing is sent.
   */
  readonly maxParameterBytes?: number;
}
