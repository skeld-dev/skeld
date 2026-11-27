# Store data in PostgreSQL or SQLite

`@skeld/data` connects a skeld service to PostgreSQL or SQLite behind one API. Queries are written only with the `sql` tagged template, so every value you interpolate is sent as a parameter and never as query text. A query that names a row schema returns rows checked against it; one that names none returns columns typed `unknown`. Transactions and reserved connections are callbacks, so a connection is always given back. Every database failure is a `DataError` with a code from a fixed list and a fixed message, and what the database said about it is kept out of responses and logs.

On PostgreSQL, data speaks the protocol itself over `node:net` and `node:tls`, and every TLS connection has the server's certificate and host name verified. The one thing your code can ask for, by name, is a connection without TLS. SQLite runs through Node's built-in `node:sqlite`. It also gives you a rate limiter, [`limitRoutes`](#limit-requests-per-client-address), whose counts live in one of these databases, and [`toPgPool`](#run-auths-postgresql-store-on-the-same-pool), so `@skeld/auth`'s PostgreSQL store can run on the same connections.

It is not an ORM, a query builder or a migration tool. You write the SQL, and your migrations are SQL you run on a [reserved connection](#reserve-a-connection-for-migrations-and-locks).

Install it in an ES module project:

```sh
npm install @skeld/data
```

It needs Node 26.12 or later, and its one dependency is `@skeld/core`. The tested targets are PostgreSQL 19 and the SQLite that ships with Node 26.13. Exact signatures are in the [data API reference](../api/README.md#data-api); options, codes and value tables are in the [data behavior reference](../reference/data.md).

## A complete service

A whole service on a SQLite file is two files. `migrate.ts` creates the table, once, before the service starts; `tasks.ts` is the service, which inserts a task in a transaction and reads one back through a row schema.

`migrate.ts` runs the database's plugin on a worker, which boots plugins without listening, and closes it when the schema step is done:

```ts
import { createWorker } from '@skeld/core/worker';
import { createSqliteDatabase } from '@skeld/data/sqlite';

const db = createSqliteDatabase({ path: 'tasks.db' });
const worker = createWorker();
worker.register(db.plugin);
await worker.start();
try {
  await db.for(worker).reserve(async (connection) => {
    await connection.script('create table if not exists tasks (id integer primary key, title text not null)');
  });
} finally {
  await worker.close();
}
```

`tasks.ts` creates nothing. A plugin registered after the database's checks that the table exists:

```ts
import { once } from 'node:events';
import { defineContract, errorBodySchema } from '@skeld/core/contract';
import * as t from '@skeld/core/schema';
import { createServer } from '@skeld/core/server';
import { sql } from '@skeld/data/sql';
import { createSqliteDatabase } from '@skeld/data/sqlite';

const Task = t.object({ id: t.integer(), title: t.string({ maxLength: 120 }) });

const contract = defineContract({
  createTask: {
    method: 'POST',
    path: '/tasks',
    body: t.object({ title: t.string({ minLength: 1, maxLength: 120 }) }),
    responses: { 201: Task },
  },
  getTask: {
    method: 'GET',
    path: '/tasks/:id',
    params: t.object({ id: t.integer({ minimum: 1 }) }),
    responses: { 200: Task, 404: errorBodySchema },
  },
});

const db = createSqliteDatabase({ path: 'tasks.db' });
const server = createServer();
server.register(db.plugin);
server.register(
  async (scope) => {
    await db.for(scope).query(sql`select id from tasks limit 0`);
  },
  { name: 'checkTables' },
);

server.routes(contract, {
  createTask: async (request) => {
    const task = await db.for(request).transaction(async (tx) => {
      const [created] = await tx.query(
        sql`insert into tasks (title) values (${request.body.title}) returning id, title`,
        Task,
      );
      if (created === undefined) {
        throw new Error('insert returned no row');
      }
      return created;
    });
    return { status: 201, body: task };
  },
  getTask: async (request) => {
    const [task] = await db.for(request).query(sql`select id, title from tasks where id = ${request.params.id}`, Task);
    if (task === undefined) {
      return { status: 404, body: { status: 404, code: 'TASK_NOT_FOUND', message: 'Task not found' } };
    }
    return { status: 200, body: task };
  },
});

await server.listen({ port: 3000, host: '127.0.0.1' });
await Promise.race([once(process, 'SIGINT'), once(process, 'SIGTERM')]);
await server.close();
```

Run the migration, then the service:

```sh
node migrate.ts
node tasks.ts
```

In a second terminal:

```sh
curl -s -X POST -H 'content-type: application/json' -d '{"title":"Write the report"}' http://127.0.0.1:3000/tasks
curl -s http://127.0.0.1:3000/tasks/1
```

```json
{"id":1,"title":"Write the report"}
{"id":1,"title":"Write the report"}
```

The database's plugin opens the file while `listen` runs, before any route is served, and `server.close()` closes it. The check plugin is registered after it, so it runs once the database is open. A plugin registered before `db.plugin` that queries is refused with `POOL_CLOSED`.

On a database `migrate.ts` has not run on, the check's statement fails and the service does not start: `listen` rejects with `BootError` `PLUGIN_FAILED` (`Plugin checkTables failed: Database statement failed`), the process exits with status 1, and no table is created. Run `node migrate.ts`, then start the service again. Running `migrate.ts` a second time changes nothing.

## Connect to PostgreSQL

```ts
import { readFileSync } from 'node:fs';
import { Secret } from '@skeld/core/secret';
import { createServer } from '@skeld/core/server';
import { createPostgresDatabase } from '@skeld/data/postgres';

const db = createPostgresDatabase({
  url: new Secret(process.env.DATABASE_URL ?? ''),
  tls: { ca: readFileSync('/etc/ssl/db/root.pem', 'utf8') },
  maxConnections: 10,
});

const server = createServer();
server.register(db.plugin);
```

The URL has the form `postgres://user[:password]@host[:port][/database][?name=value]` and is passed as a `Secret`, so it does not reach a log by accident. The only parameters accepted are `sslmode` (`require`, `verify-ca` or `verify-full`), `channel_binding` (`prefer` or `require`) and `application_name`. Every one of the three `sslmode` values, and no `sslmode` at all, means the same thing: TLS with the certificate and the host name verified. `sslmode=disable`, `allow` and `prefer` are refused, as are `sslrootcert`, `sslcert`, `sslkey`, `passfile` and every other parameter. Data reads no `PG*` environment variable and no `.pgpass` file. Percent-encode any special character in the user name or password, such as `?` as `%3F`, `/` as `%2F`, `#` as `%23` and `@` as `%40`: an unencoded `?`, `/` or `#` ends the password early, and the URL is refused with a message that holds none of its text.

`createPostgresDatabase` checks its options and opens nothing. A bad option throws `BootError` `INVALID_OPTION` with a message that names the option or the part of the URL, never its value:

```text
Invalid option url: parameter sslrootcert is not supported
```

A parameter PostgreSQL's own client does not define is given by its position instead, since it may be the tail of a password with an unencoded `?`:

```text
Invalid option url: parameter 1 of the query is not supported: use only sslmode, channel_binding or application_name, and percent-encode special characters in the password
```

The first connection is opened while `db.plugin` runs at `listen`. If it fails, `listen` rejects with `BootError` `PLUGIN_FAILED` and a message that names the step, the reason and what to do. With nothing listening on the URL's port:

```text
Plugin postgresDatabase failed: Database connection failed at socket (connect): nothing accepted the connection; check the host, the port and that the server is running
```

The plugin is named `postgresDatabase` (`sqliteDatabase` on SQLite) unless you give `register` a `name`. A certificate that does not verify fails at `tls (certificate)` with the remedy `supply the provider's root certificate in tls.ca`.

Data signs in with SCRAM-SHA-256 only, and uses channel binding (`SCRAM-SHA-256-PLUS`) when the server offers it. A server that asks for a cleartext password or MD5 is refused before the password is sent. The [reference](../reference/data.md#boot-failures) lists every reason.

### Supply the provider's root certificate

Without `tls.ca`, the server's certificate must chain to one of the root authorities bundled with Node. `tls.ca` replaces that list with the certificates you give, as PEM text. What the providers' own documentation says, as of November 2026; data has not been tested against any of them:

| Provider              | What you do                                                                                                                                                                                      |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Amazon RDS            | Download the region's bundle (for example `global-bundle.pem`) and pass its text as `tls.ca`. Remove `sslrootcert` from the URL                                                                  |
| Supabase              | Download the server root certificate from the project's database settings and pass it as `tls.ca`                                                                                                |
| Neon                  | Its certificate chains to ISRG Root X1 (Let's Encrypt), which Node bundles, so no `tls.ca` is needed. Its connection strings carry `sslmode=require&channel_binding=require`, which data accepts |
| Any private authority | Pass the authority's certificate as `tls.ca`                                                                                                                                                     |

A connection string a provider shows with `sslmode=require` and no root file works only when the certificate chains to a bundled root. Otherwise the boot fails at stage `tls` with reason `certificate`, as above. Behavior behind a connection pooler (PgBouncer, Supavisor, RDS Proxy) has not been tested; PgBouncer does not support channel binding, so through it `channel_binding=require` is expected to fail with reason `binding`.

### A private certificate, or no TLS on the same machine

No option turns certificate checking off. A server with a private or self-signed certificate is verified by passing that certificate, or its authority's, as `tls.ca`.

`insecure: 'plaintext'` connects without TLS. It is for a database on the same machine, or behind a local proxy that does the TLS. It writes a `data.insecure` record at `warn` at each boot, and setting it beside a URL `sslmode` is refused at creation:

```ts
import { Secret } from '@skeld/core/secret';
import { createPostgresDatabase } from '@skeld/data/postgres';

export const localDb = createPostgresDatabase({
  url: new Secret('postgres://app:app@127.0.0.1:5432/app'),
  insecure: 'plaintext',
});
```

The setting exists only in code; no URL parameter or environment variable turns TLS off.

## Connect to SQLite

```ts
import { createSqliteDatabase } from '@skeld/data/sqlite';

export const fileDb = createSqliteDatabase({ path: '/var/lib/app/app.db' });
export const memoryDb = createSqliteDatabase({ path: ':memory:' });
```

A file that does not exist is created owner-only (mode 0600) before SQLite opens it; an existing file keeps its permissions. The database runs in WAL mode with `synchronous = FULL`, so a committed transaction survives a power loss, and with foreign keys enforced.

A SQLite database has one connection, used on the main thread. Every call waits its turn for it, within `maxWaiters` and `acquireTimeoutMs`. A statement blocks the event loop while it runs and cannot be cancelled, so one slow query delays every request in the process. Another process writing the same file makes a statement fail at once with `QUERY_FAILED` and `sqliteCode` 5 or 517; nothing waits or retries.

## Bind work to its owner

The database has no `query` of its own. Work starts from `db.for(owner)`, where the owner is anything with a `signal` and a `log`: a handler's request, a hook's context, a plugin's scope, the server or a worker.

- In a handler, write `db.for(request)`. The work is cancelled when the request is (the client closed the connection, or `handlerTimeoutMs` passed), and its records carry the request's id. You never pass a signal yourself.
- Work that must outlive a response, such as a cleanup loop, binds to the plugin's scope. Its signal aborts when shutdown begins.

When the owner's signal aborts, a call still waiting for a connection leaves the queue with nothing sent. A running PostgreSQL statement is cancelled: data sends PostgreSQL a cancel request on a new TLS connection, rejects the call with `CANCELLED` and closes the statement's connection. A cancelled statement outside a transaction may still have taken effect. On SQLite the abort takes effect between statements: an open transaction is rolled back and no later statement runs.

## Write queries

```ts
import type { Database, Owner } from '@skeld/data/database';
import { identifier, sql } from '@skeld/data/sql';

export async function recentOrders(db: Database, owner: Owner, customer: number, since: Date) {
  const recent = sql`created_at > ${since}`;
  return db
    .for(owner)
    .query(sql`select id, total from ${identifier('shop', 'orders')} where customer = ${customer} and ${recent}`);
}
```

- The literal parts of the template are the query text. Each interpolated value is a parameter: a `string`, `number`, `bigint`, `boolean`, `null`, `Uint8Array` or `Date`.
- An interpolated `sql` fragment is placed into the text with its own parameters.
- `identifier(...parts)` quotes a table or column name, joining its parts with `.`, so `identifier('shop', 'orders')` gives `"shop"."orders"`. It throws `DataError` `INVALID_QUERY` for an empty part or a NUL. Never build a name from text a client sent without checking it against a list you own.
- No query call accepts a string as query text; a string passed to `query` does not compile.
- `undefined`, `NaN`, an invalid `Date`, or any other object as a value fails the query with `INVALID_QUERY`, with nothing sent.
- Text with a second statement is refused, and neither statement runs: on SQLite with `INVALID_QUERY`, on PostgreSQL with `QUERY_FAILED`, since PostgreSQL refuses it itself.
- Never send `begin`, `commit` or `rollback` as query text; use [`transaction`](#run-a-transaction). Data checks the connection's transaction state after each statement. Text that opens a transaction data did not open, or ends one that data opened, is refused with `INVALID_QUERY`, and an enclosing `transaction` then rejects `COMMIT_UNKNOWN`, since the text may have committed. Text that leaves the state as it was is not caught: on PostgreSQL a `commit` or `rollback` with no transaction open, or a `begin` inside one, gets only a warning from the server and the call resolves; SQLite refuses the same text with `QUERY_FAILED`.

PostgreSQL works out each parameter's type from where it appears, as `pg` does. Where nothing in the query says what type a value is, add a cast, as in `select ${count}::int + 1`.

### Read rows with or without a schema

Without a schema, each row is a frozen object with no prototype, and every column is typed `unknown`. A PostgreSQL `int8` or a SQLite `INTEGER` comes back as a `bigint`, so a large integer is never rounded. The [value tables](../reference/data.md#values) give every type. One result may hold at most `maxResultBytes` of memory, 16 MiB by default: about 26,000 rows of six short columns. A route that reads more raises the bound for its database or reads in pages.

With a core object schema as the second argument, the rows are checked against it and typed by it:

```ts
import * as t from '@skeld/core/schema';
import type { Database, Owner } from '@skeld/data/database';
import { sql } from '@skeld/data/sql';

const User = t.object({ id: t.integer(), email: t.string({ maxLength: 320 }), admin: t.boolean() });

export async function findUser(db: Database, owner: Owner, id: number) {
  const [user] = await db.for(owner).query(sql`select id, email, admin from users where id = ${id}`, User);
  return user;
}
```

- A column the schema does not declare is dropped from every row.
- A declared column that is missing, or a value the schema refuses, fails the whole query with `ROW_INVALID` and returns no rows.
- Three conversions are made, each exact or the row is refused: a `bigint` to a number for an `integer` or `number` column when it is a safe integer; a `bigint` to decimal text for a `string` column; 0 or 1 to a boolean for a `boolean` column, since SQLite has no boolean type.
- A `secret` column arrives as a `Secret`. Core has no schema for bytes, so read a `bytea` or `BLOB` column without a schema.
- Two result columns with the same name fail with `INVALID_QUERY`. On PostgreSQL the statement may already have run.

## Run a transaction

```ts
import * as t from '@skeld/core/schema';
import type { Database, Owner } from '@skeld/data/database';
import { sql } from '@skeld/data/sql';

const OrderId = t.object({ id: t.integer() });

export async function placeOrder(db: Database, owner: Owner, sku: string, total: number) {
  return db.for(owner).transaction(
    async (tx) => {
      await tx.query(sql`update stock set held = held + 1 where sku = ${sku}`);
      const [order] = await tx.query(
        sql`insert into orders (sku, total) values (${sku}, ${total}) returning id`,
        OrderId,
      );
      return order;
    },
    { isolation: 'serializable' },
  );
}
```

Data sends the begin, the commit and the rollback. The callback's `tx` is the only way to that connection, and its statements run in the order you call them.

- When the callback resolves, the transaction commits and `transaction` resolves with the callback's value.
- When the callback throws, the transaction rolls back and `transaction` rejects with the same error.
- After any statement fails, the transaction cannot commit, even if your callback caught the error: `transaction` rejects with that error, or with `TRANSACTION_FAILED`, and nothing is written.
- When the connection is lost while the commit is in flight, `transaction` rejects with `COMMIT_UNKNOWN`: the transaction may or may not have committed, and your code has to find out. Every other rejection means nothing was written.
- A `tx` kept and used after the callback settles is refused with `HANDLE_CLOSED`.
- `isolation` is `'read committed'`, `'repeatable read'` or `'serializable'` (default the database's own), and `readOnly: true` refuses writes. Nothing is retried, so a serialization failure is a `QUERY_FAILED` your code retries if it wants to.

There is no nested-transaction or savepoint API; `savepoint`, `rollback to savepoint` and `release savepoint` written as query text work inside `transaction()`.

### Keep awaits out of SQLite write transactions

On SQLite a write transaction begins with `BEGIN IMMEDIATE` and holds the database's one connection until it ends, so every other call waits behind it. Any `await` inside the callback that is not a query on `tx` (a network call, a timer, a password hash) keeps the whole service waiting. If `@skeld/auth`'s SQLite store uses the same file, its writes wait on the file lock too, and answer unavailable once their retries run out. Do the slow work before the transaction and pass its result in.

On SQLite any `isolation` is accepted, since SQLite transactions are serializable. `readOnly` makes a write fail with `QUERY_FAILED` and `sqliteCode` 8.

### Change a session setting with SET LOCAL

A pooled PostgreSQL connection is not reset when it goes back to the pool. A `set search_path` or `set role` run through a pooled query stays on that connection and reaches whichever request uses it next. Change a setting inside a transaction with `set local`, which PostgreSQL undoes when the transaction ends:

```ts
import type { Database, Owner } from '@skeld/data/database';
import { sql } from '@skeld/data/sql';

export async function asTenant(db: Database, owner: Owner, tenant: string) {
  return db.for(owner).transaction(async (tx) => {
    await tx.query(sql`select set_config('app.tenant', ${tenant}, true)`);
    return tx.query(sql`select id, name from projects`);
  });
}
```

`set_config(name, value, true)` is `set local` with the value as a parameter. The three settings data opens each connection with (`client_encoding`, `DateStyle` and `TimeZone`, which is UTC) are watched: a connection where one of them changed is closed when it goes back to the pool. A [reserved connection](#reserve-a-connection-for-migrations-and-locks) is always closed at release, so a setting changed on it is never seen again.

## Reserve a connection for migrations and locks

`reserve` holds one connection for a callback. It is the place for work that needs the same session from start to end: a session-level advisory lock, or a migration script.

```ts
import type { Database, Owner } from '@skeld/data/database';
import { sql } from '@skeld/data/sql';

const migration = `
create table if not exists accounts (id bigint primary key, name text not null);
create index if not exists accounts_name on accounts (name);
`;

export async function migrate(db: Database, owner: Owner) {
  await db.for(owner).reserve(async (connection) => {
    await connection.query(sql`select pg_advisory_lock(${42})`);
    await connection.script(migration);
  });
}
```

- `script(text)` runs text of several statements with no parameters. It takes a string because migration files are text; never pass it anything a request sent.
- On PostgreSQL a script is one implicit transaction unless its text says otherwise; on SQLite each statement commits on its own unless the text has its own `begin` and `commit`. A script that leaves a transaction open is refused with `INVALID_QUERY`.
- The reserved connection counts against `maxConnections`. On PostgreSQL it is closed at release, which also releases any session lock. SQLite keeps its one connection and restores its open-time settings.
- `connection.transaction` runs a transaction on the reserved connection.

Data has no migration engine, no record of which migrations ran and no lock helper; that bookkeeping is yours. Database work runs only while the database's plugin is open, under a server's `listen` or a worker's `start`. Run migrations from a script on a worker, as the [complete service](#a-complete-service)'s `migrate.ts` does: it runs before the service starts, closes in a `finally` block, and so the service's own database account needs no right to change the schema. Write migrations that can run twice, or keep your own table of applied versions. The [data example](../../examples/data/README.md) does the same on SQLite and PostgreSQL, and on a failure its script prints one line of codes only, such as `migrate failed: PLUGIN_FAILED CONNECT_FAILED socket` when nothing answers at the database's address.

## Limit requests per client address

`limitRoutes` from `@skeld/data/limit` counts requests per client address in a fixed window and refuses the ones over the limit with 429, before the request body is read. The counts live in a table of a database you name.

```ts
import { defineContract } from '@skeld/core/contract';
import * as t from '@skeld/core/schema';
import { createServer } from '@skeld/core/server';
import { installLimitTable, limitRoutes } from '@skeld/data/limit';
import { createSqliteDatabase } from '@skeld/data/sqlite';

const contract = defineContract({
  signIn: {
    method: 'POST',
    path: '/sign-in',
    body: t.object({ email: t.string({ maxLength: 320 }) }),
    responses: { 204: null },
  },
});

const limits = createSqliteDatabase({ path: ':memory:' });
const server = createServer();
server.register(limits.plugin);
server.register(async (scope) => {
  await installLimitTable(limits, scope);
});
limitRoutes(server, {
  database: limits,
  rules: { sign_in: { max: 10, windowSeconds: 60, routes: [contract.signIn] } },
});
server.routes(contract, { signIn: () => ({ status: 204 }) });
```

The order matters. Plugins run in the order they are registered, and `limitRoutes` registers a plugin of its own that reads the table, so the database's plugin and the table must both come before it. With the table missing, `listen` rejects with `PLUGIN_FAILED`:

```text
Plugin limitRoutes failed: Limit table could not be read: call installLimitTable once, and register the database's plugin before limitRoutes
```

- `installLimitTable` creates the table and its index when they do not exist, and the limiter never creates them itself. On PostgreSQL it creates the schema `skeld_data` and the unlogged table `skeld_data.limit_windows`, and needs the right to create a schema; run it once, as a migration. On SQLite the table is `skeld_data_limit_windows`.
- A rule names a count, a window in seconds and its routes, taken from your contract so a misspelt route does not compile. The routes of one rule share one count per address, and a route belongs to one rule at most.
- `limitRoutes` throws `BootError` `INVALID_OPTION` for a bad rule. A rule that names a route the server does not serve makes `listen` reject with `PLUGIN_FAILED`: `Server failed in onRoutes: Limit rule sign_in names POST /sign-in, which no route under this scope serves`.
- The counted address is `clientAddress`: an IPv4 address, or the first four groups (the /64) of an IPv6 address. Behind a proxy, set core's `trustProxy`, or every client counts as the proxy.
- A refused request is still counted, up to the rule's maximum plus one, and the window's end never moves. Each process remembers up to 10,000 refused addresses until their window ends and refuses them again without a query.

### On SQLite, give the limiter its own in-memory database

On a SQLite file every charge is a commit that waits for the disk, about 18 ms on the main thread on the test host, and it waits behind any open write transaction on the same file. Give the limiter its own `createSqliteDatabase({ path: ':memory:' })`, as above. Its counts are then per process and start again when the process restarts, so install the table at every boot. To share counts between processes, use a PostgreSQL database. Its table is unlogged, so a PostgreSQL crash or failover empties it and every window starts again.

### What your hooks see

| Outcome              | The client sees                                                   | Record                             | Error handlers and `onError` | `onResponse` |
| -------------------- | ----------------------------------------------------------------- | ---------------------------------- | ---------------------------- | ------------ |
| Refused              | 429 `RATE_LIMITED`, `Too many requests`, `retry-after` in seconds | `data.limit.refused` (`warn`)      | not called                   | not called   |
| Store failed or slow | 503 `LIMIT_UNAVAILABLE`, `Service unavailable`                    | `data.limit.unavailable` (`error`) | called                       | called       |

The 429 is sent directly from the limiter's `onRequest` hook, as a hook's `context.send` is, so its record is the only trace your code gets. The 503 is thrown, so it takes core's error path. A charge that takes longer than `chargeTimeoutMs` (default 1,000 ms) answers 503 too, and may have been counted. A store failure is never a pass, and the handler runs in neither case.

## Run auth's PostgreSQL store on the same pool

```ts
import { createPostgresStore } from '@skeld/auth/postgres';
import { Secret } from '@skeld/core/secret';
import { toPgPool } from '@skeld/data/pg-pool';
import { createPostgresDatabase } from '@skeld/data/postgres';

const db = createPostgresDatabase({ url: new Secret(process.env.DATABASE_URL ?? '') });
export const store = createPostgresStore({ pool: toPgPool(db) });
```

`toPgPool` gives `@skeld/auth/postgres` the pool shape it takes, running on the database's own connections and bounds, so your queries and auth's share `maxConnections`. Auth's `maxClients` defaults to half of it. Register `db.plugin` on the server: plugins run before authentication starts, so the pool is open when auth connects to its store. `store.install()` needs the pool open too, so call it from a plugin registered after `db.plugin`, or from a migration script on a worker after `start`; there, close the store with its own `close()` before the worker closes, since a started worker takes no more `onClose` callbacks. `toPgPool` throws `BootError` `INVALID_OPTION` for a SQLite database.

## Handle failures

Every failure is a `DataError` from `@skeld/data/data-error`, with `code`, `status`, and `sqlState` (PostgreSQL's SQLSTATE) or `sqliteCode` where the database gave one. An uncaught one is answered by core:

- 503 `Service unavailable` with the code for `POOL_FULL`, `POOL_TIMEOUT`, `POOL_CLOSED`, `CONNECT_FAILED` and `CONNECTION_LOST`: the database is out of capacity or unreachable.
- The fixed 500 for every other code.

```ts
import { DataError, exposeDetail } from '@skeld/data/data-error';

export function isUniqueViolation(error: unknown): boolean {
  return error instanceof DataError && error.code === 'QUERY_FAILED' && error.sqlState === '23505';
}

export function constraintOf(error: DataError): string | null {
  return exposeDetail(error)?.constraint ?? null;
}
```

The error's message is fixed by its code. What the database said (its message, detail, hint, the table, column and constraint, and the statement's text) is read only through `exposeDetail`; `JSON.stringify` and `util.inspect` of the error show none of it. It can hold values from the statement and names from your schema, so never log or send it whole. The [reference](../reference/data.md#errors) gives all 15 codes.

Data writes its own records through the logger of the work's owner: `data.statement.failed`, `data.connect.failed` and `data.connection.closed`, with the code, the engine and the SQLSTATE or SQLite code, and never a value or the statement's text.

### What the PostgreSQL server logs

Data keeps values and statement text out of your service's logs. The PostgreSQL server keeps its own log, which data does not control:

- `log_min_error_statement` defaults to `ERROR`, so the text of every failing statement is in the server's log, with placeholders but not values.
- `log_statement` (default `none`) and `log_min_duration_statement` (default `-1`, off) log statements, and with them each parameter's value, up to `log_parameter_max_length` (default `-1`, in full).
- `log_parameter_max_length_on_error` (default `0`) adds parameter values to error messages when it is set above 0.

If your queries carry personal or secret values, keep those settings at their defaults or set `log_parameter_max_length` to `0`, and treat the server log as holding statement text.

## Shut down

There is no `close` on a database. `server.close()` first lets HTTP requests finish, then runs the database's cleanup; a worker's `close()` runs it directly. Either runs it with the scope's `closeTimeoutMs` (the `pluginCloseTimeoutMs` option, default 10,000 ms). The pool refuses new and waiting calls with `POOL_CLOSED`, waits up to 0.4 of that time for connections still in use, cancels their statements for up to 0.1 more, then closes every connection. A second `close()` resolves with the first.

## Not included

- An ORM, a query builder, migration bookkeeping or a migration lock helper.
- Databases other than PostgreSQL and SQLite, and use of a database without a skeld server or worker.
- On PostgreSQL: `COPY`, `LISTEN` and `NOTIFY`, cursors and streamed results, named prepared statements, binary results, Unix sockets, client certificates, several hosts, and sign-in methods other than SCRAM-SHA-256.
- A savepoint or nested-transaction API, and automatic retries.
- A SQLite worker thread or a way to interrupt a running SQLite statement.
- For the limiter: sliding windows, keys other than the client address, and `RateLimit` headers.
- Tested behavior behind a connection pooler or against a managed provider.

**Next:** [data behavior reference](../reference/data.md). Signatures: [data API reference](../api/README.md#data-api).
