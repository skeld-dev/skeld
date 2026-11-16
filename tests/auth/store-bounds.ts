// Does:  Proves the PostgreSQL queue and pool bounds and that SQLite writers waiting on a held lock all complete.
// Holds: Preconditions are observed (a backend waiting on a lock, the pool's queue), never assumed after a sleep.

import { randomBytes } from 'node:crypto';
import { setImmediate as nextTurn } from 'node:timers/promises';
import { createPostgresStore, type PgClient } from '@skeld/auth/postgres';
import { createReport } from './rig/report.ts';
import {
  cleanAll,
  failureCode,
  fresh,
  isFailure,
  lockWaiting,
  makeRig,
  type Rig,
  settle,
  show,
  sleepMs,
} from './support-store.ts';

const report = createReport(
  'the PostgreSQL pool wait and client bounds hold, and 500 SQLite write units waiting on a held lock all complete and are stored',
);
let uncaught = 0;
process.on('uncaughtException', () => {
  uncaught += 1;
});

const tag = (prefix: string): string => `${prefix}-${randomBytes(6).toString('hex')}`;

// Does:  Waits for a condition on the pool, polling every 5 ms; false after 2 s, so a failing case still ends.
async function until(condition: () => boolean): Promise<boolean> {
  const end = performance.now() + 2000;
  while (!condition() && performance.now() < end) {
    // biome-ignore lint/performance/noAwaitInLoops: each poll lets the pool's callbacks run first
    await sleepMs(5);
  }
  return condition();
}

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

function databaseOf(rig: Rig): NonNullable<Rig['database']> {
  if (rig.database === null) {
    throw new Error('PostgreSQL rig without a database');
  }
  return rig.database;
}

// Does:  Puts 1,000 callers in the single client's queue and shows the 1,001st refused while the others wait.
async function waiterBound(rig: Rig): Promise<void> {
  const pool = databaseOf(rig).pool({ max: 2, application: 'proof-queue' });
  const store = createPostgresStore({ pool, maxClients: 1, cleanupIntervalSeconds: 3600 });
  await store.attach({ onFailure: () => undefined });
  const { digest, userId } = await seedSession(rig);
  const unlock = await rig.hold('sessions', digest, 10_000);
  const first = settle(store.ops.sessionRevoke({ digest }));
  const holding = await lockWaiting(rig, 'proof-queue');
  let answeredWhileHeld = 0;
  let unlocked = false;
  const queued = Array.from({ length: 1000 }, () =>
    settle(store.ops.subjectRead({ userId })).then((outcome) => {
      answeredWhileHeld += unlocked ? 0 : 1;
      return outcome;
    }),
  );
  const over = await settle(store.ops.subjectRead({ userId }));
  const overAgain = await settle(store.ops.subjectRead({ userId }));
  const waiting = 1000 - answeredWhileHeld;
  report.check(
    '[postgres] with maxClients 1 and its client blocked, 1,000 callers wait; the 1,001st and 1,002nd are refused: unavailable, applied no',
    holding && waiting === 1000 && isFailure(over, 'unavailable', 'no') && isFailure(overAgain, 'unavailable', 'no'),
    `${waiting} of 1,000 waiting when the 1,001st was answered ${show(over)} code ${String(failureCode(over))}; the 1,002nd ${show(overAgain)}`,
  );
  unlocked = true;
  await unlock();
  const outcomes = await Promise.all(queued);
  const served = outcomes.filter((outcome) => outcome.ok).length;
  const firstDone = await first;
  report.check(
    '[postgres] once the lock is released the first caller completes and every queued caller is served',
    firstDone.ok && served === 1000 && answeredWhileHeld === 0,
    `first ${show(firstDone)}; of the 1,000: served ${served}, answered before the release ${answeredWhileHeld}`,
  );
  await store.close();
  await pool.end();
}

// Does:  Samples the database's backend count while many callers contend, to show the client bound is never passed.
async function clientBound(rig: Rig): Promise<void> {
  const pool = databaseOf(rig).pool({ max: 8, application: 'proof-bound' });
  const store = createPostgresStore({ pool, maxClients: 3, cleanupIntervalSeconds: 3600 });
  await store.attach({ onFailure: () => undefined });
  const { digest } = await seedSession(rig);
  const unlock = await rig.hold('sessions', digest, 10_000);
  const calls = Array.from({ length: 40 }, () => settle(store.ops.sessionRevoke({ digest })));
  const three = Promise.withResolvers<boolean>();
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
          if (peak >= 3) {
            three.resolve(true);
          }
        },
        () => undefined,
      );
  }, 20);
  const giveUp = setTimeout(() => three.resolve(false), 5000);
  // Why: The lock stays held until the database shows three backends of the store, so the bound is surely reached.
  const reached = await three.promise;
  clearTimeout(giveUp);
  await unlock();
  const done = await Promise.all(calls);
  clearInterval(samples);
  const revoked = done.filter((outcome) => outcome.ok && outcome.value.revoked).length;
  report.check(
    '[postgres] 40 callers on a pool of 8 with maxClients 3: the database never sees more than 3 backends of the store, and the 3 are reached',
    reached && peak === 3 && peakPool <= 3 && revoked === 1,
    `peak backends ${peak}, peak pool.totalCount ${peakPool}; revoked ${revoked} of 40 callers`,
  );
  await store.close();
  await pool.end();
}

// Does:  Holds every pool client in the application so the unit's pool wait runs to the 5,000 ms deadline.
async function deadlineWhenPoolIsHeld(rig: Rig): Promise<void> {
  const pool = databaseOf(rig).pool({ max: 2, application: 'proof-held' });
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
  await until(() => pool.waitingCount === 2);
  for (const client of taken) {
    client.release();
  }
  const late = await lateCall;
  await until(() => pool.idleCount === 2);
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
  const pool = databaseOf(rig).pool({ max: 2, application: 'proof-abort' });
  const store = createPostgresStore({ pool, maxClients: 1, cleanupIntervalSeconds: 3600 });
  await store.attach({ onFailure: () => undefined });
  const held = await seedSession(rig);
  const other = await seedSession(rig);
  const unlock = await rig.hold('sessions', held.digest, 10_000);
  let runningEnded = false;
  const running = settle(store.ops.sessionRevoke({ digest: held.digest })).then((ended) => {
    runningEnded = true;
    return ended;
  });
  const blocked = await lockWaiting(rig, 'proof-abort');
  const controller = new AbortController();
  const queued = settle(store.ops.sessionRevoke({ digest: other.digest }, controller.signal));
  await nextTurn();
  controller.abort();
  const outcome = await queued;
  const stillRunning = !runningEnded;
  report.check(
    '[postgres] a signal that aborts while a caller waits for a client: aborted, applied no, while the client holder is still blocked, the row untouched',
    blocked && isFailure(outcome, 'aborted', 'no') && stillRunning && (await rig.exists('sessions', other.digest)),
    `${show(outcome)}; the running unit still blocked: ${stillRunning}`,
  );
  await unlock();
  await running;
  await store.close();
  await pool.end();
}

async function poolHygiene(): Promise<void> {
  const rig = await makeRig('postgres', { attach: false, maxClients: 4 });
  try {
    const pool = rig.appPool;
    if (pool === null) {
      throw new Error('PostgreSQL rig without a pool');
    }
    const appListener = (): void => undefined;
    pool.on('error', appListener);
    const before = pool.listenerCount('error');
    await rig.store.attach({ onFailure: () => undefined });
    const attached = pool.listenerCount('error');
    const { digest } = await seedSession(rig);
    const unlockFirst = await rig.hold('sessions', digest, 10_000);
    const began = performance.now();
    const refused = await settle(rig.store.ops.sessionRevoke({ digest }));
    const elapsed = Math.round(performance.now() - began);
    await unlockFirst();
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
      settings.push(JSON.stringify(result.rows[0]));
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
    const unlockVictim = await rig.hold('sessions', victim, 10_000);
    const call = settle(rig.store.ops.sessionRevoke({ digest: victim }));
    const waited = await lockWaiting(rig, 'proof-app');
    await rig.query(
      "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = current_database() AND application_name = 'proof-app' AND wait_event_type = 'Lock'",
    );
    const killed = await call;
    await unlockVictim();
    const afterKill = await settle(rig.store.ops.subjectRead({ userId: 'nobody' }));
    report.check(
      '[postgres] a backend killed while a unit waits: the store rejects unavailable, no uncaught error ends the process, and the next call works',
      waited && isFailure(killed, 'unavailable', 'no') && uncaught === 0 && afterKill.ok,
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

async function sqliteContention(): Promise<void> {
  const rig = await makeRig('sqlite');
  try {
    const waiting = 500;
    const users = Array.from({ length: waiting }, () => tag('c'));
    const unlock = await rig.hold('subjects', 'x', 10_000);
    const writes = Promise.all(users.map((userId) => settle(rig.store.ops.subjectEnsure({ userId }))));
    // Why: One turn later every unit has met the held lock; the release comes well inside their 511 ms of busy retries.
    await nextTurn();
    const storedWhileHeld = await rig.count('subjects');
    await unlock();
    const done = (await writes).filter((outcome) => outcome.ok && outcome.value.kind === 'done').length;
    report.check(
      `[sqlite] ${waiting} write units wait together on a held lock: none is refused up front and all complete after it is released`,
      storedWhileHeld === 0 && done === waiting && (await rig.count('subjects')) === waiting,
      `stored while held ${storedWhileHeld}; ${done} of ${waiting} done; subjects stored ${await rig.count('subjects')}`,
    );
  } finally {
    await rig.dispose();
  }
}

const queueRig = await makeRig('postgres');
try {
  // Why: Each case has its own pool and application name, so the 5 s and 3 s waits overlap instead of adding up.
  await Promise.all([
    report.run('[postgres] waiter bound', () => waiterBound(queueRig)),
    report.run('[postgres] client bound', () => clientBound(queueRig)),
    report.run('[postgres] pool deadline', () => deadlineWhenPoolIsHeld(queueRig)),
    report.run('[postgres] abort while queued', () => abortWhileQueued(queueRig)),
    report.run('[postgres] pool hygiene', poolHygiene),
    report.run('[sqlite] contention', sqliteContention),
  ]);
} finally {
  await queueRig.dispose();
}
await cleanAll();
report.finish();
