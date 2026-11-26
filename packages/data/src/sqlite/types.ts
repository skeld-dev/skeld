// Does:  Declares the options of a SQLite database: its file and the bounds that apply to one connection.
// Holds: No option sets a connection count or a connect or lifetime timer: SQLite has one connection.

/**
 * The options of `createSqliteDatabase`; an unknown key is refused with BootError `INVALID_OPTION`.
 * Each bound is a positive integer, a timer at most 2,147,483,647.
 */
export interface SqliteOptions {
  /** The database file, created owner-only when missing, or `':memory:'`. */
  readonly path: string;
  /** Callers waiting at most (default 50); one more is refused with `POOL_FULL`. */
  readonly maxWaiters?: number;
  /** Time to wait for the connection, in milliseconds (default 5,000); then `POOL_TIMEOUT`. */
  readonly acquireTimeoutMs?: number;
  /** Bytes of one result at most (default 16 MiB); then `RESULT_TOO_LARGE`. */
  readonly maxResultBytes?: number;
  /** Bytes of a statement's parameters or a script's text at most (default 4 MiB); then `PARAMETERS_TOO_LARGE`. */
  readonly maxParameterBytes?: number;
}
