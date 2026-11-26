// Does:  Proves the pool holds its bound, cancels an abandoned request's statement and leaves no session after close.
// Holds: Sessions are counted on the server by a connection the pool does not own; every wait is on a signal.

import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { connect } from 'node:net';
import { defineContract } from '@skeld/core/contract';
import * as t from '@skeld/core/schema';
import { Secret } from '@skeld/core/secret';
import { createServer } from '@skeld/core/server';
import { createPostgresDatabase } from '@skeld/data/postgres';
import { sql } from '@skeld/data/sql';
import { Client } from 'pg';
import { check, createReport } from '../support/support-proof.ts';

const url = new URL(process.env.SKELD_TEST_PG19_URL ?? '');
const ca = readFileSync(process.env.SKELD_TEST_PG19_CA ?? '', 'utf8');
const report = createReport();
const databaseName = `data_pcs_${randomBytes(4).toString('hex')}`;

const contract = defineContract({
  hold: { method: 'GET', path: '/hold', responses: { 200: t.object({ ok: t.boolean() }) } },
  forever: { method: 'GET', path: '/forever', responses: { 200: t.object({ ok: t.boolean() }) } },
});

function client(database: string, applicationName: string): Client {
  const side = new Client({
    host: url.hostname,
    port: Number(url.port),
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database,
    application_name: applicationName,
    ssl: { ca },
  });
  side.on('error', () => undefined);
  return side;
}

function poolUrl(applicationName: string): Secret<string> {
  const user = encodeURIComponent(decodeURIComponent(url.username));
  const password = encodeURIComponent(decodeURIComponent(url.password));
  return new Secret(
    `postgres://${user}:${password}@${url.hostname}:${url.port}/${databaseName}?application_name=${applicationName}`,
  );
}

async function until(test: () => Promise<boolean> | boolean, deadlineMs: number): Promise<boolean> {
  const end = Date.now() + deadlineMs;
  while (Date.now() < end) {
    // biome-ignore lint/performance/noAwaitInLoops: A poll tests once per step, in order.
    if (await test()) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  return test();
}

interface Answer {
  readonly status: number;
  readonly body: string;
}

function get(port: number, path: string): Promise<Answer> {
  return new Promise((resolve) => {
    const socket = connect({ host: '127.0.0.1', port });
    const chunks: Buffer[] = [];
    socket.on('data', (chunk: Buffer) => chunks.push(chunk));
    socket.on('error', () => undefined);
    socket.on('close', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      resolve({ status: Number(/^HTTP\/1\.1 (\d+)/.exec(raw)?.[1] ?? 0), body: raw.split('\r\n\r\n')[1] ?? '' });
    });
    socket.write(`GET ${path} HTTP/1.1\r\nhost: x\r\nconnection: close\r\n\r\n`);
  });
}

async function sessions(probe: Client, applicationName: string): Promise<number> {
  const result = await probe.query(
    'select count(*)::int as n from pg_stat_activity where application_name = $1 and pid <> pg_backend_pid()',
    [applicationName],
  );
  return Number(result.rows[0]?.n);
}

async function sleeping(probe: Client, applicationName: string, marker: string): Promise<number | null> {
  const result = await probe.query(
    "select pid from pg_stat_activity where application_name = $1 and state = 'active' and query like $2",
    [applicationName, `%${marker}%`],
  );
  const pid = result.rows[0]?.pid;
  return pid === undefined ? null : Number(pid);
}

// Does:  Sends 8 requests at a pool of 3 connections that can queue them all, and samples the sessions it opens.
async function bound(probe: Client): Promise<void> {
  const problems: string[] = [];
  const app = 'data_pcs_bound';
  const db = createPostgresDatabase({
    url: poolUrl(app),
    tls: { ca },
    maxConnections: 3,
    maxWaiters: 10,
    acquireTimeoutMs: 30_000,
  });
  const server = createServer({ log: false });
  server.register(db.plugin);
  server.routes(contract, {
    hold: async (request) => {
      await db.for(request).query(sql`select pg_sleep(0.5)`);
      return { status: 200, body: { ok: true } };
    },
    forever: () => ({ status: 200, body: { ok: true } }),
  });
  const { port } = await server.listen({ port: 0, host: '127.0.0.1' });
  try {
    let largest = 0;
    let done = false;
    const answers = Promise.all(Array.from({ length: 8 }, () => get(port, '/hold'))).finally(() => {
      done = true;
    });
    while (!done) {
      // biome-ignore lint/performance/noAwaitInLoops: A sample is taken once per step, in order.
      largest = Math.max(largest, await sessions(probe, app));
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    const all = await answers;
    const ok = all.filter((a) => a.status === 200).length;
    check(problems, largest <= 3, `the server showed ${largest} sessions for a pool bounded at 3`);
    check(
      problems,
      largest >= 3,
      `the proof never saw the pool reach its bound (largest sample ${largest}), so the bound was not tested`,
    );
    check(problems, ok === 8, `expected all 8 requests served through 3 connections, got ${ok}`);
    check(
      problems,
      db.stats().waiting === 0 && db.stats().checkedOut === 0,
      `the pool did not drain: ${JSON.stringify(db.stats())}`,
    );
  } finally {
    await server.close();
  }
  report.result(
    'the pool never opens more sessions than its bound',
    problems,
    'largest sample 3, all 8 requests served',
  );
}

// Does:  Destroys a client socket while its handler awaits pg_sleep(30) and waits for the backend to go.
async function abandoned(probe: Client): Promise<void> {
  const problems: string[] = [];
  const app = 'data_pcs_abandon';
  const db = createPostgresDatabase({ url: poolUrl(app), tls: { ca } });
  const server = createServer({ log: false });
  server.register(db.plugin);
  server.routes(contract, {
    hold: () => ({ status: 200, body: { ok: true } }),
    forever: async (request) => {
      await db.for(request).query(sql`select pg_sleep(30)`);
      return { status: 200, body: { ok: true } };
    },
  });
  const { port } = await server.listen({ port: 0, host: '127.0.0.1' });
  try {
    const socket = connect({ host: '127.0.0.1', port });
    socket.on('error', () => undefined);
    socket.write('GET /forever HTTP/1.1\r\nhost: x\r\n\r\n');
    let pid: number | null = null;
    const running = await until(async () => {
      pid = await sleeping(probe, app, 'pg_sleep(30)');
      return pid !== null;
    }, 5000);
    check(problems, running, "the handler's statement never became active on the server");
    socket.destroy();
    // Why: A tenth of the 30 s statement is the longest the PRD lets an abandoned statement keep running.
    const gone =
      running &&
      (await until(
        async () => (await probe.query('select 1 from pg_stat_activity where pid = $1', [pid])).rowCount === 0,
        3000,
      ));
    check(problems, gone, "the abandoned request's statement was still on the server 3 s after its client closed");
    check(
      problems,
      await until(() => db.stats().checkedOut === 0, 3000),
      `a connection is still checked out: ${JSON.stringify(db.stats())}`,
    );
  } finally {
    await server.close();
  }
  report.result(
    "an abandoned request's statement is cancelled on the server",
    problems,
    'the backend left pg_stat_activity inside 3 s',
  );
}

// Does:  Closes a server with 3 statements running and 2 waiters, then counts the sessions left on the server.
async function shutdown(probe: Client): Promise<void> {
  const problems: string[] = [];
  const app = 'data_pcs_shutdown';
  const closeLimitMs = 4000;
  const db = createPostgresDatabase({
    url: poolUrl(app),
    tls: { ca },
    maxConnections: 3,
    maxWaiters: 5,
    acquireTimeoutMs: 60_000,
  });
  const server = createServer({ log: false, pluginCloseTimeoutMs: closeLimitMs });
  server.register(db.plugin);
  let owner: { signal: AbortSignal; log: Parameters<typeof db.for>[0]['log'] } | undefined;
  server.register((scope) => {
    owner = { signal: new AbortController().signal, log: scope.log };
  });
  await server.listen({ port: 0, host: '127.0.0.1' });
  if (owner === undefined) {
    throw new Error('the plugin did not run');
  }
  const running: { settled: string[] } = { settled: [] };
  const waiting: { settled: string[] } = { settled: [] };
  const code = (error: unknown): string =>
    typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : 'other';
  for (let i = 0; i < 3; i++) {
    db.for(owner)
      .query(sql`select pg_sleep(60)`)
      .then(
        () => running.settled.push('resolved'),
        (error: unknown) => running.settled.push(code(error)),
      );
  }
  await until(() => db.stats().checkedOut === 3, 5000);
  for (let i = 0; i < 2; i++) {
    db.for(owner)
      .query(sql`select pg_sleep(60)`)
      .then(
        () => waiting.settled.push('resolved'),
        (error: unknown) => waiting.settled.push(code(error)),
      );
  }
  check(
    problems,
    await until(() => db.stats().waiting === 2, 5000),
    `the state was not built: ${JSON.stringify(db.stats())}`,
  );
  check(problems, (await sessions(probe, app)) === 3, 'the server did not show 3 sessions before the close');
  const started = performance.now();
  await server.close();
  const elapsed = performance.now() - started;
  check(
    problems,
    elapsed < closeLimitMs / 2,
    `server.close() took ${Math.round(elapsed)} ms, over half of pluginCloseTimeoutMs`,
  );
  check(
    problems,
    await until(async () => (await sessions(probe, app)) === 0, 3000),
    `${await sessions(probe, app)} sessions are still on the server after server.close()`,
  );
  check(
    problems,
    waiting.settled.length === 2 && waiting.settled.every((c) => c === 'POOL_CLOSED'),
    `the waiting calls ended ${JSON.stringify(waiting.settled)}, not POOL_CLOSED`,
  );
  check(
    problems,
    running.settled.length === 3 && running.settled.every((c) => c !== 'resolved'),
    `the running statements ended ${JSON.stringify(running.settled)}`,
  );
  report.result(
    'server.close() leaves no session on the server',
    problems,
    '0 sessions, waiters POOL_CLOSED, close under half the limit',
  );
}

const admin = client('postgres', 'data_pcs_admin');
await admin.connect();
await admin.query(`create database ${databaseName}`);
const watcher = client(databaseName, 'data_pcs_probe');
await watcher.connect();
try {
  await bound(watcher);
  await abandoned(watcher);
  await shutdown(watcher);
} catch (error) {
  report.result(
    'the script ran to the end',
    [error instanceof Error ? `${error.name}: ${error.message.slice(0, 300)}` : 'threw'],
    '',
  );
} finally {
  await watcher.end();
  await admin.query(`drop database if exists ${databaseName} with (force)`);
  await admin.end();
}
report.finish();
