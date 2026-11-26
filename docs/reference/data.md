# Data behavior reference

`@skeld/data` connects a skeld service to PostgreSQL or SQLite: queries through the `sql` tagged template, rows checked against a core schema or typed `unknown`, transactions and reserved connections as callbacks, a rate limiter whose counts live in the database, and a pool shape for `@skeld/auth`'s PostgreSQL store.

Install it with `npm install @skeld/data`. It needs Node 26.12 or later (`engines`: `node >=26.12.0`) and depends only on `@skeld/core`. For a guided introduction, read [Store data in PostgreSQL or SQLite](../guides/data.md). Exact signatures are in the [API reference](../api/README.md#data-api).

## Subpaths

The package has no root export.

| Import                     | Exports                                                                                                                     |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `@skeld/data/sql`          | `sql`, `identifier`; the types `Query`, `Parameter`                                                                         |
| `@skeld/data/postgres`     | `createPostgresDatabase`; the type `PostgresOptions`                                                                        |
| `@skeld/data/sqlite`       | `createSqliteDatabase`; the type `SqliteOptions`                                                                            |
| `@skeld/data/database`     | the types `Database`, `Owner`, `BoundDatabase`, `Queryable`, `ReservedConnection`, `TransactionOptions`, `Row`, `PoolStats` |
| `@skeld/data/data-error`   | `DataError`, `exposeDetail`; the types `DataErrorCode`, `DataErrorInit`, `DatabaseDetail`, `ConnectStage`                   |
| `@skeld/data/pg-pool`      | `toPgPool`                                                                                                                  |
| `@skeld/data/limit`        | `limitRoutes`, `installLimitTable`; the types `LimitOptions`, `LimitRule`, `LimitScope`                                     |
| `@skeld/data/package.json` | the manifest                                                                                                                |

The database's plugin and the limiter use three `Scope` members of core: `closeTimeoutMs`, `event` and `onRoutes` (see [Scope](../api/core/server.md#scope)).

## Options

Both factories check their options when called and open nothing. An unknown key, or a value outside its range, throws `BootError` `INVALID_OPTION` with a message that names the option and holds no value from the URL. Each bound is a positive integer; a timer is at most 2,147,483,647 ms and a byte bound at most 1,073,741,824 (1 GiB).

| Option              | PostgreSQL | SQLite | Default                                  | At the bound                                                                                          |
| ------------------- | ---------- | ------ | ---------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `maxConnections`    | yes        | no     | 10                                       | callers wait; SQLite always has one connection                                                        |
| `maxWaiters`        | yes        | yes    | 50                                       | callers beyond those the pool can open a connection for; one more is refused at once with `POOL_FULL` |
| `acquireTimeoutMs`  | yes        | yes    | 5,000                                    | `POOL_TIMEOUT`; covers waiting in the queue and opening a connection                                  |
| `connectTimeoutMs`  | yes        | no     | 5,000                                    | `CONNECT_FAILED` with reason `timeout`; covers every step of one connect                              |
| `maxLifetimeMs`     | yes        | no     | 1,800,000, plus 0 to 20 % per connection | the connection closes at its next return to the pool                                                  |
| `maxResultBytes`    | yes        | yes    | 16 MiB                                   | `RESULT_TOO_LARGE`, no rows; also the largest single message PostgreSQL may send                      |
| `maxParameterBytes` | yes        | yes    | 4 MiB                                    | `PARAMETERS_TOO_LARGE`, nothing sent                                                                  |

`maxParameterBytes` counts a statement's text plus its parameters, or a script's text, on both engines. A statement has at most 65,535 parameters on PostgreSQL; on SQLite, at most what SQLite allows. More is `PARAMETERS_TOO_LARGE`.

`maxResultBytes` bounds the memory one result may hold, counted the same way on both databases: 288 bytes for each row and 48 bytes for each value, plus the value's own bytes (on PostgreSQL its text as the server sends it; on SQLite the bytes of the text or blob, 8 for a number and 0 for NULL). The default 16 MiB holds about 26,000 rows of six short columns, or about 49,000 rows of one integer. A route that reads more raises the bound for its database or reads in pages.

`PostgresOptions` also has:

| Option               | Value                                                                                                                                                                                                                                                                                      |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `url`                | required; a `Secret<string>` holding the URL below                                                                                                                                                                                                                                         |
| `tls.ca`             | PEM text, or an array of them: the only roots trusted for the server's certificate (default Node's bundled roots)                                                                                                                                                                          |
| `tls.channelBinding` | `'when-offered'` (default) or `'required'`                                                                                                                                                                                                                                                 |
| `insecure`           | absent (default), or `'plaintext'`: no TLS, for a database on the same machine or behind a local proxy that does the TLS; writes `data.insecure` at `warn` each boot. No option turns certificate checking off: pass a private or self-signed certificate, or its authority's, as `tls.ca` |

`SqliteOptions` has `path`: a file path, or `':memory:'`. An empty path is refused.

## PostgreSQL URL

`postgres://user[:password]@host[:port][/database][?name=value&...]`; the scheme is `postgres` or `postgresql`.

| Part               | Rule                                                                                                                          |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| user               | required                                                                                                                      |
| password           | optional; without one, only a server that asks for no password is accepted                                                    |
| host               | one DNS name, IPv4 address or bracketed IPv6 address; several hosts and a socket path are refused                             |
| port               | 1 to 65,535 (default 5432)                                                                                                    |
| database           | optional; the server uses the user name when it is absent                                                                     |
| `sslmode`          | `require`, `verify-ca` or `verify-full`; each, and no `sslmode`, means TLS with the certificate and the host name verified    |
| `channel_binding`  | `prefer` (default) or `require`; `require`, or `tls.channelBinding: 'required'`, refuses a connection without channel binding |
| `application_name` | sent to the server at startup                                                                                                 |

Parts are percent-decoded as UTF-8. Refused at creation: any other parameter, a parameter given twice or without a value, any other `sslmode` or `channel_binding` value, a fragment, a malformed percent escape, invalid UTF-8 or a NUL after decoding, `insecure` beside `sslmode`, `insecure: 'plaintext'` while channel binding is required, and a startup message over the server's limit of 10,000 bytes. A refusal never repeats text from the URL. It names the part, or a parameter PostgreSQL's own client defines (`Invalid option url: parameter sslrootcert is not supported`). Any other parameter is given by its position in the query, counted from 1, because unencoded text from a password can land there: `Invalid option url: parameter 2 of the query is not supported: use only sslmode, channel_binding or application_name, and percent-encode special characters in the password`. No `PG*` environment variable, `.pgpass` or service file is read.

## Connecting to PostgreSQL

One `connectTimeoutMs` deadline covers every step, and nothing is retried.

| Step           | Behavior                                                                                                                                                                                                                                                                                                              |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Socket         | TCP through `node:net` with Node's own address lookup; Nagle's algorithm off; keepalive after 60 s idle                                                                                                                                                                                                               |
| TLS request    | Sent first on every connection, the cancel connection included. Exactly one byte `S` continues; `N`, any other answer, or further bytes in the same write end the attempt before anything else is sent                                                                                                                |
| TLS handshake  | Certificate and host name verified (the host is the SNI name when it is a name); roots are `tls.ca` when given, else Node's; TLS 1.2 or later; ALPN `postgresql` offered, another protocol refused. `NODE_TLS_REJECT_UNAUTHORIZED=0` changes none of this                                                             |
| Startup        | Protocol 3.2, with `user`, `database` when named, `client_encoding=UTF8`, `DateStyle=ISO`, `TimeZone=UTC` and `application_name` when given. A server, or a pooler, that answers it supports only 3.0 is spoken to in 3.0; any other answer is refused                                                                |
| Authentication | SCRAM-SHA-256 only, as `SCRAM-SHA-256-PLUS` (channel binding) when the server offers it and the certificate's hash is known; the iteration count must be 1 to 1,000,000; a server signature that does not verify is refused. A request for a cleartext password, MD5 or any other method is refused with nothing sent |
| Ready          | The server must confirm `client_encoding` `UTF8` and send a cancel key, of 4 bytes on 3.0 and 4 to 256 on 3.2                                                                                                                                                                                                         |

Node reports no hash for RSA-PSS and Ed25519 certificates, so channel binding cannot be used with them: such a connection signs in with plain SCRAM under verified TLS, or is refused when binding is required. Statements use the extended protocol with the unnamed statement only, and results arrive as text. A message that breaks the protocol closes the connection.

## Boot failures

The first connection is opened while the database's plugin runs at `listen`. When it fails, `listen` rejects with `BootError` `PLUGIN_FAILED` and the message `Plugin <name> failed: Database connection failed at <stage> (<reason>): <remedy>`, where `<name>` is the `name` given to `register`, or `postgresDatabase` or `sqliteDatabase` when none is given. On SQLite the part after the plugin's name is `Database connection failed (open): the database file could not be opened; check the path and its permissions`. A `data.connect.failed` record is written with the stage and the reason.

| Stage            | Reason        | Remedy in the message                                                                                           |
| ---------------- | ------------- | --------------------------------------------------------------------------------------------------------------- |
| `socket`         | `resolve`     | the host name did not resolve; check the URL's host                                                             |
| `socket`         | `connect`     | nothing accepted the connection; check the host, the port and that the server is running                        |
| `tls`            | `declined`    | the server declined TLS; enable TLS on the server                                                               |
| `tls`            | `answer`      | the answer to the TLS request was not PostgreSQL's; check that the port is a PostgreSQL server                  |
| `tls`            | `certificate` | the server's certificate did not verify; supply the provider's root certificate in tls.ca                       |
| `tls`            | `hostname`    | the certificate does not name the URL's host; use the host name the certificate was issued for                  |
| `tls`            | `handshake`   | the TLS handshake failed; check the server's TLS versions                                                       |
| `authentication` | `method`      | the server asked for a sign-in method other than SCRAM-SHA-256; set the server and pg_hba.conf to scram-sha-256 |
| `authentication` | `no-password` | the server asked for a password and the URL has none                                                            |
| `authentication` | `not-asked`   | the server asked for no password although the URL has one; check pg_hba.conf                                    |
| `authentication` | `binding`     | channel binding is required and could not be used                                                               |
| `authentication` | `exchange`    | the SCRAM exchange was malformed                                                                                |
| `authentication` | `iterations`  | the server's SCRAM iteration count is outside 1 to 1,000,000                                                    |
| `authentication` | `signature`   | the server did not prove that it knows the password                                                             |
| `authentication` | `rejected`    | the server rejected the user or the password                                                                    |
| `startup`        | `rejected`    | the server refused the startup; check the database name and the user                                            |
| `startup`        | `version`     | the server offered a protocol version other than 3.2 or 3.0                                                     |
| `startup`        | `encoding`    | the server did not confirm client_encoding UTF8                                                                 |
| `startup`        | `no-key`      | the server sent no cancel key                                                                                   |
| any              | `timeout`     | the step did not finish within connectTimeoutMs                                                                 |
| any              | `closed`      | the server closed the connection                                                                                |
| any              | `violation`   | the server broke the protocol                                                                                   |

A wrong address, certificate or password therefore stops the boot, and core's rollback closes what was opened. After boot, a failed connect rejects the oldest waiting call with `CONNECT_FAILED` at once; there is no retry or backoff.

## Errors

Every failure is a `DataError`, a subclass of core's `HttpError`, with `code`, `status` (`503` or `null`), `sqlState` (five characters of `[0-9A-Z]`, else `null`), `sqliteCode` (SQLite's extended result code) and `stage` (for a connect). The message is fixed by the code. Core answers an uncaught one with 503 `Service unavailable` and the code, or the fixed 500 `INTERNAL` when `status` is `null`. What the database sent and the statement's text are read only with `exposeDetail(error)`, which returns `{ message, detail, hint, where, constraint, table, column, sql }`, each a string or `null`, or `null` when there is nothing; `JSON.stringify` and `util.inspect` of the error show none of it.

| Code                   | Status | Message                                         | Record                                                          | When                                                                                                                                                                                                                                                                                                                         |
| ---------------------- | ------ | ----------------------------------------------- | --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POOL_FULL`            | 503    | Service unavailable                             | none                                                            | `maxWaiters` callers are already waiting beyond those the pool can open a connection for                                                                                                                                                                                                                                     |
| `POOL_TIMEOUT`         | 503    | Service unavailable                             | none                                                            | no connection within `acquireTimeoutMs`                                                                                                                                                                                                                                                                                      |
| `POOL_CLOSED`          | 503    | Service unavailable                             | none                                                            | before the database's plugin has run, or once shutdown has begun                                                                                                                                                                                                                                                             |
| `CONNECT_FAILED`       | 503    | Service unavailable                             | `data.connect.failed`                                           | a connection could not be opened; `stage` says where                                                                                                                                                                                                                                                                         |
| `CONNECTION_LOST`      | 503    | Service unavailable                             | `data.connection.closed`                                        | the session ended under a statement or an open transaction; a lone statement's outcome is unknown                                                                                                                                                                                                                            |
| `PROTOCOL_VIOLATION`   | 500    | Database protocol violation                     | `data.connection.closed`                                        | the server broke the protocol; the connection is closed                                                                                                                                                                                                                                                                      |
| `RESULT_TOO_LARGE`     | 500    | Database result over its bound                  | `data.statement.failed`                                         | a result over `maxResultBytes`, or on PostgreSQL one message over it; no rows; the PostgreSQL connection is closed                                                                                                                                                                                                           |
| `PARAMETERS_TOO_LARGE` | 500    | Query parameters over their bound               | none                                                            | over `maxParameterBytes` or the parameter count; nothing sent                                                                                                                                                                                                                                                                |
| `INVALID_QUERY`        | 500    | Query refused                                   | none, or `data.connection.closed` when the connection is closed | a refused parameter; a NUL in the text; two columns of one name; a row schema that is not an object or is `secret` as a whole; on SQLite, text after the first statement; query text that opens a transaction data did not open or ends one data opened, or a script that leaves a transaction open; on PostgreSQL, a `COPY` |
| `QUERY_FAILED`         | 500    | Database statement failed                       | `data.statement.failed`                                         | the database refused the statement; `sqlState` or `sqliteCode` says why                                                                                                                                                                                                                                                      |
| `ROW_INVALID`          | 500    | Row refused by its schema                       | `data.statement.failed`                                         | a row failed its schema or a conversion; no rows returned                                                                                                                                                                                                                                                                    |
| `TRANSACTION_FAILED`   | 500    | Transaction already failed                      | none                                                            | a statement or the commit on a transaction where a statement already failed                                                                                                                                                                                                                                                  |
| `HANDLE_CLOSED`        | 500    | Database handle used after its callback settled | none                                                            | a transaction's or reserved connection's handle used after its callback settled                                                                                                                                                                                                                                              |
| `COMMIT_UNKNOWN`       | 500    | Transaction outcome unknown                     | `data.statement.failed`                                         | the connection was lost or cancelled with the commit in flight, or text inside the transaction ended its block; it may have committed                                                                                                                                                                                        |
| `CANCELLED`            | 500    | Database work cancelled                         | none                                                            | the owner's signal aborted                                                                                                                                                                                                                                                                                                   |

Transaction control is caught by the connection's transaction state after each statement, not by the words in the text. Text that opens a transaction data did not open, or ends one data opened, is `INVALID_QUERY`; it closes a PostgreSQL connection, and an enclosing transaction then rejects `COMMIT_UNKNOWN`, since the text may have committed. Text that leaves the state unchanged is not caught: on PostgreSQL, `commit` or `rollback` with no transaction open, or `begin` inside one, resolves with only a server warning; on SQLite the same text fails with `QUERY_FAILED`, and inside a transaction the transaction then rejects `TRANSACTION_FAILED`. On PostgreSQL, text inside `transaction()` that commits (`commit`, `end`, `commit and chain`) is refused only after the server has run it, so what it committed stays committed and the transaction rejects `COMMIT_UNKNOWN`. `rollback and chain` (or `abort and chain`) is refused with `INVALID_QUERY` and the transaction rejects `COMMIT_UNKNOWN`, unless the transaction has already used a savepoint: after one, it is not caught, because the server answers it exactly as it answers `rollback to savepoint`, so the work before it is discarded and the statements after it commit as a new transaction. `savepoint`, `rollback to savepoint` and `release savepoint` work inside `transaction()` on both databases. Use `transaction()` and never send transaction control as query text. A second statement in one query is `QUERY_FAILED` on PostgreSQL, which refuses it itself, and `INVALID_QUERY` on SQLite; neither statement runs. Every rejection of a transaction other than `COMMIT_UNKNOWN` means nothing was written.

## Records

Each database plugin registers four security events, and the limiter two, through core's [`Scope.event`](../api/core/server.md#scope). A record is written at its severity, in category `security`, on the logger of the work's owner (so a request's records carry its id), under core's suppression of repeated security records. Fields hold codes and fixed words only: never a value, the statement's text, an address or a key.

| Event                    | Severity | Written when                                                                       | Fields                                                                                                   |
| ------------------------ | -------- | ---------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `data.connect.failed`    | error    | a connect fails, at boot or later                                                  | a failure's fields                                                                                       |
| `data.connection.closed` | warn     | a call fails because its connection ended or was closed                            | a failure's fields                                                                                       |
| `data.statement.failed`  | error    | a call fails `QUERY_FAILED`, `ROW_INVALID`, `RESULT_TOO_LARGE` or `COMMIT_UNKNOWN` | a failure's fields                                                                                       |
| `data.insecure`          | warn     | the plugin of a database with `insecure` set runs                                  | none                                                                                                     |
| `data.limit.refused`     | warn     | the limiter answers 429                                                            | `data.rule`                                                                                              |
| `data.limit.unavailable` | error    | the limiter answers 503                                                            | `data.code` (`LIMIT_UNAVAILABLE`), `data.rule`, `data.reason`: a `DataErrorCode`, `TIMEOUT` or `ADDRESS` |

A failure's fields are `data.code` and `data.engine` (`postgres` or `sqlite`), and, where there is one, `data.sqlstate`, `data.sqlite_code`, `data.stage` and `data.reason`, a word from the [boot failure table](#boot-failures) or `lost`, `server`, `result-bound`, `transaction-control` or `copy`. At the default `security` threshold of `warn`, all six events are written.

## Values

A parameter is sent as a value, never as text.

| JavaScript   | PostgreSQL               | SQLite                                   |
| ------------ | ------------------------ | ---------------------------------------- |
| `string`     | text                     | TEXT                                     |
| `number`     | decimal text             | INTEGER when a safe integer, else REAL   |
| `bigint`     | decimal text             | INTEGER; outside 64 bits `INVALID_QUERY` |
| `boolean`    | `true` or `false`        | 1 or 0                                   |
| `null`       | NULL                     | NULL                                     |
| `Uint8Array` | `bytea`, sent in binary  | BLOB                                     |
| `Date`       | its `toISOString()` text | the same text                            |

Anything else (`undefined`, `NaN` or an infinite number, an invalid `Date`, another object, an array) fails the query with `INVALID_QUERY`, with nothing sent. PostgreSQL works out a parameter's type from its context; where there is none, the query needs a cast such as `${value}::int`.

Rows read without a schema:

| PostgreSQL            | JavaScript                                                                     | SQLite  | JavaScript   |
| --------------------- | ------------------------------------------------------------------------------ | ------- | ------------ |
| `bool`                | `boolean`                                                                      | INTEGER | `bigint`     |
| `int2`, `int4`, `oid` | `number`                                                                       | REAL    | `number`     |
| `int8`                | `bigint`                                                                       | TEXT    | `string`     |
| `float4`, `float8`    | `number`                                                                       | BLOB    | `Uint8Array` |
| `bytea`               | `Uint8Array`, from the `hex` or `escape` form                                  | NULL    | `null`       |
| `timestamptz`         | RFC 3339 text in UTC, such as `2026-11-26T09:30:00.123456Z`, microseconds kept |         |              |
| every other type      | the server's text; JSON is text for you to parse                               |         |              |
| NULL                  | `null`                                                                         |         |              |

Sessions run in UTC, so a `timestamptz` arrives in the `+00` form that is rewritten; any other form stays the server's text. A row is a frozen object with a `null` prototype, so a column named `__proto__` is an ordinary key.

With a core object schema, a row keeps only the declared columns, and three exact conversions apply before the check: a `bigint` within the safe integer range to a number for an `integer` or `number` column, a `bigint` to decimal text for a `string` column, and 0 or 1 to a boolean for a `boolean` column. A union is tried member by member in order. A `secret` column arrives as a `Secret`. A missing column, a refused value or a failed conversion is `ROW_INVALID` for the whole result.

## Transactions, scripts and reservations

| Behavior                         | PostgreSQL                                                                             | SQLite                                                                                  |
| -------------------------------- | -------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Begin                            | `begin`, with the isolation level and `read only` when given                           | `BEGIN IMMEDIATE`; with `readOnly`, `BEGIN` under `PRAGMA query_only`                   |
| `isolation`                      | sent as given (default the server's)                                                   | accepted and ignored: SQLite transactions are serializable                              |
| A write under `readOnly`         | `QUERY_FAILED`, `sqlState` `25006`                                                     | `QUERY_FAILED`, `sqliteCode` 8                                                          |
| Other calls during a transaction | use other connections, up to `maxConnections`                                          | wait for the one connection, within `maxWaiters` and `acquireTimeoutMs`                 |
| The owner aborts                 | the transaction rolls back; a running statement is cancelled and its connection closed | the transaction rolls back between statements                                           |
| A failed rollback                | the connection is closed                                                               | the connection is closed; a `':memory:'` database is then empty when the next one opens |
| `script(text)`                   | one implicit transaction unless the text says otherwise                                | each statement commits on its own unless the text has its own transaction               |
| Release of a reserved connection | the connection is closed                                                               | the one connection is kept and its open-time settings restored                          |

A script runs only on a reserved connection, takes no parameters and must leave no transaction open (`INVALID_QUERY`). A pooled PostgreSQL connection is not reset on release; one where `client_encoding`, `DateStyle` or `TimeZone` changed is closed instead of reused. SQLite runs on the main thread with `busy_timeout` 0, WAL, `synchronous = FULL` and foreign keys on; another process holding the write lock fails a statement at once with `QUERY_FAILED` and `sqliteCode` 5 or 517. A missing SQLite file is created at mode 0600; an existing file's mode is left alone.

## Pool and shutdown

Waiters are served first come, first served, by a returned connection or a new one. Each waiter needing a connection causes at most one connect, and a failed connect rejects the oldest waiter. No connection is checked before it is handed out; one that errors or closes while idle is dropped. A caller that arrives while fewer than `maxConnections` connections are open waits for a new one and does not count against `maxWaiters`; only callers beyond those do, so a burst gets `maxConnections` callers served, `maxWaiters` waiting and the rest refused with `POOL_FULL`. `db.stats()` returns `{ open, checkedOut, waiting }`, where `waiting` counts every caller waiting for a connection, including those whose connection is still opening, so it can briefly exceed `maxWaiters`. Cancelling a running PostgreSQL statement opens one extra connection for the cancel request, so the pool's sockets can reach twice `maxConnections` while cancels are in flight; its sessions on the server never pass `maxConnections`.

The plugin registers the pool's cleanup with `scope.onClose`, so `server.close()` closes it after HTTP draining, with the scope's `closeTimeoutMs` (the server's `pluginCloseTimeoutMs`): waiting calls reject `POOL_CLOSED`, idle connections close, connections in use get up to 0.4 of that time, running statements are then cancelled for at most 0.1 more, and every connection left is destroyed.

## Limiter

`limitRoutes(scope, options)` adds an `onRequest` hook to the scope, registers a boot plugin (`limitRoutes`) and registers an `onRoutes` check. `installLimitTable(database, owner)` creates the table and its index when they are missing; the limiter never creates them.

| Option                       | Value                                                                                                               |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `database`                   | the `Database` holding the counts; its plugin must be registered before `limitRoutes`                               |
| `rules`                      | at least one rule, keyed by name: a lower-case letter, then letters, digits, `.`, `_` or `-`, 64 characters at most |
| `rules.<name>.max`           | requests allowed per window, an integer from 1 to 1,000,000                                                         |
| `rules.<name>.windowSeconds` | the window, an integer from 1 to 86,400                                                                             |
| `rules.<name>.routes`        | at least one route definition from a contract, matched by method and path; a route belongs to one rule at most      |
| `chargeTimeoutMs`            | time one charge may take, an integer from 1 to 2,147,483,647 ms (default 1,000)                                     |

`limitRoutes` throws `BootError` `INVALID_OPTION` for an unknown key, no rule, a name outside the grammar, a number out of range, an empty `routes`, an entry without a string `method` and `path`, or a route in two rules. `listen` rejects with `PLUGIN_FAILED` when a rule names a route that no route under the scope serves (`Server failed in onRoutes: Limit rule <rule> names <METHOD> <path>, which no route under this scope serves`), and when the boot plugin's first cleanup pass fails (`Plugin limitRoutes failed: Limit table could not be read: call installLimitTable once, and register the database's plugin before limitRoutes`).

| Outcome     | Response                                                                                                     | Record                   | Handler | Error handlers, `onError` | `onResponse` |
| ----------- | ------------------------------------------------------------------------------------------------------------ | ------------------------ | ------- | ------------------------- | ------------ |
| pass        | the route's own                                                                                              | none                     | runs    | as usual                  | as usual     |
| refused     | 429 `{"status":429,"code":"RATE_LIMITED","message":"Too many requests"}`, `retry-after` 1 to `windowSeconds` | `data.limit.refused`     | no      | no                        | no           |
| unavailable | 503 `LIMIT_UNAVAILABLE`, `Service unavailable`                                                               | `data.limit.unavailable` | no      | yes                       | yes          |

The 429 is sent with `context.send`; the 503 is a thrown `HttpError` with the `DataError` as its `cause` where there is one. Unavailable means the charge rejected, passed `chargeTimeoutMs`, or the request's `clientAddress` is not an IP address. A charge ended by the request's own abort answers 503 and writes no record. A charge that timed out or lost its connection may have counted; nothing is refunded or retried.

- **What is counted.** A request that reaches `onRequest` on a rule's route: after routing, the cross-site check and, when the server identifies callers as `@skeld/auth` does, that step; before the body is read. A HEAD request counts against its GET route. Unrouted paths, CORS preflights, and requests refused before `onRequest` are not counted.
- **The key.** SHA-256 of the rule's name, a zero byte and the counted address: an IPv4 address, the first four groups of an IPv6 address, or the IPv4 address inside an IPv4-mapped one. No address is stored.
- **The count.** A fixed window per rule and address, charged in one statement on the database's clock. A refused request is counted too, up to `max + 1`, and the window's end does not move. A changed `max` applies at the next charge; a renamed rule starts from nothing.
- **The cache.** Each process remembers up to 10,000 refused keys until their window ends and refuses them without a statement; at the bound the oldest leaves.
- **Cleanup.** The boot plugin's first pass deletes expired rows, then a pass runs 100 ms after one that removed a full batch and 60 s after any other or a failed one, until shutdown. A batch is 1,000 rows on PostgreSQL and 100 on SQLite, where a pass runs on the main thread. Each pass has 5,000 ms.

| Table column | PostgreSQL: `skeld_data.limit_windows`, unlogged | SQLite: `skeld_data_limit_windows`, `STRICT`, `WITHOUT ROWID` |
| ------------ | ------------------------------------------------ | ------------------------------------------------------------- |
| `key`        | `bytea` primary key                              | `BLOB` primary key                                            |
| `count`      | `integer not null`                               | `INTEGER NOT NULL`                                            |
| `expires_at` | `bigint not null`, epoch milliseconds            | `INTEGER NOT NULL`, epoch milliseconds                        |

Both have an index on `expires_at`. On PostgreSQL `installLimitTable` needs the right to create the schema `skeld_data`, and the service's role needs insert, update, select and delete on the table; a missing privilege shows at the first charge as a 503. The unlogged table is emptied by a PostgreSQL crash or failover and is not replicated, so every window starts again. The rows are disposable: no backup needs them, and a later table format takes a new name.

## toPgPool

`toPgPool(database)` returns the pool shape `@skeld/auth/postgres` accepts (`connect`, `options.max`, `query`, `release`, `on`, `removeListener`) over the database's own connections, so auth's statements count against `maxConnections`. `options.max` is `maxConnections`. Text with values is one parameterized statement; text without values may hold several. A rejection is an `Error` with a fixed message and the `pg` fields `code` (the SQLSTATE) and `severity`, and no server text. A checkout waits within `acquireTimeoutMs`. A SQLite database throws `BootError` `INVALID_OPTION`.

## Not included

- An ORM, a query builder, a migration engine, migration bookkeeping or a migration lock helper.
- Databases other than PostgreSQL and SQLite, and database work without a skeld server's plugin lifecycle.
- On PostgreSQL: `COPY`, `LISTEN` and `NOTIFY`, replication, cursors and streamed results, named prepared statements and a statement cache, pipelining, binary results, direct TLS, Unix sockets, client certificates, several hosts, `.pgpass`, service files and `PG*` environment variables, and every sign-in method but SCRAM-SHA-256.
- A savepoint or nested-transaction API, and automatic retries.
- A SQLite worker thread, interrupting a running SQLite statement, and sharing `@skeld/auth`'s SQLite connection.
- For the limiter: sliding windows, keys other than the client address, an in-memory store of its own, and `RateLimit` headers.
- Telemetry export.

## Compatibility tested

What the repository's proofs and the example exercise, on Linux with Node 26.13:

- **PostgreSQL:** 19, over TCP on loopback with TLS from a local authority. PostgreSQL 18 and older are not tested.
- **SQLite:** the version bundled with Node 26.13, on a file and on `':memory:'`.
- **Not tested:** any managed provider (Amazon RDS, Supabase, Neon or another), and any connection pooler (PgBouncer, Supavisor, RDS Proxy).
