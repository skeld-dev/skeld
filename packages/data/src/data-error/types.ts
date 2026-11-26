// Does:  Declares the codes of a DataError, where a connect failed, and what the database said about a failure.
// Holds: The code list is closed and in a fixed order; adding a code is a change to the contract.

/** Why database work failed; each code has one fixed message. */
export type DataErrorCode =
  | 'POOL_FULL'
  | 'POOL_TIMEOUT'
  | 'POOL_CLOSED'
  | 'CONNECT_FAILED'
  | 'CONNECTION_LOST'
  | 'PROTOCOL_VIOLATION'
  | 'RESULT_TOO_LARGE'
  | 'PARAMETERS_TOO_LARGE'
  | 'INVALID_QUERY'
  | 'QUERY_FAILED'
  | 'ROW_INVALID'
  | 'TRANSACTION_FAILED'
  | 'HANDLE_CLOSED'
  | 'COMMIT_UNKNOWN'
  | 'CANCELLED';

/** The step a connection failed at. */
export type ConnectStage = 'socket' | 'tls' | 'authentication' | 'startup';

/**
 * What the database sent about a failure, and the statement's text; read only through `exposeDetail`.
 * Its fields may hold object names and values, so it is never logged or sent whole.
 */
export interface DatabaseDetail {
  /** The database's message. */
  readonly message: string | null;
  /** The database's detail. */
  readonly detail: string | null;
  /** The database's hint. */
  readonly hint: string | null;
  /** Where in the database the failure arose. */
  readonly where: string | null;
  /** The constraint that refused the statement. */
  readonly constraint: string | null;
  /** The table concerned. */
  readonly table: string | null;
  /** The column concerned. */
  readonly column: string | null;
  /** The statement's text. */
  readonly sql: string | null;
}

/** What a `DataError` is built with; every field is optional. */
export interface DataErrorInit {
  /** The SQLSTATE; kept only when it is five characters of `[0-9A-Z]`, else `null`. */
  readonly sqlState?: string;
  /** SQLite's extended result code. */
  readonly sqliteCode?: number;
  /** The step a connection failed at. */
  readonly stage?: ConnectStage;
  /** What the database said; held where only `exposeDetail` reads it. */
  readonly detail?: Partial<DatabaseDetail>;
  /** The underlying failure. */
  readonly cause?: unknown;
}
