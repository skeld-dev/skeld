import { createPostgresStore } from '@skeld/auth/postgres';
import type { LogSink } from '@skeld/core/log';
import { createWorker, type Worker } from '@skeld/core/worker';
import type { Database } from '@skeld/data/database';
import { installLimitTable } from '@skeld/data/limit';
import { toPgPool } from '@skeld/data/pg-pool';
import { sql } from '@skeld/data/sql';
import { openDatabase } from './database.ts';

export interface MigrateOptions {
  // The SQLite file used when DATABASE_URL is not set; its folder must exist.
  readonly sqlitePath: string;
  // Takes the worker's JSON log instead of stdout.
  readonly logSink?: LogSink;
}

// The schema step, run before the service starts. It runs the database's plugin on a worker, which never
// listens, so the service's own database account needs no right to change the schema. Every statement leaves
// an existing database as it is, so running it twice changes nothing.
export async function migrate(options: MigrateOptions): Promise<'sqlite' | 'postgres'> {
  const db = openDatabase(options.sqlitePath);
  const worker = createWorker(options.logSink === undefined ? {} : { log: { sink: options.logSink } });
  worker.register(db.plugin);
  // A start that fails has already closed the worker and the database.
  await worker.start();
  try {
    await createTables(db, worker);
    if (db.engine === 'postgres') {
      // On SQLite the service keeps the limiter's table in memory and creates it itself at every start.
      await installLimitTable(db, worker);
      await installAuthStore(db);
    }
  } finally {
    await worker.close();
  }
  return db.engine;
}

async function createTables(db: Database, worker: Worker): Promise<void> {
  const app = db.for(worker);
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
}

// auth's tables, in the same database and over the same pool. The store is closed here, before the worker
// closes the pool, since a started worker takes no more onClose callbacks.
async function installAuthStore(db: Database): Promise<void> {
  const store = createPostgresStore({ pool: toPgPool(db) });
  try {
    const installed = await store.install();
    if (installed.kind === 'mismatch') {
      throw new Error(`auth store holds schema version ${installed.found}`);
    }
  } finally {
    await store.close();
  }
}
