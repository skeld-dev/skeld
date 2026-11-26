# A service on a database

This example is a small bank of two accounts, `alice` and `bob`, built on `@skeld/data`. It shows a query whose rows are checked by a schema, a transfer that runs in a transaction, and a rate limit on the transfer route. By default it runs on a SQLite file and needs no setup. Set `DATABASE_URL` and the same service runs on PostgreSQL, with `@skeld/auth`'s store (the tables where auth keeps sessions, API keys and its rate-limit counts, among others) sharing its connection pool.

It needs Node 26. PostgreSQL is optional; the example is tested on PostgreSQL 19.

## Run the walkthrough

From the repository root, after `pnpm install`:

```sh
pnpm --filter @skeld/example-data run walkthrough
```

The walkthrough starts the service on a free local port with a new SQLite file in a temporary folder, calls each route, exceeds the transfer limit once, closes the service and deletes the folder. It exits with status 0 only if every check passes:

```text
data example on sqlite
A query with a row schema
  ok  GET /accounts lists alice and bob: 200
  ok  GET /accounts/carol: 404 ACCOUNT_NOT_FOUND
A transaction
  ok  alice sends bob 10: 201
  ok  both balances moved by 10
  ok  alice sends carol 5: 404, carol has no account
  ok  the debit from alice was rolled back
  ok  alice sends more than she has: 409 TRANSFER_REFUSED
A limited route: 5 transfers per 10 seconds per address
  ok  transfers 4 and 5: 201
  ok  transfer 6: 429 RATE_LIMITED
  ok  retry-after is 1 to 10 seconds
  ok  the refused transfer never ran
walkthrough passed
```

If a check fails, it prints the server's log to stderr and exits with status 1.

## Run the server

```sh
pnpm --filter @skeld/example-data run start
```

The server listens on `http://127.0.0.1:3004` (set `PORT` to choose another port) and prints its address and database engine to stderr. Its JSON log, with one access record per request, goes to stdout. On SQLite the data is kept in `examples/data/.data/bank.db`, which Git ignores, so balances survive a restart. Delete the folder to start again from 100 and 50. Stop the server with Ctrl-C.

In a second terminal, list the accounts:

```sh
curl http://127.0.0.1:3004/accounts
```

```text
{"accounts":[{"id":"alice","balance":100},{"id":"bob","balance":50}]}
```

Send bob 10:

```sh
curl http://127.0.0.1:3004/transfers -H 'content-type: application/json' \
  --data '{"from":"alice","to":"bob","amount":10}'
```

```text
{"id":"0ec2ccd4-345a-414a-b924-39f1da13cf7a","from":"alice","to":"bob","amount":10}
```

The `id` is new for each transfer. Read alice's account:

```sh
curl http://127.0.0.1:3004/accounts/alice
```

```text
{"id":"alice","balance":90}
```

Repeat the transfer quickly: the sixth transfer within 10 seconds is refused with HTTP 429, the body `{"status":429,"code":"RATE_LIMITED","message":"Too many requests"}` and a `retry-after` header in seconds.

## Run on PostgreSQL

Set `DATABASE_URL` to a `postgres://` URL. The connection uses TLS and checks the server's certificate and host name against Node's bundled root certificates. If your server's certificate comes from another authority, such as a local one or a managed provider's, set `DATABASE_CA_FILE` to that authority's certificate in PEM form:

```sh
DATABASE_URL='postgres://app:password@db.example.com:5432/bank' \
DATABASE_CA_FILE=/etc/ssl/bank-db-ca.pem \
pnpm --filter @skeld/example-data run walkthrough
```

Replace the URL and the file path with your own. The service reads only these two variables; it ignores the `PG*` variables that other PostgreSQL clients read, and it never prints the URL. The database user needs permission to create tables and the schemas `skeld_data` and `skeld_auth`.

On PostgreSQL the walkthrough uses that database's tables, and it moves money back so that the balances end as they started. The limiter's counts are stored in the database, so a second run within 10 seconds of the first starts already limited and fails; wait 10 seconds between runs.

## What each file does

| File                             | What it shows                                                                                       |
| -------------------------------- | --------------------------------------------------------------------------------------------------- |
| [contract.ts](contract.ts)       | The three routes, and the `Account` schema used both as a response body and as a query's row schema |
| [app.ts](app.ts)                 | Choosing the database, the setup step, the limiter, the handlers and auth's store on PostgreSQL     |
| [server.ts](server.ts)           | Starts the service with its SQLite file in `.data/` and closes it on Ctrl-C                         |
| [walkthrough.ts](walkthrough.ts) | The scripted run of every route                                                                     |

## How it works

**The database is a plugin.** `createSqliteDatabase` or `createPostgresDatabase` creates the database, and `server.register(db.plugin)` opens it when the server starts and closes it when `server.close()` runs. Plugins start in registration order, so the database is registered before anything that queries it.

**Queries.** Every statement is written with the `sql` tagged template. Each `${value}` is sent to the database as a parameter, never pasted into the SQL text, so a request's values cannot change the statement. A handler starts its work with `db.for(request)`: the work then stops if the client goes away, and its log records carry the request's ID.

**Row schemas.** `listAccounts` and `getAccount` pass the contract's `Account` schema to `query`. The rows come back typed as `{ id: string; balance: number }` and checked against the schema. SQLite returns integers as `bigint`; the schema's `integer` converts each one to a number, and a value that does not fit is an error rather than a silent change.

**The transaction.** `createTransfer` debits one account and credits the other inside `db.for(request).transaction(...)`. When the callback returns, both changes commit together. When it throws, nothing it wrote is kept: a transfer to an account that does not exist has already debited alice when the credit finds no row, and the `HttpError` thrown there rolls that debit back. The debit itself only changes a balance that is large enough, so a balance never goes below zero.

**The limit.** `limitRoutes` allows 5 transfers per 10 seconds from one client address and answers the next with 429 before the handler runs or the body is read. Its counts are kept in a database:

- On SQLite the limiter gets its own in-memory database. On the application's file every count would be a disk write, waiting behind the application's own writes. The counts restart when the process restarts.
- On PostgreSQL the limiter uses the application's database. Every process of the service shares the counts, and they survive a restart.

`installLimitTable` creates the limiter's table. The limiter never creates it itself; `listen` fails if the table is missing.

**The setup step.** A plugin registered after the databases creates the tables, adds the two accounts if they are missing, installs the limiter's table and, on PostgreSQL, auth's tables. Each statement leaves an existing database as it is, so the example runs it at every start. A deployed service runs this step once, as a migration, before it starts.

**auth's store on the same pool.** On PostgreSQL, `createPostgresStore({ pool: toPgPool(db) })` gives `@skeld/auth` the database's own connections, so the service opens one pool and auth's statements count against its connection limit. The example installs the store's tables and closes the store before the database closes. It shares the pool with auth's store but does not require sign-in on its routes; the [auth example](../auth/README.md) shows how to require it with `createAuth({ store, origin })`. `toPgPool` refuses a SQLite database.

**Failures.** When the database cannot be reached or a statement fails, the route answers with skeld's JSON error body, `{ status, code, message }`: 503 `Service unavailable` for an unavailable database, or 500 with a fixed message. The database's own message and the SQL text never reach the client or the log line; [`exposeDetail`](../../docs/api/data/data-error.md#exposedetail) reads them when you need them.

## What this example does not show

- **No retry.** On PostgreSQL two opposite transfers at the same moment can deadlock, and the database then aborts one of them. That transfer answers 500 and wrote nothing; the example does not try it again.
- **No users or sign-in.** Anyone who can reach the port can move money. The service binds `127.0.0.1` only.
- **No migrations tool.** The setup step creates tables that do not exist; it never changes a table that does.

## Copy into your project

Copy `contract.ts`, `app.ts` and `server.ts`, and install `@skeld/core` and `@skeld/data` (and `@skeld/auth` for the PostgreSQL store). The `skeld-source` condition in `package.json` and the relative `tsconfig.json` are needed only inside this repository. See the API pages for [`@skeld/data/sqlite`](../../docs/api/data/sqlite.md), [`@skeld/data/postgres`](../../docs/api/data/postgres.md), [`@skeld/data/limit`](../../docs/api/data/limit.md) and [`@skeld/data/pg-pool`](../../docs/api/data/pg-pool.md).
