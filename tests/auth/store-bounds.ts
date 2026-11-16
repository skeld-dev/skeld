// Does:  Proves the PostgreSQL queue and pool bounds and that SQLite writers waiting on a held lock all complete.
// Holds: Counts and timings are read from the running stores and their databases; durations are observations.

import { randomBytes } from 'node:crypto';
import { loadavg } from 'node:os';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import { createPostgresStore, type PgClient } from '@skeld/auth/postgres';
import {
  cleanAll,
  createReport,
  failureCode,
  fresh,
  isFailure,
  makeRig,
  type Rig,
  settle,
  show,
  sleepMs,
} from './support-store.ts';

const report = createReport(
  's06',
  'store-bounds',
  'the PostgreSQL pool wait and client bounds hold, and 500 SQLite write units waiting on a held lock all complete and are stored',
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
    for (const waiting of [500]) {
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
    }
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
await report.run('[sqlite] contention', sqliteContention);
await cleanAll();
report.finish();
