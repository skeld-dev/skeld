// Does:  Proves a failed transaction leaves no write and a rolled-back commit never resolves, on PostgreSQL and SQLite.
// Holds: Rows are counted by a connection the package does not own; a control transaction shows a commit still lands.

import { randomBytes } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
// biome-ignore lint/correctness/noUnresolvedImports: Biome's Node module list lacks node:sqlite, which Node 26 ships
import { DatabaseSync } from 'node:sqlite';
import { Secret } from '@skeld/core/secret';
import { createServer } from '@skeld/core/server';
import type { Database, Owner } from '@skeld/data/database';
import { createPostgresDatabase } from '@skeld/data/postgres';
import { sql } from '@skeld/data/sql';
import { createSqliteDatabase } from '@skeld/data/sqlite';
import { Client } from 'pg';
import { check, createReport } from '../support/support-proof.ts';

const url = new URL(process.env.SKELD_TEST_PG19_URL ?? '');
const ca = readFileSync(process.env.SKELD_TEST_PG19_CA ?? '', 'utf8');
const report = createReport();

interface Engine {
  readonly kind: string;
  readonly db: Database;
  readonly owner: Owner;
  readonly rows: () => Promise<number>;
  readonly reset: () => Promise<void>;
}

async function boot(db: Database): Promise<{ owner: Owner; close: () => Promise<void> }> {
  const server = createServer({ log: false });
  server.register(db.plugin);
  let owner: Owner | undefined;
  server.register((scope) => {
    owner = { signal: new AbortController().signal, log: scope.log };
  });
  await server.listen({ port: 0, host: '127.0.0.1' });
  if (owner === undefined) {
    throw new Error('the plugin did not run');
  }
  return { owner, close: () => server.close() };
}

async function outcome(run: () => Promise<unknown>): Promise<{ threw: boolean; error: unknown }> {
  try {
    await run();
    return { threw: false, error: undefined };
  } catch (error) {
    return { threw: true, error };
  }
}

const codeOf = (error: unknown): string =>
  typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : 'not a data error';

async function cases(engine: Engine): Promise<void> {
  const { kind, db, owner } = engine;

  await engine.reset();
  const marker = new Error('callback failed');
  const thrown = await outcome(() =>
    db.for(owner).transaction(async (tx) => {
      await tx.query(sql`insert into t (id) values (1)`);
      throw marker;
    }),
  );
  const a: string[] = [];
  check(a, thrown.threw && thrown.error === marker, "the callback's own error was not rethrown as it was");
  check(a, (await engine.rows()) === 0, `${await engine.rows()} row(s) survived a callback that threw`);
  report.result(`${kind}: a write does not survive a callback that throws`, a, 'rethrown, 0 rows');

  await engine.reset();
  let caught = 'none';
  const swallowed = await outcome(() =>
    db.for(owner).transaction(async (tx) => {
      await tx.query(sql`insert into t (id) values (1)`);
      try {
        await tx.query(sql`insert into t (id) values (1)`);
      } catch (error) {
        caught = codeOf(error);
      }
    }),
  );
  const b: string[] = [];
  check(b, caught === 'QUERY_FAILED', `the duplicate insert did not fail as the proof needs (${caught})`);
  check(
    b,
    swallowed.threw && codeOf(swallowed.error) === 'TRANSACTION_FAILED',
    `a commit after a caught failure ended ${swallowed.threw ? codeOf(swallowed.error) : 'resolved'}, not TRANSACTION_FAILED`,
  );
  check(b, (await engine.rows()) === 0, `${await engine.rows()} row(s) survived a transaction whose statement failed`);
  report.result(`${kind}: a commit that rolled back never resolves`, b, 'TRANSACTION_FAILED, 0 rows');

  await engine.reset();
  const open = await outcome(() =>
    db.for(owner).transaction(async (tx) => {
      await tx.query(sql`insert into t (id) values (1)`);
      await tx.query(sql`insert into t (id) values (1)`);
    }),
  );
  const c: string[] = [];
  check(
    c,
    open.threw && codeOf(open.error) === 'QUERY_FAILED',
    `an uncaught statement failure ended ${open.threw ? codeOf(open.error) : 'resolved'}, not QUERY_FAILED`,
  );
  check(c, (await engine.rows()) === 0, `${await engine.rows()} row(s) survived an uncaught statement failure`);
  report.result(`${kind}: an uncaught statement failure leaves no write`, c, 'QUERY_FAILED, 0 rows');

  await engine.reset();
  const control = await outcome(() =>
    db.for(owner).transaction(async (tx) => {
      await tx.query(sql`insert into t (id) values (1)`);
      await tx.query(sql`insert into t (id) values (2)`);
    }),
  );
  const d: string[] = [];
  check(d, !control.threw, `the control transaction ended ${codeOf(control.error)}`);
  check(d, (await engine.rows()) === 2, `the control transaction left ${await engine.rows()} row(s), not 2`);
  report.result(`${kind}: control, a transaction with no failure commits both writes`, d, '2 rows');
}

async function postgres(): Promise<void> {
  const name = `data_tx_${randomBytes(4).toString('hex')}`;
  const side = (database: string, application: string): Client => {
    const client = new Client({
      host: url.hostname,
      port: Number(url.port),
      user: decodeURIComponent(url.username),
      password: decodeURIComponent(url.password),
      database,
      application_name: application,
      ssl: { ca },
    });
    client.on('error', () => undefined);
    return client;
  };
  const admin = side('postgres', 'data_tx_admin');
  await admin.connect();
  await admin.query(`create database ${name}`);
  const reader = side(name, 'data_tx_reader');
  await reader.connect();
  await reader.query('create table t (id int primary key)');
  const user = encodeURIComponent(decodeURIComponent(url.username));
  const password = encodeURIComponent(decodeURIComponent(url.password));
  const db = createPostgresDatabase({
    url: new Secret(`postgres://${user}:${password}@${url.hostname}:${url.port}/${name}?application_name=data_tx_pool`),
    tls: { ca },
  });
  const booted = await boot(db);
  try {
    await cases({
      kind: 'postgresql',
      db,
      owner: booted.owner,
      rows: async () => Number((await reader.query('select count(*)::int as n from t')).rows[0]?.n),
      reset: async () => {
        await reader.query('truncate t');
      },
    });
  } finally {
    await booted.close();
    await reader.end();
    await admin.query(`drop database if exists ${name} with (force)`);
    await admin.end();
  }
}

async function sqlite(): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), 'data-tx-'));
  const path = join(dir, 'tx.db');
  const db = createSqliteDatabase({ path });
  const booted = await boot(db);
  const reader = new DatabaseSync(path);
  reader.exec('pragma busy_timeout = 5000');
  try {
    await db.for(booted.owner).reserve(async (connection) => {
      await connection.script('create table t (id integer primary key)');
    });
    await cases({
      kind: 'sqlite',
      db,
      owner: booted.owner,
      rows: async () => Number(reader.prepare('select count(*) as n from t').get()?.n),
      reset: async () => {
        await db.for(booted.owner).query(sql`delete from t`);
      },
    });
  } finally {
    await booted.close();
    reader.close();
    rmSync(dir, { recursive: true, force: true });
  }
}

try {
  await postgres();
  await sqlite();
} catch (error) {
  report.result(
    'the script ran to the end',
    [error instanceof Error ? `${error.name}: ${error.message.slice(0, 300)}` : 'threw'],
    '',
  );
}
report.finish();
