# @skeld/data

Database access for Skeld services: PostgreSQL and SQLite behind one API. Queries are written only with the `sql` tagged template, so every interpolated value is sent as a parameter and never as query text. Rows are checked against a core schema or typed `unknown`, transactions and reserved connections are callbacks, and every failure is a `DataError` with a fixed code and message that keeps what the database said out of responses and logs. It also has a rate limiter whose counts live in the database, and a pool for `@skeld/auth`'s PostgreSQL store.

On PostgreSQL it speaks the protocol itself and connects only over TLS with the server's certificate and host name verified, unless your code turns that off by name; it signs in with SCRAM-SHA-256 only. SQLite runs through Node's built-in `node:sqlite`, on the main thread. It is not an ORM, a query builder or a migration tool.

## Install

```sh
npm install @skeld/data
```

Requires Node.js 26.12+ and an ES module project. Its one dependency is `@skeld/core`, at the exact version it was released with. Tested against PostgreSQL 19 and the SQLite bundled with Node 26.13.

- [Store data in PostgreSQL or SQLite](../../docs/guides/data.md): connecting, queries, transactions, migrations, the limiter and auth's pool.
- [Data behavior reference](../../docs/reference/data.md): options, the connection URL, error codes, value tables and the limiter.

[Website & documentation](https://skeld.dev) · [GitHub repository](https://github.com/skeld-dev/skeld)
