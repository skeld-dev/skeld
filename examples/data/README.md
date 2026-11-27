# A service on a database

This example is a small bank of two accounts, `alice` and `bob`, built on `@skeld/data`. It shows a query whose rows are checked by a schema, a transfer that runs in a transaction, and a rate limit on the transfer route. It also shows a migration script that creates the tables before the service starts, so the service itself never changes the schema. By default it runs on a SQLite file. Set `DATABASE_URL` and the same script and service run on PostgreSQL, where the script also creates the rate limiter's table and `@skeld/auth`'s store (the tables where auth keeps sessions, API keys and its rate-limit counts, among others).

It needs Node 26. PostgreSQL is optional; the example is tested on PostgreSQL 19.

## Run the walkthrough

From the repository root, after `pnpm install`:

```sh
pnpm --filter @skeld/example-data run walkthrough
```

The walkthrough migrates a new SQLite file in a temporary folder, starts the service on it on a free local port, calls each route, exceeds the transfer limit once, closes the service and deletes the folder. It exits with status 0 only if every check passes:

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

If a check fails, it prints the migration's and the server's logs to stderr and exits with status 1.

## Migrate, then run the server

Run the migration script first:

```sh
pnpm --filter @skeld/example-data run migrate
```

```text
data example migrated (sqlite)
```

The script creates the tables `accounts` and `transfers` and adds alice with 100 and bob with 50. On SQLite the data is kept in `examples/data/.data/bank.db`, which Git ignores. Every statement leaves an existing database as it is, so running the script again changes nothing. The line above goes to stderr; the script's JSON log goes to stdout. It never listens on a port.

If the script fails, it prints one line of codes to stderr and exits with status 1, for example when nothing answers at the database's address:

```text
migrate failed: PLUGIN_FAILED CONNECT_FAILED socket
```

The first code is the `BootError`'s; a database failure's `DataError` code follows, then the step a connection failed at and the server's SQLSTATE when there is one. The line never holds an error message, a stack, the connection URL or its password, since any of them could end up in a deploy log. The JSON log on stdout holds data's record of the failure, such as `data.connect.failed` with its stage and reason.

Then start the server:

```sh
pnpm --filter @skeld/example-data run start
```

The server listens on `http://127.0.0.1:3004` (set `PORT` to choose another port) and prints its address and database engine to stderr. Its JSON log, with one access record per request, goes to stdout. Balances survive a restart. Delete `examples/data/.data/` and run the script again to start again from 100 and 50. Stop the server with Ctrl-C.

The server creates nothing in the application's database. If the script has not run on it, the server does not start: `listen` rejects with `BootError` `PLUGIN_FAILED` (`Plugin plugin #3 failed: Database statement failed`), the process exits with status 1, and the database is left without a table. Run the script, then start the server again.

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
DATABASE_URL='postgres://migrator:password@db.example.com:5432/bank' \
DATABASE_CA_FILE=/etc/ssl/bank-db-ca.pem \
pnpm --filter @skeld/example-data run migrate
```

```text
data example migrated (postgres)
```

Then start the server with the same two variables:

```sh
DATABASE_URL='postgres://app:password@db.example.com:5432/bank' \
DATABASE_CA_FILE=/etc/ssl/bank-db-ca.pem \
pnpm --filter @skeld/example-data run start
```

Replace the URLs and the file path with your own. The script and the service read only these two variables; they ignore the `PG*` variables that other PostgreSQL clients read, and they never print the URL.

On PostgreSQL the script does more than on SQLite: it also creates the limiter's table (in the schema `skeld_data`) and auth's store (in the schema `skeld_auth`), and closes the store before it closes the database. Its database user needs permission to create those two schemas and to create tables in the schema `public`, where `accounts` and `transfers` live. The service only reads and changes rows, so its user needs no right to change the schema: only the use of the schemas `public` and `skeld_data` and the right to read and change the rows of `accounts`, `transfers` and the limiter's table. As on SQLite, the service refuses to start on a database the script has not run on.

To run the walkthrough on PostgreSQL, give it a user that may change the schema, since the walkthrough runs the migration itself before it starts the service:

```sh
DATABASE_URL='postgres://migrator:password@db.example.com:5432/bank' \
DATABASE_CA_FILE=/etc/ssl/bank-db-ca.pem \
pnpm --filter @skeld/example-data run walkthrough
```

On PostgreSQL the walkthrough uses that database's tables, and it moves money back so that the balances end as they started. The limiter's counts are stored in the database, so a second run within 10 seconds of the first starts already limited and fails; wait 10 seconds between runs.

## What each file does

| File                             | What it shows                                                                                       |
| -------------------------------- | --------------------------------------------------------------------------------------------------- |
| [contract.ts](contract.ts)       | The three routes, and the `Account` schema used both as a response body and as a query's row schema |
| [database.ts](database.ts)       | Choosing the database: PostgreSQL from `DATABASE_URL`, else the SQLite file                         |
| [migration.ts](migration.ts)     | The schema step on a worker that never listens, and auth's store on PostgreSQL                      |
| [migrate.ts](migrate.ts)         | Runs the migration with its SQLite file in `.data/` and prints one line, codes only on failure      |
| [app.ts](app.ts)                 | The boot check, the limiter and the handlers                                                        |
| [server.ts](server.ts)           | Starts the service with its SQLite file in `.data/` and closes it on Ctrl-C                         |
| [walkthrough.ts](walkthrough.ts) | Migrates, then the scripted run of every route                                                      |

## How it works

**The database is a plugin.** `createSqliteDatabase` or `createPostgresDatabase` creates the database, and `server.register(db.plugin)` opens it when the server starts and closes it when `server.close()` runs. Plugins start in registration order, so the database is registered before anything that queries it.

**Queries.** Every statement is written with the `sql` tagged template. Each `${value}` is sent to the database as a parameter, never pasted into the SQL text, so a request's values cannot change the statement. A handler starts its work with `db.for(request)`: the work then stops if the client goes away, and its log records carry the request's ID.

**Row schemas.** `listAccounts` and `getAccount` pass the contract's `Account` schema to `query`. The rows come back typed as `{ id: string; balance: number }` and checked against the schema. SQLite returns integers as `bigint`; the schema's `integer` converts each one to a number, and a value that does not fit is an error rather than a silent change.

**The transaction.** `createTransfer` debits one account and credits the other inside `db.for(request).transaction(...)`. When the callback returns, both changes commit together. When it throws, nothing it wrote is kept: a transfer to an account that does not exist has already debited alice when the credit finds no row, and the `HttpError` thrown there rolls that debit back. The debit itself only changes a balance that is large enough, so a balance never goes below zero.

**The limit.** `limitRoutes` allows 5 transfers per 10 seconds from one client address and answers the next with 429 before the handler runs or the body is read. Its counts are kept in a database:

- On SQLite the limiter gets its own in-memory database. On the application's file every count would be a disk write, waiting behind the application's own writes. The counts restart when the process restarts.
- On PostgreSQL the limiter uses the application's database. Every process of the service shares the counts, and they survive a restart.

`installLimitTable` creates the limiter's table. The limiter never creates it itself; `listen` fails if the table is missing.

**The migration runs on a worker.** `migrate` in `migration.ts` registers the database's plugin on `createWorker()` from `@skeld/core/worker`, a root that runs plugins but has no routes and never listens. After `worker.start()` it creates the tables and adds the two accounts if they are missing; on PostgreSQL it also runs `installLimitTable` and installs auth's store. It closes the worker in a `finally` block, which closes the database. A start that fails has already closed the worker.

**auth's store on the same pool.** On PostgreSQL the script creates the store with `createPostgresStore({ pool: toPgPool(db) })`, so auth's statements use the database's own connections, installs its tables and closes the store with its own `close()` before the worker closes the pool. A started worker takes no more `onClose` callbacks, so the store cannot be closed that way. The service itself does not use the store; the [auth example](../auth/README.md) shows how to require sign-in with `createAuth({ store, origin })`. `toPgPool` refuses a SQLite database.

**The boot check.** A plugin registered after the databases runs `select id from accounts limit 0` and the same on `transfers`. Both return no row, and either fails when its table is missing, so the service refuses to start on a database the script has not run on rather than failing on every request. On SQLite the same plugin runs `installLimitTable` on the limiter's in-memory database, which starts empty with every process.

**Failures.** When the database cannot be reached or a statement fails, the route answers with skeld's JSON error body, `{ status, code, message }`: 503 `Service unavailable` for an unavailable database, or 500 with a fixed message. The database's own message and the SQL text never reach the client or the log line; [`exposeDetail`](../../docs/api/data/data-error.md#exposedetail) reads them when you need them.

## What this example does not show

- **No retry.** On PostgreSQL two opposite transfers at the same moment can deadlock, and the database then aborts one of them. That transfer answers 500 and wrote nothing; the example does not try it again.
- **No users or sign-in.** Anyone who can reach the port can move money. The service binds `127.0.0.1` only.
- **No migrations tool.** The script creates tables that do not exist; it never changes a table that does, and it keeps no record of which version a database is at.

## Copy into your project

Copy `contract.ts`, `database.ts`, `migration.ts`, `migrate.ts`, `app.ts` and `server.ts`, and install `@skeld/core`, `@skeld/data` and `@skeld/auth` (`migration.ts` installs auth's store on PostgreSQL). The `skeld-source` condition in `package.json` and the relative `tsconfig.json` are needed only inside this repository. See the API pages for [`@skeld/data/sqlite`](../../docs/api/data/sqlite.md), [`@skeld/data/postgres`](../../docs/api/data/postgres.md), [`@skeld/data/limit`](../../docs/api/data/limit.md) and [`@skeld/data/pg-pool`](../../docs/api/data/pg-pool.md).
