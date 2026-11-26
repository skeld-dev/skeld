// Does:  Runs auth's store conformance kit on a store over toPgPool of a data pool on PostgreSQL 19, counting sessions.
// Holds: Zero failed or skipped cases, every store session has the pool's application name, and close leaves none.

import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createPostgresStore } from '@skeld/auth/postgres';
import { type ConformanceReport, type ConformanceTarget, runStoreConformance } from '@skeld/auth/store-conformance';
import { Secret } from '@skeld/core/secret';
import { createServer } from '@skeld/core/server';
import { toPgPool } from '@skeld/data/pg-pool';
import { createPostgresDatabase } from '@skeld/data/postgres';
import { Client } from 'pg';
import { createReport } from '../auth/rig/report.ts';

const statement =
  "Auth's store conformance kit passes with zero failed cases on a store built over toPgPool of a data pool on PostgreSQL 19, every store session carries the pool's application name, and one server.close() leaves none";

const keyColumns = {
  subjects: 'user_id',
  sessions: 'digest',
  api_keys: 'key_id',
  limit_windows: 'key',
  oidc_attempts: 'state_digest',
} as const;
const operations = [
  'subjectEnsure',
  'subjectRead',
  'subjectDisable',
  'subjectEnable',
  'subjectInvalidate',
  'sessionIssue',
  'sessionRead',
  'sessionRenew',
  'sessionRotate',
  'sessionRevoke',
  'apiKeyIssue',
  'apiKeyRead',
  'apiKeyList',
  'apiKeyRevoke',
  'limitCharge',
  'attemptCreate',
  'attemptConsume',
  'expiredRemove',
];
const SIDE = 'vd_side';
const ADMIN = 'vd_admin';
const POOL_MAX = 10;

const urlText = process.env.SKELD_TEST_PG19_URL;
const caFile = process.env.SKELD_TEST_PG19_CA;
if (urlText === undefined || urlText === '' || caFile === undefined || caFile === '') {
  throw new Error('SKELD_TEST_PG19_URL and SKELD_TEST_PG19_CA are required: a PostgreSQL 19 fixture is not optional');
}
const base = new URL(urlText);
const ca = readFileSync(caFile, 'utf8');
const name = `vd_auth_${randomBytes(5).toString('hex')}`;
const poolName = `vd_pool_${randomBytes(4).toString('hex')}`;

function side(application: string, target: string): Client {
  return new Client({
    host: base.hostname,
    port: Number(base.port),
    user: decodeURIComponent(base.username),
    password: decodeURIComponent(base.password),
    database: target,
    application_name: application,
    ssl: { ca },
  });
}

function poolUrl(): string {
  const url = new URL(base);
  url.pathname = `/${name}`;
  url.search = '';
  url.searchParams.set('application_name', poolName);
  return url.toString();
}

function operationOf(caseName: string): string {
  return caseName.slice(0, caseName.indexOf('.'));
}

const report = createReport(statement);
const admin = side(ADMIN, 'postgres');
await admin.connect();
await admin.query(`CREATE DATABASE ${name}`);
const control = side(SIDE, name);
await control.connect();

const database = createPostgresDatabase({
  url: new Secret(poolUrl()),
  tls: { ca },
  maxConnections: POOL_MAX,
});
const server = createServer({ log: { access: false } });
server.register(database.plugin);
await server.listen({ port: 0, host: '127.0.0.1' });

// Does:  Reads every client backend on the store's database that is neither this reader nor a named side connection.
async function strangers(): Promise<{ pool: number; others: string[] }> {
  const rows = await control.query<{ application_name: string; n: number }>(
    `SELECT application_name, count(*)::int AS n FROM pg_stat_activity
      WHERE datname = $1 AND backend_type = 'client backend' AND pid <> pg_backend_pid() AND application_name <> $2
      GROUP BY application_name`,
    [name, SIDE],
  );
  let pool = 0;
  const others: string[] = [];
  for (const row of rows.rows) {
    if (row.application_name === poolName) {
      pool += row.n;
    } else {
      others.push(`${row.application_name === '' ? '(empty)' : row.application_name} x${row.n}`);
    }
  }
  return { pool, others };
}

let peak = 0;
const foreign = new Set<string>();
async function sample(): Promise<void> {
  const seen = await strangers();
  peak = Math.max(peak, seen.pool);
  for (const other of seen.others) {
    foreign.add(other);
  }
}

const holders = new Set<Promise<unknown>>();

async function make(): Promise<ConformanceTarget> {
  // Why: Cases run one after another on one pool, so a fresh schema isolates them without a database per case.
  await control.query('DROP SCHEMA IF EXISTS skeld_auth CASCADE');
  const store = createPostgresStore({ pool: toPgPool(database), cleanupIntervalSeconds: 3600 });
  return {
    store,
    lockScope: 'row',
    holdLock: async (table, key, ms) => {
      const holder = side(SIDE, name);
      await holder.connect();
      try {
        await holder.query('BEGIN');
        const locked = await holder.query(
          `SELECT 1 FROM skeld_auth.${table} WHERE ${keyColumns[table]} = $1 FOR UPDATE`,
          [key],
        );
        if (locked.rowCount !== 1) {
          throw new Error('row to lock is absent');
        }
      } catch (error) {
        await holder.end();
        throw error;
      }
      // Why: The kit continues once the lock is held; the holder lets go after ms, in the background.
      holders.add(
        new Promise<void>((resolve) => setTimeout(resolve, ms))
          .then(() => holder.query('COMMIT'))
          .then(() => holder.end())
          .catch(() => undefined),
      );
    },
    writeVersions: async (versions) => {
      await control.query('DELETE FROM skeld_auth.schema_version');
      for (const version of versions) {
        // biome-ignore lint/performance/noAwaitInLoops: the rows are written in the order given
        await control.query('INSERT INTO skeld_auth.schema_version (version) VALUES ($1)', [version]);
      }
    },
    dispose: async () => {
      await Promise.all(holders);
      holders.clear();
      await sample();
      await store.close();
    },
  };
}

let closed = false;
try {
  await report.run('conformance', async () => {
    const started = performance.now();
    const outcome: ConformanceReport = await runStoreConformance(make);
    const seconds = ((performance.now() - started) / 1000).toFixed(1);
    report.note(
      `PostgreSQL 19 on toPgPool: ${outcome.passed.length} passed, ${outcome.failed.length} failed, ${outcome.skipped.length} skipped (${seconds} s)`,
    );
    for (const failure of outcome.failed) {
      report.note(`  failed ${failure.name}: ${failure.detail.slice(0, 300)}`);
    }
    for (const skipped of outcome.skipped) {
      report.note(`  skipped ${skipped}`);
    }
    report.check('zero failed cases', outcome.failed.length === 0, `${outcome.failed.length} failed`);
    report.check('ran cases at all', outcome.passed.length > 100, `${outcome.passed.length} passed`);
    // Why: This target has a lock hook and a version hook, so the kit has no case it cannot run.
    report.check('skipped no case', outcome.skipped.length === 0, `${outcome.skipped.length} skipped`);
    const uncovered = operations.filter((operation) => !outcome.passed.some((n) => operationOf(n) === operation));
    report.check(
      'every one of the 18 operations has a passed case',
      uncovered.length === 0,
      uncovered.join(',') || 'all 18',
    );
    const closing = ['attach.after-close', 'install.after-close', 'close.twice', 'close.outstanding'];
    const missing = closing.filter((n) => !outcome.passed.includes(n));
    report.check('the closed-store cases pass', missing.length === 0, missing.join(',') || `${closing.length} passed`);
  });

  await sample();
  report.check(
    "every session on the store's database carries the pool's application name",
    foreign.size === 0,
    foreign.size === 0 ? 'no other session seen' : [...foreign].join(', '),
  );
  report.check('the pool opened sessions on the store database', peak > 0, `peak ${peak} of at most ${POOL_MAX}`);
  report.check('the pool stayed within its bound', peak <= POOL_MAX, `peak ${peak}`);

  await server.close();
  closed = true;
  // Why: The server reaps a backend after its socket closes, so the count is read until it settles or 5 s pass.
  let left = (await strangers()).pool;
  const first = left;
  for (let polls = 0; left > 0 && polls < 500; polls++) {
    // biome-ignore lint/performance/noAwaitInLoops: each poll reads the server's state after the last one
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
    left = (await strangers()).pool;
  }
  report.check(
    'one server.close() leaves 0 sessions of the pool',
    left === 0,
    `first read ${first}, settled at ${left}`,
  );
} finally {
  if (!closed) {
    await server.close();
  }
  await control.end();
  await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
  await admin.end();
}
report.finish();
