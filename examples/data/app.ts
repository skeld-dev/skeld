import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createPostgresStore } from '@skeld/auth/postgres';
import { HttpError } from '@skeld/core/http-error';
import type { LogSink } from '@skeld/core/log';
import { Secret } from '@skeld/core/secret';
import { createServer, type Scope } from '@skeld/core/server';
import * as t from '@skeld/core/schema';
import type { Database } from '@skeld/data/database';
import { installLimitTable, limitRoutes } from '@skeld/data/limit';
import { toPgPool } from '@skeld/data/pg-pool';
import { createPostgresDatabase } from '@skeld/data/postgres';
import { sql } from '@skeld/data/sql';
import { createSqliteDatabase } from '@skeld/data/sqlite';
import { Account, bankContract } from './contract.ts';

export interface ExampleOptions {
  // 0 picks a free port.
  readonly port: number;
  // The SQLite file used when DATABASE_URL is not set; its folder must exist.
  readonly sqlitePath: string;
  readonly logSink?: LogSink;
}

const AccountId = t.object({ id: t.string({ maxLength: 64 }) });

// DATABASE_URL selects PostgreSQL over verified TLS; DATABASE_CA_FILE names the server's CA certificate (PEM)
// when it is not one of Node's bundled roots. Without DATABASE_URL the service runs on a SQLite file.
function openDatabase(sqlitePath: string): Database {
  const url = process.env.DATABASE_URL;
  if (url === undefined || url === '') {
    return createSqliteDatabase({ path: sqlitePath });
  }
  const caFile = process.env.DATABASE_CA_FILE;
  return createPostgresDatabase({
    url: new Secret(url),
    ...(caFile === undefined || caFile === '' ? {} : { tls: { ca: readFileSync(caFile, 'utf8') } }),
  });
}

export async function startExample(options: ExampleOptions) {
  const db = openDatabase(options.sqlitePath);
  // On SQLite every limit charge would be a commit with an fsync on the application's file, queued behind its
  // writes, so the limiter gets its own in-memory database. Its counts restart with the process.
  // On PostgreSQL the limiter shares the application's database, and every process shares its counts.
  const limits = db.engine === 'sqlite' ? createSqliteDatabase({ path: ':memory:' }) : db;

  const server = createServer(
    options.logSink === undefined ? { log: { access: true } } : { log: { access: true, sink: options.logSink } },
  );
  // Plugins run in registration order: the databases open first, then the setup step, then the limiter's boot.
  server.register(db.plugin);
  if (limits !== db) {
    server.register(limits.plugin);
  }
  server.register(async (scope) => setUp(scope, db, limits));

  limitRoutes(server, {
    database: limits,
    rules: { transfers: { max: 5, windowSeconds: 10, routes: [bankContract.createTransfer] } },
  });

  server.routes(bankContract, {
    listAccounts: async (request) => {
      const accounts = await db
        .for(request)
        .query(sql`select id, balance from accounts order by id limit 100`, Account);
      return { status: 200, body: { accounts: [...accounts] } };
    },

    getAccount: async (request) => {
      const [account] = await db
        .for(request)
        .query(sql`select id, balance from accounts where id = ${request.params.id}`, Account);
      if (account === undefined) {
        return { status: 404, body: { status: 404, code: 'ACCOUNT_NOT_FOUND', message: 'No such account' } };
      }
      return { status: 200, body: account };
    },

    createTransfer: async (request) => {
      const { from, to, amount } = request.body;
      // Both balances change or neither does: a throw inside the callback rolls the transaction back.
      const transfer = await db.for(request).transaction(async (tx) => {
        const debited = await tx.query(
          sql`update accounts set balance = balance - ${amount} where id = ${from} and balance >= ${amount} returning id`,
          AccountId,
        );
        if (debited.length === 0) {
          throw new HttpError(409, 'TRANSFER_REFUSED', 'Unknown source account or insufficient balance');
        }
        const credited = await tx.query(
          sql`update accounts set balance = balance + ${amount} where id = ${to} returning id`,
          AccountId,
        );
        if (credited.length === 0) {
          throw new HttpError(404, 'ACCOUNT_NOT_FOUND', 'No such account');
        }
        const id = randomUUID();
        await tx.query(
          sql`insert into transfers (id, from_account, to_account, amount, created_at)
              values (${id}, ${from}, ${to}, ${amount}, ${new Date()})`,
        );
        return { id, from, to, amount };
      });
      return { status: 201, body: transfer };
    },
  });

  const address = await server.listen({ port: options.port, host: '127.0.0.1' });
  return { url: address.url, engine: db.engine, close: () => server.close() };
}

// The schema step. A deployed service runs it once, as a migration before it starts; this example runs it at
// every start, and every statement in it leaves an existing database unchanged.
async function setUp(scope: Scope, db: Database, limits: Database): Promise<void> {
  const app = db.for(scope);
  await app.query(sql`create table if not exists accounts (
    id text primary key,
    balance integer not null check (balance >= 0)
  )`);
  await app.query(sql`create table if not exists transfers (
    id text primary key,
    from_account text not null references accounts (id),
    to_account text not null references accounts (id),
    amount integer not null check (amount > 0),
    created_at text not null
  )`);
  await app.query(sql`insert into accounts (id, balance) values (${'alice'}, ${100}), (${'bob'}, ${50})
    on conflict (id) do nothing`);
  await installLimitTable(limits, scope);

  if (db.engine === 'postgres') {
    // auth's store on the same pool: its tables sit in the same database and its statements use the pool's
    // connections. Give it to createAuth({ store, origin }) to sign people in (see examples/auth).
    const store = createPostgresStore({ pool: toPgPool(db) });
    scope.onClose(() => store.close());
    const installed = await store.install();
    if (installed.kind === 'mismatch') {
      throw new Error(`auth store holds schema version ${installed.found}`);
    }
  }
}
