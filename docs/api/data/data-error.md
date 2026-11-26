# @skeld/data/data-error

## ConnectStage

The step a connection failed at.

```ts
export type ConnectStage = 'socket' | 'tls' | 'authentication' | 'startup';
```

Source: `packages/data/src/data-error/types.ts:23`

## DatabaseDetail

What the database sent about a failure, and the statement's text; read only through `exposeDetail`.

Its fields may hold object names and values, so it is never logged or sent whole.

```ts
export interface DatabaseDetail {
  readonly message: string | null;
  readonly detail: string | null;
  readonly hint: string | null;
  readonly where: string | null;
  readonly constraint: string | null;
  readonly table: string | null;
  readonly column: string | null;
  readonly sql: string | null;
}
```

| Field        | Summary                                    |
| ------------ | ------------------------------------------ |
| `message`    | The database's message.                    |
| `detail`     | The database's detail.                     |
| `hint`       | The database's hint.                       |
| `where`      | Where in the database the failure arose.   |
| `constraint` | The constraint that refused the statement. |
| `table`      | The table concerned.                       |
| `column`     | The column concerned.                      |
| `sql`        | The statement's text.                      |

Source: `packages/data/src/data-error/types.ts:29`

## DataErrorCode

Why database work failed; each code has one fixed message.

```ts
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
```

Source: `packages/data/src/data-error/types.ts:5`

## DataErrorInit

What a `DataError` is built with; every field is optional.

```ts
export interface DataErrorInit {
  readonly sqlState?: string;
  readonly sqliteCode?: number;
  readonly stage?: ConnectStage;
  readonly detail?: Partial<DatabaseDetail>;
  readonly cause?: unknown;
}
```

| Field        | Summary                                                                        |
| ------------ | ------------------------------------------------------------------------------ |
| `sqlState`   | The SQLSTATE; kept only when it is five characters of `[0-9A-Z]`, else `null`. |
| `sqliteCode` | SQLite's extended result code.                                                 |
| `stage`      | The step a connection failed at.                                               |
| `detail`     | What the database said; held where only `exposeDetail` reads it.               |
| `cause`      | The underlying failure.                                                        |

Source: `packages/data/src/data-error/types.ts:49`

## DataError

The error database work fails with; core writes it as 503 `Service unavailable` or the fixed 500.

Its message is fixed by its code; what the database said is read only through `exposeDetail`.

```ts
export class DataError extends HttpError {
  declare readonly code: DataErrorCode;
  declare readonly status: 503 | null;
  readonly sqlState: string | null;
  readonly sqliteCode: number | null;
  readonly stage: ConnectStage | null;
  constructor(code: DataErrorCode, init: DataErrorInit = {});
}
```

```ts
new DataError('POOL_TIMEOUT');
```

Source: `packages/data/src/data-error/data-error.ts:53`

## exposeDetail

Reads what the database said about a failure, and the statement's text; never log or send it whole.

Returns `null` when the database gave nothing.

```ts
export function exposeDetail(error: DataError): DatabaseDetail | null;
```

```ts
exposeDetail(new DataError('QUERY_FAILED'));
```

Source: `packages/data/src/data-error/data-error.ts:83`
