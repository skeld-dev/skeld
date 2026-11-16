// Does:  Proves the store's queue, pool and cleanup bounds and SQLite's event-loop behaviour under lock contention.
// Holds: Counts and timings are read from the running stores and their databases; durations are observations.

import { randomBytes } from 'node:crypto';
import { loadavg } from 'node:os';
import { monitorEventLoopDelay } from 'node:perf_hooks';
// biome-ignore lint/correctness/noUnresolvedImports: Biome's Node module list lacks node:sqlite, which Node 26 ships
import { DatabaseSync } from 'node:sqlite';
import { createPostgresStore, type PgClient, type PgPool } from '@skeld/auth/postgres';
import {
  cleanAll,
  createReport,
  failureCode,
  fresh,
  isFailure,
  makeRig,
  type Rig,
  type Settled,
  settle,
  show,
  sleepMs,
  toNumber,
} from './support-store.ts';

const report = createReport(
  's06',
  'store-bounds',
  'the PostgreSQL pool wait and client bounds hold, cleanup removes at most its bound per pass by the expiry indexes, and SQLite waits out its retry schedule without blocking the event loop',
);
let uncaught = 0;
process.on('uncaughtException', () => {
  uncaught += 1;
});

const tag = (prefix: string): string => `${prefix}-${randomBytes(6).toString('hex')}`;

async function seedSession(rig: Rig): Promise<{ userId: string; digest: Uint8Array }> {
  const userId = tag('u');
  const digest = fresh();
  await rig.store.ops.subjectEnsure({ userId });
  await rig.store.ops.sessionIssue({
    userId,
    generation: 1,
    digest,
    replaces: null,
    idleMs: 600_000,
    absoluteMs: 600_000,
  });
  return { userId, digest };
}

function appPoolOf(rig: Rig): NonNullable<Rig['appPool']> {
  if (rig.appPool === null || rig.database === null) {
    throw new Error('PostgreSQL rig without a pool');
  }
  return rig.appPool;
}

// Does:  Puts 1,000 callers in the single client's queue and shows the 1,001st refused at once while the others wait.
async function waiterBound(rig: Rig): Promise<void> {
  const database = rig.database;
  if (database === null) {
    throw new Error('PostgreSQL rig without a database');
  }
  const pool = database.pool({ max: 2, application: 'proof-queue' });
  const store = createPostgresStore({ pool, maxClients: 1, cleanupIntervalSeconds: 3600 });
  await store.attach({ onFailure: () => undefined });
  const { digest, userId } = await seedSession(rig);
  await rig.hold('sessions', digest, 2500);
  const first = settle(store.ops.sessionRevoke({ digest }));
  await sleepMs(150);
  const settledAt: number[] = [];
  const began = performance.now();
  const queued = Array.from({ length: 1000 }, () =>
    settle(store.ops.subjectRead({ userId })).then((outcome) => {
      settledAt.push(performance.now() - began);
      return outcome;
    }),
  );
  await sleepMs(100);
  const waitingAfter100 = 1000 - settledAt.length;
  const overStart = performance.now();
  const over = await settle(store.ops.subjectRead({ userId }));
  const overMs = Math.round(performance.now() - overStart);
  const overAgain = await settle(store.ops.subjectRead({ userId }));
  report.check(
    '[postgres] with maxClients 1 and its client held, 1,000 callers are accepted and wait; the 1,001st is refused at once: unavailable, applied no',
    waitingAfter100 === 1000 &&
      isFailure(over, 'unavailable', 'no') &&
      overMs < 250 &&
      isFailure(overAgain, 'unavailable', 'no'),
    `${waitingAfter100} of 1,000 waiting after 100 ms; the 1,001st: ${show(over)} code ${String(failureCode(over))} after ${overMs} ms; the 1,002nd ${show(overAgain)}`,
  );
  const outcomes = await Promise.all(queued);
  const served = outcomes.filter((outcome) => outcome.ok).length;
  const refused = outcomes.filter((outcome) => isFailure(outcome, 'unavailable', 'no')).length;
  const firstDone = await first;
  report.check(
    '[postgres] the lock holder lets go: the first caller completes and every queued caller is served or refused unavailable/no at its own 5,000 ms deadline',
    firstDone.ok && served + refused === 1000,
    `first ${show(firstDone)}; of the 1,000: served ${served}, refused ${refused}; last settled ${Math.round(Math.max(...settledAt))} ms after queuing`,
  );
  await store.close();
  await pool.end();
}

// Does:  Samples the database's backend count while many callers contend, to show the client bound is never passed.
async function clientBound(rig: Rig): Promise<void> {
  const database = rig.database;
  if (database === null) {
    throw new Error('PostgreSQL rig without a database');
  }
  const pool = database.pool({ max: 8, application: 'proof-bound' });
  const store = createPostgresStore({ pool, maxClients: 3, cleanupIntervalSeconds: 3600 });
  await store.attach({ onFailure: () => undefined });
  const { digest } = await seedSession(rig);
  await rig.hold('sessions', digest, 600);
  const calls = Array.from({ length: 40 }, () => settle(store.ops.sessionRevoke({ digest })));
  let peak = 0;
  let peakPool = 0;
  const samples = setInterval(() => {
    rig
      .query(
        "SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname = current_database() AND application_name = 'proof-bound'",
      )
      .then(
        (rows) => {
          peak = Math.max(peak, Number(rows[0]?.n));
          peakPool = Math.max(peakPool, pool.totalCount);
        },
        () => undefined,
      );
  }, 20);
  const done = await Promise.all(calls);
  clearInterval(samples);
  const revoked = done.filter((outcome) => outcome.ok && outcome.value.revoked).length;
  report.check(
    '[postgres] 40 callers on a pool of 8 with maxClients 3: the database never sees more than 3 backends of the store, and the 3 are reached',
    peak <= 3 && peak >= 3 && peakPool <= 3 && revoked === 1,
    `peak backends ${peak}, peak pool.totalCount ${peakPool}; revoked ${revoked} of 40 callers`,
  );
  await store.close();
  await pool.end();
}

// Does:  Holds every pool client in the application so the unit's pool wait runs to the 5,000 ms deadline.
async function deadlineWhenPoolIsHeld(rig: Rig): Promise<void> {
  const database = rig.database;
  if (database === null) {
    throw new Error('PostgreSQL rig without a database');
  }
  const pool = database.pool({ max: 2, application: 'proof-held' });
  const store = createPostgresStore({ pool, maxClients: 2, cleanupIntervalSeconds: 3600 });
  await store.attach({ onFailure: () => undefined });
  const taken = [await pool.connect(), await pool.connect()];
  const began = performance.now();
  const outcome = await settle(store.ops.subjectRead({ userId: 'nobody' }));
  const elapsed = Math.round(performance.now() - began);
  report.check(
    '[postgres] no client within 5,000 ms: unavailable, applied no, at the deadline',
    isFailure(outcome, 'unavailable', 'no') && failureCode(outcome) === null && elapsed >= 4990 && elapsed <= 5500,
    `${show(outcome)} after ${elapsed} ms (deadline 5,000 ms, accepted 4,990 to 5,500 ms)`,
  );
  const lateCall = settle(store.ops.subjectRead({ userId: 'nobody' }));
  await sleepMs(300);
  for (const client of taken) {
    client.release();
  }
  const late = await lateCall;
  await sleepMs(100);
  report.check(
    '[postgres] a client that arrives after its caller stopped waiting is released at once, and the pool is whole again',
    pool.waitingCount === 0 &&
      pool.idleCount === 2 &&
      pool.totalCount === 2 &&
      (late.ok || isFailure(late, 'unavailable', 'no')),
    `pool total ${pool.totalCount}, idle ${pool.idleCount}, waiting ${pool.waitingCount}; the caller that waited through the release: ${show(late)}`,
  );
  await store.close();
  await pool.end();
}

async function abortWhileQueued(rig: Rig): Promise<void> {
  const database = rig.database;
  if (database === null) {
    throw new Error('PostgreSQL rig without a database');
  }
  const pool = database.pool({ max: 2, application: 'proof-abort' });
  const store = createPostgresStore({ pool, maxClients: 1, cleanupIntervalSeconds: 3600 });
  await store.attach({ onFailure: () => undefined });
  const held = await seedSession(rig);
  const other = await seedSession(rig);
  await rig.hold('sessions', held.digest, 1200);
  const running = settle(store.ops.sessionRevoke({ digest: held.digest }));
  await sleepMs(150);
  const controller = new AbortController();
  const queued = settle(store.ops.sessionRevoke({ digest: other.digest }, controller.signal));
  await sleepMs(100);
  const abortedAt = performance.now();
  controller.abort();
  const outcome = await queued;
  const refusedMs = Math.round(performance.now() - abortedAt);
  const stillRunning = await Promise.race([running.then(() => false), sleepMs(50).then(() => true)]);
  report.check(
    '[postgres] a signal that aborts while a caller waits for a client: aborted, applied no, at once, the other caller still running and the row untouched',
    isFailure(outcome, 'aborted', 'no') &&
      refusedMs < 100 &&
      stillRunning &&
      (await rig.exists('sessions', other.digest)),
    `${show(outcome)} ${refusedMs} ms after the abort; the running unit still blocked: ${stillRunning}`,
  );
  await running;
  await store.close();
  await pool.end();
}

async function limitRefusals(kind: 'sqlite' | 'postgres'): Promise<void> {
  const label = `[${kind}]`;
  const statements: string[] = [];
  const restore = kind === 'sqlite' ? captureSqlitePrepares(statements) : () => undefined;
  const rig = await makeRig(kind, { attach: false });
  try {
    if (kind === 'postgres') {
      await rig.query(
        "INSERT INTO skeld_auth.sessions SELECT decode(md5(g::text) || md5('s' || g::text), 'hex'), 'bulk', 0, 0, 0, 1 FROM generate_series(1, 5) g",
      );
    } else {
      await rig.query(
        "WITH RECURSIVE c(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM c WHERE x < 5) INSERT INTO sessions SELECT randomblob(32), 'bulk', 0, 0, 0, 1 FROM c",
      );
    }
    let store = rig.store;
    let pool: { end: () => Promise<void> } | null = null;
    if (kind === 'postgres' && rig.database !== null) {
      const raw = rig.database.pool({ max: 4, application: 'proof-limit' });
      pool = raw;
      store = createPostgresStore({ pool: recordingPool(raw, statements), cleanupIntervalSeconds: 3600 });
    }
    await store.attach({ onFailure: () => undefined });
    statements.length = 0;
    const calls: [string, Promise<Settled<unknown>>][] = [
      ['expiredRemove limit 0', settle(store.ops.expiredRemove({ limit: 0 }))],
      ['expiredRemove limit 1001', settle(store.ops.expiredRemove({ limit: 1001 }))],
      ['expiredRemove limit -1', settle(store.ops.expiredRemove({ limit: -1 }))],
      ['apiKeyList limit 0', settle(store.ops.apiKeyList({ userId: 'u', limit: 0 }))],
      ['apiKeyList limit 1001', settle(store.ops.apiKeyList({ userId: 'u', limit: 1001 }))],
    ];
    const outcomes = await Promise.all(calls.map(([, call]) => call));
    const wrong = calls
      .filter((_, index) => !isFailure(outcomes[index] ?? { ok: true, value: null }, 'fault', 'no'))
      .map(([name]) => name);
    const sent = statements.length;
    const expired = await rig.count('sessions', 'expires_at', 1);
    report.check(
      `${label} a limit outside 1 to 1,000 on expiredRemove or apiKeyList rejects fault, applied no, before any statement`,
      wrong.length === 0 && sent === 0 && expired === 5,
      `${calls.length - wrong.length} of ${calls.length} rejected fault/no${wrong.length === 0 ? '' : ` (wrong: ${wrong.join(', ')})`}; statements sent ${sent}; expired rows still ${expired} of 5`,
    );
    const smallest = await settle(store.ops.expiredRemove({ limit: 1 }));
    const largest = await settle(store.ops.apiKeyList({ userId: 'u', limit: 1000 }));
    report.check(
      `${label} the edges 1 and 1,000 are accepted (control)`,
      smallest.ok && smallest.value.removed === 1 && largest.ok && largest.value.kind === 'done',
      `${show(smallest)} removed ${smallest.ok ? smallest.value.removed : '-'}; ${show(largest)}`,
    );
    if (store !== rig.store) {
      await store.close();
    }
    await pool?.end();
  } finally {
    restore();
    await rig.dispose();
  }
}

async function poolHygiene(): Promise<void> {
  const rig = await makeRig('postgres', { attach: false, maxClients: 4 });
  try {
    const pool = appPoolOf(rig);
    const appListener = (): void => undefined;
    pool.on('error', appListener);
    const before = pool.listenerCount('error');
    await rig.store.attach({ onFailure: () => undefined });
    const attached = pool.listenerCount('error');
    const { digest } = await seedSession(rig);
    await rig.hold('sessions', digest, 3600);
    const began = performance.now();
    const refused = await settle(rig.store.ops.sessionRevoke({ digest }));
    const elapsed = Math.round(performance.now() - began);
    report.check(
      '[postgres] a row lock held past lock_timeout (3 s): unavailable, applied no, SQLSTATE 55P03, at about 3,000 ms',
      isFailure(refused, 'unavailable', 'no') && failureCode(refused) === '55P03' && elapsed >= 2900 && elapsed <= 3500,
      `${show(refused)} code ${String(failureCode(refused))} after ${elapsed} ms`,
    );
    const clients: PgClient[] = [];
    const settings: string[] = [];
    for (let n = 0; n < 4; n += 1) {
      // biome-ignore lint/performance/noAwaitInLoops: the clients are held together so each pooled one is inspected once
      clients.push(await pool.connect());
    }
    for (const client of clients) {
      // biome-ignore lint/performance/noAwaitInLoops: one client at a time
      const result = await client.query(
        "SELECT current_setting('lock_timeout') AS l, current_setting('statement_timeout') AS s, current_setting('idle_in_transaction_session_timeout') AS i",
      );
      const row = result.rows[0];
      settings.push(JSON.stringify(row));
    }
    for (const client of clients) {
      client.release();
    }
    report.check(
      "[postgres] clients the pool hands out afterwards carry none of the store's transaction-local timeouts",
      settings.every((setting) => setting === '{"l":"0","s":"0","i":"0"}'),
      `${clients.length} clients inspected: ${[...new Set(settings)].join(' ')}`,
    );
    const { digest: victim } = await seedSession(rig);
    await rig.hold('sessions', victim, 1200);
    const call = settle(rig.store.ops.sessionRevoke({ digest: victim }));
    await sleepMs(300);
    await rig.query(
      "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = current_database() AND application_name = 'proof-app' AND wait_event_type = 'Lock'",
    );
    const killed = await call;
    await sleepMs(1500);
    const afterKill = await settle(rig.store.ops.subjectRead({ userId: 'nobody' }));
    report.check(
      '[postgres] a backend killed while a unit waits: the store rejects unavailable, no uncaught error ends the process, and the next call works',
      isFailure(killed, 'unavailable', 'no') && uncaught === 0 && afterKill.ok,
      `${show(killed)}; uncaught errors ${uncaught}; next call ${show(afterKill)}`,
    );
    await rig.store.close();
    const closed = pool.listenerCount('error');
    const usable = await settle(pool.query('SELECT 1 AS one'));
    report.check(
      '[postgres] the store adds one Pool error listener at attach, removes only its own at close, and never ends the Pool',
      attached === before + 1 &&
        closed === before &&
        pool.listeners('error').includes(appListener) &&
        usable.ok &&
        pool.ending === false,
      `listeners ${before} -> ${attached} -> ${closed}; the application's own listener kept; pool usable ${usable.ok}`,
    );
  } finally {
    await rig.dispose();
  }
}

interface Dataset {
  readonly sessions: number;
  readonly sessionsExpired: number;
  readonly others: number;
  readonly othersExpired: number;
}

const dataset: Dataset = { sessions: 100_000, sessionsExpired: 2500, others: 50_000, othersExpired: 300 };
const tables = ['sessions', 'api_keys', 'limit_windows', 'oidc_attempts'] as const;

async function loadDataset(rig: Rig): Promise<void> {
  const { sessions, sessionsExpired, others, othersExpired } = dataset;
  const live = 9_000_000_000_000;
  if (rig.kind === 'postgres') {
    await rig.query(
      `INSERT INTO skeld_auth.sessions SELECT decode(md5(g::text) || md5('s' || g::text), 'hex'), 'bulk', 0, 0, 0, CASE WHEN g <= ${sessionsExpired} THEN 1 ELSE ${live} END FROM generate_series(1, ${sessions}) g`,
    );
    await rig.query(
      `INSERT INTO skeld_auth.api_keys SELECT 'k' || g, 'bulk', decode(md5(g::text) || md5(g::text), 'hex'), 'n', 'a:b', 0, CASE WHEN g <= ${othersExpired} THEN 1 WHEN g % 2 = 0 THEN NULL ELSE ${live} END FROM generate_series(1, ${others}) g`,
    );
    await rig.query(
      `INSERT INTO skeld_auth.limit_windows SELECT decode(md5(g::text) || md5('w' || g::text), 'hex'), 0, 1, CASE WHEN g <= ${othersExpired} THEN 1 ELSE ${live} END FROM generate_series(1, ${others}) g`,
    );
    await rig.query(
      `INSERT INTO skeld_auth.oidc_attempts SELECT decode(md5(g::text) || md5('o' || g::text), 'hex'), decode(md5(g::text) || md5(g::text), 'hex'), 'gh', 'n', 'v', '/', CASE WHEN g <= ${othersExpired} THEN 1 ELSE ${live} END FROM generate_series(1, ${others}) g`,
    );
    await rig.query(
      'ANALYZE skeld_auth.sessions, skeld_auth.api_keys, skeld_auth.limit_windows, skeld_auth.oidc_attempts',
    );
    return;
  }
  const series = (rows: number): string =>
    `WITH RECURSIVE c(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM c WHERE x < ${rows})`;
  await rig.query(
    `${series(sessions)} INSERT INTO sessions SELECT randomblob(32), 'bulk', 0, 0, 0, CASE WHEN x <= ${sessionsExpired} THEN 1 ELSE ${live} END FROM c`,
  );
  await rig.query(
    `${series(others)} INSERT INTO api_keys SELECT 'k' || x, 'bulk', randomblob(32), 'n', 'a:b', 0, CASE WHEN x <= ${othersExpired} THEN 1 WHEN x % 2 = 0 THEN NULL ELSE ${live} END FROM c`,
  );
  await rig.query(
    `${series(others)} INSERT INTO limit_windows SELECT randomblob(32), 0, 1, CASE WHEN x <= ${othersExpired} THEN 1 ELSE ${live} END FROM c`,
  );
  await rig.query(
    `${series(others)} INSERT INTO oidc_attempts SELECT randomblob(32), randomblob(32), 'gh', 'n', 'v', '/', CASE WHEN x <= ${othersExpired} THEN 1 ELSE ${live} END FROM c`,
  );
  await rig.query('ANALYZE');
}

async function expiredCounts(rig: Rig): Promise<number[]> {
  const counts: number[] = [];
  for (const table of tables) {
    // biome-ignore lint/performance/noAwaitInLoops: four small counts, one after the other
    const rows = await rig.query(`SELECT count(*) AS n FROM ${table} WHERE expires_at <= 2`);
    counts.push(toNumber(rows[0]?.n));
  }
  return counts;
}

async function liveCounts(rig: Rig): Promise<number[]> {
  const counts: number[] = [];
  for (const table of tables) {
    // biome-ignore lint/performance/noAwaitInLoops: four counts, one after the other
    const rows = await rig.query(`SELECT count(*) AS n FROM ${table} WHERE expires_at IS NULL OR expires_at > 2`);
    counts.push(toNumber(rows[0]?.n));
  }
  return counts;
}

// Does:  Computes from the contract's order what one pass of the given limit leaves of each table's expired rows.
function afterPass(expired: readonly number[], limit: number): number[] {
  let left = limit;
  return expired.map((rows) => {
    const taken = Math.min(rows, left);
    left -= taken;
    return rows - taken;
  });
}

function recordingPool(pool: PgPool, log: string[]): PgPool {
  return {
    options: pool.options,
    on: (event, listener) => pool.on(event, listener),
    removeListener: (event, listener) => pool.removeListener(event, listener),
    connect: async () => {
      const client = await pool.connect();
      return {
        query: (text, values) => {
          log.push(text);
          return client.query(text, values);
        },
        release: (destroy) => client.release(destroy),
        on: (event, listener) => client.on(event, listener),
        removeListener: (event, listener) => client.removeListener(event, listener),
      };
    },
  };
}

// Does:  Captures the SQL text the SQLite store prepares for cleanup by wrapping prepare on the built-in class.
function captureSqlitePrepares(log: string[]): () => void {
  const original = DatabaseSync.prototype.prepare;
  DatabaseSync.prototype.prepare = function prepare(this: InstanceType<typeof DatabaseSync>, sql: string) {
    log.push(sql);
    return original.call(this, sql);
  };
  return () => {
    DatabaseSync.prototype.prepare = original;
  };
}

async function planOf(rig: Rig, statementText: string, now: number): Promise<string[]> {
  if (rig.kind === 'postgres') {
    const text = statementText.replace('$1', String(now)).replace('$2', '1000');
    const rows = await rig.query(`EXPLAIN ${text}`);
    return rows.map((row) => String(row['QUERY PLAN']));
  }
  const rows = await rig.query(
    `EXPLAIN QUERY PLAN ${statementText}`.replace('LIMIT ?', 'LIMIT 1000').replace('<= ?', `<= ${now}`),
  );
  return rows.map((row) => String(row.detail));
}

async function cleanupBound(kind: 'sqlite' | 'postgres'): Promise<void> {
  const label = `[${kind}]`;
  const sqlLog: string[] = [];
  const restore = kind === 'sqlite' ? captureSqlitePrepares(sqlLog) : () => undefined;
  const rig = await makeRig(kind, { attach: false });
  try {
    const loadStart = performance.now();
    await loadDataset(rig);
    const loaded = Math.round(performance.now() - loadStart);
    const expired = await expiredCounts(rig);
    const live = await liveCounts(rig);
    report.note(
      `${label} dataset: sessions ${dataset.sessions} (${expired[0]} expired), api_keys ${dataset.others} (${expired[1]} expired, half of the rest without an expiry), limit_windows ${dataset.others} (${expired[2]} expired), oidc_attempts ${dataset.others} (${expired[3]} expired); made by INSERT ... SELECT from generate_series or a recursive CTE with random 32-byte keys, ANALYZE run, loaded in ${loaded} ms; expiry indexes from install`,
    );
    const subjectsBefore = await rig.count('subjects');
    let pool: PgPool | null = null;
    let store = rig.store;
    if (kind === 'postgres') {
      const database = rig.database;
      if (database === null) {
        throw new Error('PostgreSQL rig without a database');
      }
      const raw = database.pool({ max: 4, application: 'proof-cleanup' });
      pool = recordingPool(raw, sqlLog);
      store = createPostgresStore({ pool, cleanupIntervalSeconds: 3600 });
    }
    await store.attach({ onFailure: () => undefined });
    const small = await store.ops.expiredRemove({ limit: 7 });
    let remaining = afterPass(expired, 7);
    report.check(
      `${label} expiredRemove with limit 7 removes exactly 7, sessions first`,
      small.removed === 7 && JSON.stringify(await expiredCounts(rig)) === JSON.stringify(remaining),
      `removed ${small.removed}; expired left per table ${JSON.stringify(await expiredCounts(rig))}`,
    );
    const removedPerPass: number[] = [];
    const timings: number[] = [];
    let ordered = true;
    for (let pass = 0; pass < 8 && remaining.some((rows) => rows > 0); pass += 1) {
      const began = performance.now();
      // biome-ignore lint/performance/noAwaitInLoops: each pass is judged against the one before it
      const result = await store.ops.expiredRemove({ limit: 1000 });
      timings.push(Math.round((performance.now() - began) * 10) / 10);
      removedPerPass.push(result.removed);
      remaining = afterPass(remaining, 1000);
      ordered = ordered && JSON.stringify(await expiredCounts(rig)) === JSON.stringify(remaining);
    }
    const last = await store.ops.expiredRemove({ limit: 1000 });
    report.check(
      `${label} passes of limit 1000 remove at most 1,000 each, table by table in the contract's order, until none is left`,
      removedPerPass.every((n) => n <= 1000) &&
        ordered &&
        last.removed === 0 &&
        removedPerPass.reduce((a, b) => a + b, 0) === expired.reduce((a, b) => a + b, 0) - 7,
      `removed per pass ${removedPerPass.join(', ')}, then ${last.removed}; the per-table counts matched the contract's order after every pass: ${ordered}; pass times ${timings.join(', ')} ms`,
    );
    const liveAfter = await liveCounts(rig);
    report.check(
      `${label} cleanup left every unexpired row and every subject alone`,
      JSON.stringify(liveAfter) === JSON.stringify(live) && (await rig.count('subjects')) === subjectsBefore,
      `unexpired rows per table ${JSON.stringify(liveAfter)} (before ${JSON.stringify(live)}); subjects ${await rig.count('subjects')} (before ${subjectsBefore})`,
    );
    const deletes = [
      ...new Set(
        sqlLog.filter(
          (text) =>
            /^\s*(DELETE|WITH)/i.test(text) &&
            /expires_at/.test(text) &&
            /LIMIT|ctid/i.test(text) &&
            /DELETE/i.test(text),
        ),
      ),
    ];
    const plans: string[] = [];
    let indexed = deletes.length === 4;
    for (const text of deletes) {
      // biome-ignore lint/performance/noAwaitInLoops: the plans are read one statement at a time
      const plan = await planOf(rig, text, 1_794_000_000_000);
      plans.push(
        `${text.replace(/\s+/g, ' ').slice(0, 60)} => ${plan
          .filter((line) => /Scan|Join|Loop|SEARCH|SCAN/.test(line))
          .map((line) => line.replace(/\s*\(cost=.*$/, '').trim())
          .join(' / ')}`,
      );
      indexed =
        indexed &&
        plan.some((line) =>
          /(Index (Only )?Scan using|Bitmap Index Scan on|USING (COVERING )?INDEX) \w*_?expiry|USING (COVERING )?INDEX \w+_expiry/.test(
            line,
          ),
        );
    }
    report.check(
      `${label} the four cleanup statements the adapter sent each use their table's expiry index`,
      indexed,
      `${deletes.length} statements captured`,
    );
    for (const plan of plans) {
      report.note(`  ${plan}`);
    }
    const sessionsDelete = deletes.find(
      (text) => text.includes('.sessions') || text.startsWith('DELETE FROM sessions'),
    );
    if (kind === 'postgres' && sessionsDelete !== undefined) {
      await rig.query('TRUNCATE skeld_auth.sessions');
      await rig.query(
        `INSERT INTO skeld_auth.sessions SELECT decode(md5(g::text) || md5('s' || g::text), 'hex'), 'bulk', 0, 0, 0, CASE WHEN g <= 2500 THEN 1 ELSE 9000000000000 END FROM generate_series(1, 1000000) g`,
      );
      await rig.query('ANALYZE skeld_auth.sessions');
      const plan = await planOf(rig, sessionsDelete, 1_794_000_000_000);
      const began = performance.now();
      const big = await store.ops.expiredRemove({ limit: 1000 });
      const pass = Math.round((performance.now() - began) * 10) / 10;
      report.check(
        `${label} at ten times the dataset (1,000,000 sessions, 2,500 expired) a pass still removes exactly 1,000 and finds them by sessions_expiry`,
        big.removed === 1000 && plan.some((line) => /Index Scan using sessions_expiry/.test(line)),
        `removed ${big.removed} in ${pass} ms; plan: ${plan
          .filter((line) => /Scan|Join|Loop/.test(line))
          .map((line) => line.replace(/\s*\(cost=.*$/, '').trim())
          .join(' / ')}`,
      );
    }
    if (store !== rig.store) {
      await store.close();
    }
  } finally {
    restore();
    await rig.dispose();
  }
}

async function scheduledCleanup(kind: 'sqlite' | 'postgres'): Promise<void> {
  const label = `[${kind}]`;
  const rig = await makeRig(kind, { attach: false, cleanupIntervalSeconds: 4 });
  try {
    const rows = 2300;
    if (kind === 'postgres') {
      await rig.query(
        `INSERT INTO skeld_auth.sessions SELECT decode(md5(g::text) || md5('s' || g::text), 'hex'), 'bulk', 0, 0, 0, 1 FROM generate_series(1, ${rows}) g`,
      );
    } else {
      await rig.query(
        `WITH RECURSIVE c(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM c WHERE x < ${rows}) INSERT INTO sessions SELECT randomblob(32), 'bulk', 0, 0, 0, 1 FROM c`,
      );
    }
    await rig.store.attach({ onFailure: () => undefined });
    const began = performance.now();
    const drops: { at: number; removed: number }[] = [];
    let last = rows;
    while (performance.now() - began < 9500 && last > 0) {
      // biome-ignore lint/performance/noAwaitInLoops: a timeline is sampled in order
      await sleepMs(40);
      const now = await rig.count('sessions');
      if (now !== last) {
        drops.push({ at: Math.round(performance.now() - began), removed: last - now });
        last = now;
      }
    }
    const [one, two, three] = drops;
    report.check(
      `${label} scheduled cleanup (interval 4 s, 2,300 expired rows): none in the first half interval, a first pass of 1,000, the next 1,000 ms later, and a short pass after that`,
      drops.length === 3 &&
        one !== undefined &&
        two !== undefined &&
        three !== undefined &&
        one.at >= 1900 &&
        one.at <= 4400 &&
        one.removed === 1000 &&
        two.removed === 1000 &&
        three.removed === 300 &&
        Math.abs(two.at - one.at - 1000) <= 350 &&
        Math.abs(three.at - two.at - 1000) <= 350,
      `drops (ms after attach, rows): ${drops.map((drop) => `${drop.at} ms ${drop.removed}`).join('; ')}`,
    );
  } finally {
    await rig.dispose();
  }
}

// Does:  Runs a ticker beside an async body and reports the timer-delay histogram's maximum and mean.
async function underTicker<T>(
  body: () => Promise<T>,
): Promise<{ result: T; maxDelayMs: number; wallMs: number; cpuMs: number; ticks: number }> {
  const histogram = monitorEventLoopDelay({ resolution: 1 });
  let ticks = 0;
  const ticker = setInterval(() => {
    ticks += 1;
  }, 2);
  histogram.enable();
  // Why: The histogram records the gap between timer callbacks, so one callback must come before the body blocks.
  await sleepMs(25);
  const cpuBefore = process.cpuUsage();
  const began = performance.now();
  const result = await body();
  const wallMs = performance.now() - began;
  const cpu = process.cpuUsage(cpuBefore);
  // Why: A synchronous turn only shows as timer lateness once the loop gets back to the timers.
  await sleepMs(20);
  histogram.disable();
  clearInterval(ticker);
  return {
    result,
    maxDelayMs: Math.round(histogram.max / 1e5) / 10,
    wallMs: Math.round(wallMs),
    cpuMs: Math.round((cpu.user + cpu.system) / 1000),
    ticks,
  };
}

async function sqliteContention(): Promise<void> {
  const rig = await makeRig('sqlite');
  try {
    const hold = 300;
    let stored = 0;
    for (const waiting of [1, 50, 500, 2000]) {
      const users = Array.from({ length: waiting }, () => tag('c'));
      // biome-ignore lint/performance/noAwaitInLoops: each level of contention runs alone, one after the other
      await rig.hold('subjects', 'x', hold);
      const observed = await underTicker(async () =>
        Promise.all(users.map((userId) => settle(rig.store.ops.subjectEnsure({ userId })))),
      );
      const done = observed.result.filter((outcome) => outcome.ok && outcome.value.kind === 'done').length;
      stored += waiting;
      report.check(
        `[sqlite] ${waiting} write units wait together on a lock held ${hold} ms: none is refused up front and all complete after it is released`,
        done === waiting && (await rig.count('subjects')) === stored,
        `${done} of ${waiting} done after ${observed.wallMs} ms; subjects stored ${await rig.count('subjects')} of ${stored} expected`,
      );
      const figures = `ticker (2 ms) fired ${observed.ticks} times in ${observed.wallMs} ms; longest event-loop delay ${observed.maxDelayMs} ms; CPU ${observed.cpuMs} ms of ${observed.wallMs} ms wall; host load average ${loadavg()[0]?.toFixed(2)}`;
      if (waiting <= 50) {
        report.check(
          `[sqlite] with ${waiting} waiting the event loop keeps running: the ticker fires throughout, its longest delay is far under the ${hold} ms a blocking wait would show, and the CPU is mostly idle`,
          observed.ticks >= 40 && observed.maxDelayMs < hold / 2 && observed.cpuMs < observed.wallMs * 0.8,
          figures,
        );
      } else {
        report.note(
          `observation [sqlite] ${waiting} waiting (every one retries on its own timer, no count enforced): ${figures}`,
        );
      }
    }
  } finally {
    await rig.dispose();
  }
}

async function sqliteSchedule(): Promise<void> {
  const rig = await makeRig('sqlite');
  try {
    const boundaries: [number, number][] = [
      [100, 127],
      [200, 255],
      [400, 511],
    ];
    for (const [hold, boundary] of boundaries) {
      const target = tag('s');
      // biome-ignore lint/performance/noAwaitInLoops: each lock hold is measured on its own
      await rig.hold('subjects', target, hold);
      const began = performance.now();
      const outcome = await settle(rig.store.ops.subjectEnsure({ userId: target }));
      const elapsed = Math.round(performance.now() - began);
      report.check(
        `[sqlite] a unit blocked by a lock held ${hold} ms is retried on the doubling schedule 1, 2, 4 ... 256 ms and runs at the first attempt after the release (${boundary} ms)`,
        outcome.ok && outcome.value.kind === 'done' && elapsed >= boundary - 12 && elapsed <= boundary + 80,
        `${show(outcome)} after ${elapsed} ms; a polling loop would finish at about ${hold} ms (tolerance -12 / +80 ms)`,
      );
      await sleepMs(boundary - elapsed + 20);
    }
    const times: number[] = [];
    const outcomes: Settled<unknown>[] = [];
    for (let run = 0; run < 5; run += 1) {
      // biome-ignore lint/performance/noAwaitInLoops: each run holds the lock again
      await rig.hold('subjects', 'x', 1500);
      const began = performance.now();
      outcomes.push(await settle(rig.store.ops.subjectEnsure({ userId: tag('o') })));
      times.push(Math.round(performance.now() - began));
      await sleepMs(1500 - (times.at(-1) ?? 0) + 50);
    }
    report.check(
      '[sqlite] a lock held longer than the retry schedule: after ten attempts the unit gives up, unavailable, applied no, SQLITE_BUSY (5), in at most 511 ms plus timer lateness',
      outcomes.every((outcome) => isFailure(outcome, 'unavailable', 'no') && failureCode(outcome) === '5') &&
        times.every((ms) => ms >= 501 && ms <= 661),
      `5 runs: ${times.join(', ')} ms (schedule 511 ms; accepted 501 to 661 ms)`,
    );
  } finally {
    await rig.dispose();
  }
}

async function sqliteCleanupBlocking(): Promise<void> {
  const rig = await makeRig('sqlite');
  try {
    await loadDataset(rig);
    const observed = await underTicker(async () => rig.store.ops.expiredRemove({ limit: 1000 }));
    report.check(
      '[sqlite] one cleanup pass of 1,000 rows on the 300,000-row dataset is a synchronous turn: its blocking time is recorded',
      observed.result.removed === 1000,
      `removed ${observed.result.removed}; wall ${observed.wallMs} ms; longest event-loop delay ${observed.maxDelayMs} ms (observation, host load average ${loadavg()[0]?.toFixed(2)})`,
    );
  } finally {
    await rig.dispose();
  }
}

report.note(
  `host: load average ${loadavg()
    .map((n) => n.toFixed(2))
    .join(' ')} at the start (not a quiet host; durations are observations)`,
);
const queueRig = await makeRig('postgres');
try {
  await report.run('[postgres] waiter bound', () => waiterBound(queueRig));
  await report.run('[postgres] client bound', () => clientBound(queueRig));
  await report.run('[postgres] pool deadline', () => deadlineWhenPoolIsHeld(queueRig));
  await report.run('[postgres] abort while queued', () => abortWhileQueued(queueRig));
} finally {
  await queueRig.dispose();
}
await report.run('[postgres] pool hygiene', poolHygiene);
for (const kind of ['sqlite', 'postgres'] as const) {
  // biome-ignore lint/performance/noAwaitInLoops: one adapter at a time
  await report.run(`[${kind}] limit refusals`, () => limitRefusals(kind));
  await report.run(`[${kind}] cleanup bound`, () => cleanupBound(kind));
  await report.run(`[${kind}] scheduled cleanup`, () => scheduledCleanup(kind));
}
await report.run('[sqlite] contention', sqliteContention);
await report.run('[sqlite] retry schedule', sqliteSchedule);
await report.run('[sqlite] cleanup blocking', sqliteCleanupBlocking);
await cleanAll();
report.finish();
