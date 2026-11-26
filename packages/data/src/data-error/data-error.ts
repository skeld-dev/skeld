// Does:  Defines DataError, the one error database work fails with, and exposeDetail, the reader of its detail.
// Holds: Status and message come from the code alone; the detail is no property of the error, so no serialiser sees it.

import { HttpError } from '@skeld/core/http-error';
import type { ConnectStage, DatabaseDetail, DataErrorCode, DataErrorInit } from './types.ts';

export type { ConnectStage, DatabaseDetail, DataErrorCode, DataErrorInit } from './types.ts';

const UNAVAILABLE = 'Service unavailable';

const FIXED: { readonly [C in DataErrorCode]: { readonly status: 503 | null; readonly message: string } } = {
  POOL_FULL: { status: 503, message: UNAVAILABLE },
  POOL_TIMEOUT: { status: 503, message: UNAVAILABLE },
  POOL_CLOSED: { status: 503, message: UNAVAILABLE },
  CONNECT_FAILED: { status: 503, message: UNAVAILABLE },
  CONNECTION_LOST: { status: 503, message: UNAVAILABLE },
  PROTOCOL_VIOLATION: { status: null, message: 'Database protocol violation' },
  RESULT_TOO_LARGE: { status: null, message: 'Database result over its bound' },
  PARAMETERS_TOO_LARGE: { status: null, message: 'Query parameters over their bound' },
  INVALID_QUERY: { status: null, message: 'Query refused' },
  QUERY_FAILED: { status: null, message: 'Database statement failed' },
  ROW_INVALID: { status: null, message: 'Row refused by its schema' },
  TRANSACTION_FAILED: { status: null, message: 'Transaction already failed' },
  HANDLE_CLOSED: { status: null, message: 'Database handle used after its callback settled' },
  COMMIT_UNKNOWN: { status: null, message: 'Transaction outcome unknown' },
  CANCELLED: { status: null, message: 'Database work cancelled' },
};

const SQLSTATE = /^[0-9A-Z]{5}$/;

// Why: A WeakMap entry is invisible to JSON.stringify and util.inspect, which a field of the error is not.
const details = new WeakMap<DataError, DatabaseDetail>();

function completeDetail(given: Partial<DatabaseDetail>): DatabaseDetail | null {
  const detail: DatabaseDetail = Object.freeze({
    message: given.message ?? null,
    detail: given.detail ?? null,
    hint: given.hint ?? null,
    where: given.where ?? null,
    constraint: given.constraint ?? null,
    table: given.table ?? null,
    column: given.column ?? null,
    sql: given.sql ?? null,
  });
  return Object.values(detail).some((value) => value !== null) ? detail : null;
}

/**
 * The error database work fails with; core writes it as 503 `Service unavailable` or the fixed 500.
 * Its message is fixed by its code; what the database said is read only through `exposeDetail`.
 * @example new DataError('POOL_TIMEOUT')
 */
export class DataError extends HttpError {
  /** Why the work failed. */
  declare readonly code: DataErrorCode;
  /** 503 for a pool or connection failure, else `null` (written as 500). */
  declare readonly status: 503 | null;
  /** The SQLSTATE the server sent, five characters of `[0-9A-Z]`. */
  readonly sqlState: string | null;
  /** SQLite's extended result code. */
  readonly sqliteCode: number | null;
  /** The step a connection failed at. */
  readonly stage: ConnectStage | null;

  constructor(code: DataErrorCode, init: DataErrorInit = {}) {
    const fixed = FIXED[code];
    super(fixed.status, code, fixed.message, 'cause' in init ? { cause: init.cause } : undefined);
    this.sqlState = init.sqlState !== undefined && SQLSTATE.test(init.sqlState) ? init.sqlState : null;
    this.sqliteCode = init.sqliteCode ?? null;
    this.stage = init.stage ?? null;
    const detail = init.detail === undefined ? null : completeDetail(init.detail);
    if (detail !== null) {
      details.set(this, detail);
    }
  }
}

/**
 * Reads what the database said about a failure, and the statement's text; never log or send it whole.
 * Returns `null` when the database gave nothing.
 * @example exposeDetail(new DataError('QUERY_FAILED'))
 */
export function exposeDetail(error: DataError): DatabaseDetail | null {
  return details.get(error) ?? null;
}
