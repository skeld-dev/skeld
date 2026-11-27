import { randomUUID } from 'node:crypto';
import { HttpError } from '@skeld/core/http-error';
import type { LogSink } from '@skeld/core/log';
import { createServer, type Scope } from '@skeld/core/server';
import * as t from '@skeld/core/schema';
import type { Database } from '@skeld/data/database';
import { installLimitTable, limitRoutes } from '@skeld/data/limit';
import { sql } from '@skeld/data/sql';
import { createSqliteDatabase } from '@skeld/data/sqlite';
import { Account, bankContract } from './contract.ts';
import { openDatabase } from './database.ts';

export interface ExampleOptions {
  // 0 picks a free port.
  readonly port: number;
  // The SQLite file used when DATABASE_URL is not set; its folder must exist.
  readonly sqlitePath: string;
  readonly logSink?: LogSink;
}

const AccountId = t.object({ id: t.string({ maxLength: 64 }) });

export async function startExample(options: ExampleOptions) {
  const db = openDatabase(options.sqlitePath);
  // On SQLite every limit charge would be a commit with an fsync on the application's file, queued behind its
  // writes, so the limiter gets its own in-memory database. Its counts restart with the process.
  // On PostgreSQL the limiter shares the application's database, and every process shares its counts.
  const limits = db.engine === 'sqlite' ? createSqliteDatabase({ path: ':memory:' }) : db;

  const server = createServer(
    options.logSink === undefined ? { log: { access: true } } : { log: { access: true, sink: options.logSink } },
  );
  // Plugins run in registration order: the databases open first, then the boot check, then the limiter's boot.
  server.register(db.plugin);
  if (limits !== db) {
    server.register(limits.plugin);
  }
  server.register(async (scope) => checkDatabase(scope, db, limits));

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

// The boot check. The service creates nothing in the application's database: migrate.ts does that, before the
// service starts. Each statement fails on a missing table, so listen rejects with PLUGIN_FAILED on a database the
// script has not run on, instead of every request failing later.
async function checkDatabase(scope: Scope, db: Database, limits: Database): Promise<void> {
  const app = db.for(scope);
  await app.query(sql`select id from accounts limit 0`);
  await app.query(sql`select id from transfers limit 0`);
  if (limits !== db) {
    // On SQLite the limiter's database is in memory and starts empty, so its table is created at every start.
    await installLimitTable(limits, scope);
  }
}
