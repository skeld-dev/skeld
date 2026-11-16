// Does:  Proves install and version checks, concurrent installs, close, recovery and unparseable stored rows.
// Holds: Nothing expired is usable or restored after a close, a reopen or a killed process; every step is read back.

import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, statSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
// biome-ignore lint/correctness/noUnresolvedImports: Biome's Node module list lacks node:sqlite, which Node 26 ships
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { createPostgresStore } from '@skeld/auth/postgres';
import { createSqliteStore } from '@skeld/auth/sqlite';
import type { AuthStore, StoreEvent } from '@skeld/auth/store';
import {
  cleanAll,
  createReport,
  failureCode,
  fresh,
  hex,
  isFailure,
  type Kind,
  makeRig,
  type Rig,
  rigKinds,
  scratchDir,
  settle,
  show,
  sleepMs,
} from './support-store.ts';

type Report = ReturnType<typeof createReport>;

const expectedNames = [
  'api_keys',
  'api_keys_expiry',
  'api_keys_user',
  'limit_windows',
  'limit_windows_expiry',
  'oidc_attempts',
  'oidc_attempts_expiry',
  'schema_version',
  'sessions',
  'sessions_expiry',
  'sessions_user',
  'subjects',
];
const tag = (prefix: string): string => `${prefix}-${randomBytes(6).toString('hex')}`;
const attachConfig = Object.freeze({ onFailure: (_event: StoreEvent) => undefined });

async function schemaNames(rig: Rig): Promise<string[]> {
  const sql =
    rig.kind === 'sqlite'
      ? "SELECT name FROM sqlite_master WHERE type IN ('table', 'index') AND name NOT LIKE 'sqlite_%'"
      : "SELECT tablename AS name FROM pg_tables WHERE schemaname = 'skeld_auth' UNION ALL SELECT indexname FROM pg_indexes WHERE schemaname = 'skeld_auth'";
  const rows = await rig.query(sql);
  return rows
    .map((row) => String(row.name))
    .filter((name) => !name.endsWith('_pkey'))
    .sort();
}

async function versions(rig: Rig): Promise<string> {
  const rows = await rig.query('SELECT version FROM schema_version');
  return JSON.stringify(rows.map((row) => row.version));
}

async function setVersions(rig: Rig, rows: readonly (number | string)[]): Promise<void> {
  await rig.query('DELETE FROM schema_version');
  for (const row of rows) {
    // biome-ignore lint/performance/noAwaitInLoops: the rows are written in the order given
    await rig.query('INSERT INTO schema_version (version) VALUES (?)', [row]);
  }
}

async function lifecycle(kind: Kind, report: Report): Promise<void> {
  const label = `[${kind}]`;
  const rig = await makeRig(kind, { install: false, attach: false });
  try {
    const { store } = rig;
    if (kind === 'sqlite') {
      const before = await settle(store.attach(attachConfig));
      report.check(
        `${label} attach on a store never installed answers not_installed and creates no file`,
        before.ok && before.value.kind === 'not_installed' && !existsSync(rig.path) && Object.isFrozen(before.value),
        `${show(before)}; file ${existsSync(rig.path) ? 'exists' : 'absent'}`,
      );
    } else {
      const before = await settle(store.attach(attachConfig));
      const schemas = await rig.query("SELECT count(*)::int AS n FROM pg_namespace WHERE nspname = 'skeld_auth'");
      report.check(
        `${label} attach on a database without the schema answers not_installed and creates nothing`,
        before.ok && before.value.kind === 'not_installed' && Number(schemas[0]?.n) === 0,
        `${show(before)}; schema skeld_auth present ${String(schemas[0]?.n)}`,
      );
    }
    const early = await settle(store.ops.subjectRead({ userId: 'nobody' }));
    report.check(
      `${label} an operation before attach rejects unavailable, applied no`,
      isFailure(early, 'unavailable', 'no'),
      show(early),
    );

    const installed = await settle(store.install());
    const names = await schemaNames(rig);
    report.check(
      `${label} install on an empty store answers installed and creates exactly the tables and expiry/user indexes of the contract with version 1`,
      installed.ok &&
        installed.value.kind === 'installed' &&
        JSON.stringify(names) === JSON.stringify(expectedNames) &&
        (await versions(rig)) === '[1]',
      `${show(installed)}; objects ${names.length}; version rows ${await versions(rig)}`,
    );
    const again = await settle(store.install());
    report.check(
      `${label} install on a current store answers current and changes nothing`,
      again.ok &&
        again.value.kind === 'current' &&
        JSON.stringify(await schemaNames(rig)) === JSON.stringify(names) &&
        (await versions(rig)) === '[1]',
      show(again),
    );
    const attached = await settle(store.attach(attachConfig));
    const second = await settle(store.attach(attachConfig));
    report.check(
      `${label} attach answers attached, and a second attach answers in_use`,
      attached.ok && attached.value.kind === 'attached' && second.ok && second.value.kind === 'in_use',
      `${show(attached)}, ${show(second)}`,
    );
    const working = await settle(store.ops.subjectEnsure({ userId: tag('ok') }));
    report.check(
      `${label} after attach the operations work`,
      working.ok && working.value.kind === 'done',
      show(working),
    );
  } finally {
    await rig.dispose();
  }
}

async function mismatchAndUnreadable(kind: Kind, report: Report): Promise<void> {
  const label = `[${kind}]`;
  const rig = await makeRig(kind, { attach: false });
  try {
    const { store } = rig;
    const names = await schemaNames(rig);
    for (const found of [2, 0, 7]) {
      // biome-ignore lint/performance/noAwaitInLoops: each version is written, then read back
      await setVersions(rig, [found]);
      const installed = await settle(store.install());
      const attached = await settle(store.attach(attachConfig));
      const op = await settle(store.ops.subjectRead({ userId: 'nobody' }));
      report.check(
        `${label} version ${found} in the table: install and attach answer mismatch found ${found}, nothing is changed and the store stays unattached`,
        installed.ok &&
          installed.value.kind === 'mismatch' &&
          installed.value.found === found &&
          attached.ok &&
          attached.value.kind === 'mismatch' &&
          attached.value.found === found &&
          isFailure(op, 'unavailable', 'no') &&
          (await versions(rig)) === `[${found}]` &&
          JSON.stringify(await schemaNames(rig)) === JSON.stringify(names),
        `${show(installed)} found ${installed.ok && installed.value.kind === 'mismatch' ? installed.value.found : '-'}; ${show(attached)}; operation ${show(op)}; version rows ${await versions(rig)}`,
      );
    }
    const unreadable: [string, readonly (number | string)[]][] = [
      ['no row', []],
      ['two rows', [1, 1]],
    ];
    if (kind === 'sqlite') {
      unreadable.push(['a text value', ['abc']]);
    }
    for (const [what, rows] of unreadable) {
      // biome-ignore lint/performance/noAwaitInLoops: each case is written, then read back
      await setVersions(rig, rows);
      const before = await versions(rig);
      const installed = await settle(store.install());
      const attached = await settle(store.attach(attachConfig));
      report.check(
        `${label} schema_version with ${what}: install and attach reject record, applied no, code null, and repair nothing`,
        isFailure(installed, 'record', 'no') &&
          failureCode(installed) === null &&
          isFailure(attached, 'record', 'no') &&
          failureCode(attached) === null &&
          (await versions(rig)) === before &&
          JSON.stringify(await schemaNames(rig)) === JSON.stringify(names),
        `${show(installed)}; ${show(attached)}; version rows ${before} before and ${await versions(rig)} after`,
      );
    }
    await setVersions(rig, [1]);
    const recovered = await settle(store.attach(attachConfig));
    report.check(
      `${label} with the one row back at 1 the same store attaches`,
      recovered.ok && recovered.value.kind === 'attached',
      show(recovered),
    );
  } finally {
    await rig.dispose();
  }
}

async function concurrentInstalls(kind: Kind, report: Report): Promise<void> {
  const label = `[${kind}]`;
  let bad = 0;
  let detail = '';
  for (let trial = 0; trial < 10; trial += 1) {
    // biome-ignore lint/performance/noAwaitInLoops: each trial is its own fresh database or file
    const rig = await makeRig(kind, { install: false, attach: false });
    const extras: AuthStore[] = [];
    const pools: { end: () => Promise<void> }[] = [];
    try {
      for (let n = 0; n < 4; n += 1) {
        if (kind === 'sqlite') {
          extras.push(createSqliteStore({ path: rig.path, cleanupIntervalSeconds: 3600 }));
        } else if (rig.database !== null) {
          const pool = rig.database.pool({ max: 2, application: 'proof-install' });
          pools.push(pool);
          extras.push(createPostgresStore({ pool, cleanupIntervalSeconds: 3600 }));
        }
      }
      const results = await Promise.all([rig.store, ...extras].map((store) => settle(store.install())));
      const kinds = results.map((result) => (result.ok ? result.value.kind : show(result)));
      const names = await schemaNames(rig);
      const right =
        kinds.filter((value) => value === 'installed').length === 1 &&
        kinds.filter((value) => value === 'current').length === 4 &&
        (await versions(rig)) === '[1]' &&
        JSON.stringify(names) === JSON.stringify(expectedNames);
      if (!right) {
        bad += 1;
        detail = `${kinds.join(',')}; versions ${await versions(rig)}; ${names.length} objects`;
      }
    } finally {
      await Promise.all(extras.map((store) => store.close()));
      await Promise.all(pools.map((pool) => pool.end()));
      await rig.dispose();
    }
  }
  report.check(
    `${label} five stores install the same empty database at once, ten times: exactly one installed, four current, one version row, every object once`,
    bad === 0,
    bad === 0 ? '10 of 10 trials' : `${bad} bad trials, last: ${detail}`,
  );
}

async function fileModes(report: Report): Promise<void> {
  const dir = scratchDir();
  const made = `${dir}/made.db`;
  const store = createSqliteStore({ path: made });
  await store.install();
  const mode = statSync(made).mode & 0o777;
  const journal = new DatabaseSync(made);
  const wal = journal.prepare('PRAGMA journal_mode').get();
  journal.close();
  await store.close();
  const existing = `${dir}/existing.db`;
  writeFileSync(existing, '', { mode: 0o644 });
  const reused = createSqliteStore({ path: existing });
  const outcome = await settle(reused.install());
  const reusedMode = statSync(existing).mode & 0o777;
  await reused.close();
  report.check(
    '[sqlite] install creates the file at mode 0600 in WAL mode, and uses an existing file as it is (mode kept, schema created)',
    mode === 0o600 &&
      wal?.journal_mode === 'wal' &&
      outcome.ok &&
      outcome.value.kind === 'installed' &&
      reusedMode === 0o644,
    `new file mode ${mode.toString(8)}, journal ${String(wal?.journal_mode)}; existing file mode ${reusedMode.toString(8)}, install ${show(outcome)}`,
  );
}

async function closeWithWork(kind: Kind, report: Report): Promise<void> {
  const label = `[${kind}]`;
  const rig = await makeRig(kind, { cleanupIntervalSeconds: 1 });
  try {
    const hold = kind === 'sqlite' ? 300 : 800;
    const ids = Array.from({ length: 20 }, () => tag('w'));
    await rig.store.ops.subjectEnsure({ userId: ids[0] ?? 'x' });
    await rig.hold('subjects', ids[0] ?? 'x', hold);
    const stamps: number[] = [];
    const began = performance.now();
    const units = ids.map((userId, index) =>
      settle(rig.store.ops.subjectEnsure({ userId })).then((outcome) => {
        stamps[index] = performance.now() - began;
        return outcome;
      }),
    );
    await sleepMs(20);
    const closeCalledAt = performance.now() - began;
    const closed = rig.store.close().then(() => performance.now() - began);
    const results = await Promise.all(units);
    const closedAt = await closed;
    const done = results.filter((outcome) => outcome.ok && outcome.value.kind === 'done').length;
    const refused = results.flatMap((outcome, index) => (isFailure(outcome, 'unavailable', 'no') ? [index] : []));
    const latestRefusal = Math.max(0, ...refused.map((index) => (stamps[index] ?? 0) - closeCalledAt));
    let consistent = true;
    for (const [index, userId] of ids.entries()) {
      const outcome = results[index];
      // biome-ignore lint/performance/noAwaitInLoops: twenty small reads, one after the other
      const stands = await rig.exists('subjects', userId);
      consistent = consistent && outcome !== undefined && (index === 0 || outcome.ok === stands);
    }
    const first = results[0];
    const expectedDone = kind === 'sqlite' ? 0 : 1;
    report.check(
      `${label} close with 20 units outstanding: every unit that had not begun is refused unavailable/no at once, every unit that had begun is answered, none is unknown, and each answer agrees with the database`,
      done + refused.length === 20 &&
        refused.length >= 1 &&
        done >= expectedDone &&
        latestRefusal <= 150 &&
        consistent &&
        (kind === 'sqlite' ? first !== undefined && isFailure(first, 'unavailable', 'no') : first?.ok === true),
      `done ${done}, refused ${refused.length}; the last refusal ${Math.round(latestRefusal)} ms after close was called (accepted 150 ms); the unit blocked on the lock ${first === undefined ? '-' : show(first)}; answers agree with rows: ${consistent}`,
    );
    report.check(
      `${label} close resolves after the last unit that had begun has ended`,
      closedAt >= Math.max(...stamps) - 1 && (kind === 'sqlite' || closedAt >= hold - 20),
      `close called at ${Math.round(closeCalledAt)} ms, resolved at ${Math.round(closedAt)} ms, last unit settled at ${Math.round(Math.max(...stamps))} ms`,
    );
    if (rig.appPool !== null) {
      const alive = await settle(rig.appPool.query('SELECT 1 AS one'));
      report.check(
        `${label} close leaves the application's Pool open and usable`,
        alive.ok && rig.appPool.ending === false,
        `pool query ${alive.ok ? 'answered' : 'failed'}`,
      );
    }
  } finally {
    await rig.dispose();
  }
}

async function closedStore(kind: Kind, report: Report): Promise<void> {
  const label = `[${kind}]`;
  const rig = await makeRig(kind);
  try {
    const { store } = rig;
    await store.close();
    const install = await settle(store.install());
    const attach = await settle(store.attach(attachConfig));
    const reads = await settle(store.ops.subjectRead({ userId: 'nobody' }));
    const writes = await settle(store.ops.subjectEnsure({ userId: tag('after') }));
    const sessions = await settle(store.ops.sessionRead({ digest: fresh() }));
    report.check(
      `${label} a closed store is finished: install, attach and every operation reject unavailable, applied no`,
      [install, attach, reads, writes, sessions].every((outcome) => isFailure(outcome, 'unavailable', 'no')),
      `install ${show(install)}; attach ${show(attach)}; read ${show(reads)}; write ${show(writes)}; session read ${show(sessions)}`,
    );
    const twice = await settle(Promise.all([store.close(), store.close()]));
    const third = await settle(store.close());
    report.check(
      `${label} close called again, at once twice and later a third time, resolves each time`,
      twice.ok && third.ok,
      `${show(twice)}; ${show(third)}`,
    );
  } finally {
    await rig.dispose();
  }
}

// Does:  Queues callers behind a single running unit on a one-client pool and closes the store.
async function queuedRefusedAtClose(report: Report): Promise<void> {
  const rig = await makeRig('postgres');
  const database = rig.database;
  if (database === null) {
    throw new Error('PostgreSQL rig without a database');
  }
  const pool = database.pool({ max: 2, application: 'proof-queued' });
  const store = createPostgresStore({ pool, maxClients: 1, cleanupIntervalSeconds: 3600 });
  try {
    await store.attach(attachConfig);
    const userId = tag('run');
    const digest = fresh();
    await rig.store.ops.subjectEnsure({ userId });
    await rig.store.ops.sessionIssue({
      userId,
      generation: 1,
      digest,
      replaces: null,
      idleMs: 60_000,
      absoluteMs: 60_000,
    });
    await rig.hold('sessions', digest, 1200);
    const began = performance.now();
    const stamp = (): number => performance.now() - began;
    const running = settle(store.ops.sessionRevoke({ digest })).then((outcome) => ({ outcome, at: stamp() }));
    await sleepMs(100);
    const waiting = Array.from({ length: 3 }, () => tag('queued'));
    const queued = waiting.map((id) =>
      settle(store.ops.subjectEnsure({ userId: id })).then((outcome) => ({ outcome, at: stamp() })),
    );
    await sleepMs(100);
    const closeCalledAt = stamp();
    const closed = store.close().then(stamp);
    const refusals = await Promise.all(queued);
    const refusedBy = Math.max(...refusals.map((refusal) => refusal.at)) - closeCalledAt;
    const stillRunning = await Promise.race([running.then(() => false), sleepMs(50).then(() => true)]);
    const answer = await running;
    const closedAt = await closed;
    let created = 0;
    for (const id of waiting) {
      // biome-ignore lint/performance/noAwaitInLoops: three small reads
      created += (await rig.exists('subjects', id)) ? 1 : 0;
    }
    report.check(
      '[postgres] three callers queued for the only client when close starts are refused unavailable/no at once and create nothing, while the running unit is still blocked',
      refusals.every((refusal) => isFailure(refusal.outcome, 'unavailable', 'no')) &&
        refusedBy <= 150 &&
        stillRunning &&
        created === 0,
      `${refusals.map((refusal) => show(refusal.outcome)).join(', ')}; the last refusal ${Math.round(refusedBy)} ms after close was called (accepted 150 ms); running unit still blocked ${stillRunning}; subjects created ${created}`,
    );
    report.check(
      '[postgres] the running unit finishes by its own bound with its answer (done, row revoked) and close resolves only after it',
      answer.outcome.ok &&
        answer.outcome.value.kind === 'done' &&
        answer.outcome.value.revoked &&
        closedAt >= answer.at - 1 &&
        closedAt >= 1000,
      `the unit answered ${show(answer.outcome)} at ${Math.round(answer.at)} ms (lock held 1,200 ms from 0); close resolved at ${Math.round(closedAt)} ms`,
    );
  } finally {
    await store.close();
    await pool.end();
    await rig.dispose();
  }
}

async function seedExpired(rig: Rig, rows: number): Promise<void> {
  if (rig.kind === 'postgres') {
    await rig.query(
      `INSERT INTO skeld_auth.sessions SELECT decode(md5(g::text) || md5('s' || g::text), 'hex'), 'bulk', 0, 0, 0, 1 FROM generate_series(1, ${rows}) g`,
    );
  } else {
    await rig.query(
      `WITH RECURSIVE c(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM c WHERE x < ${rows}) INSERT INTO sessions SELECT randomblob(32), 'bulk', 0, 0, 0, 1 FROM c`,
    );
  }
}

async function cleanupStopsAtClose(kind: Kind, report: Report): Promise<void> {
  const label = `[${kind}]`;
  const stopped = await makeRig(kind, { attach: false, cleanupIntervalSeconds: 1 });
  const running = await makeRig(kind, { attach: false, cleanupIntervalSeconds: 1 });
  try {
    for (const rig of [stopped, running]) {
      // biome-ignore lint/performance/noAwaitInLoops: two small seeds
      await seedExpired(rig, 50);
      await rig.store.attach(attachConfig);
    }
    await stopped.store.close();
    await sleepMs(2600);
    const left = await stopped.count('sessions');
    const cleaned = await running.count('sessions');
    report.check(
      `${label} close stops the maintenance timer: 50 expired rows are still there 2.6 s after a close at a 1 s interval, while the store left open removed its 50 (control)`,
      left === 50 && cleaned === 0,
      `closed store: ${left} rows left; open store: ${cleaned} rows left`,
    );
  } finally {
    await stopped.dispose();
    await running.dispose();
  }
}

interface Staged {
  readonly userId: string;
  readonly expiredSession: Uint8Array;
  readonly liveSession: Uint8Array;
  readonly liveExpiresAt: number;
  readonly expiredState: Uint8Array;
  readonly liveState: Uint8Array;
  readonly binding: Uint8Array;
  readonly expiredKey: string;
  readonly liveKey: string;
  readonly expiredWindow: Uint8Array;
  readonly liveWindow: Uint8Array;
}

async function stage(store: AuthStore): Promise<Staged> {
  const { ops } = store;
  const userId = tag('re');
  const expiredSession = fresh();
  const liveSession = fresh();
  const expiredState = fresh();
  const liveState = fresh();
  const binding = fresh();
  const expiredKey = tag('ek').slice(0, 16);
  const liveKey = tag('lk').slice(0, 16);
  const expiredWindow = fresh();
  const liveWindow = fresh();
  await ops.subjectEnsure({ userId });
  await ops.sessionIssue({
    userId,
    generation: 1,
    digest: expiredSession,
    replaces: null,
    idleMs: 400,
    absoluteMs: 400,
  });
  const live = await ops.sessionIssue({
    userId,
    generation: 1,
    digest: liveSession,
    replaces: null,
    idleMs: 60_000,
    absoluteMs: 60_000,
  });
  await ops.attemptCreate({
    state: expiredState,
    binding,
    provider: 'gh',
    nonce: 'n',
    verifier: 'v',
    returnPath: '/',
    ttlMs: 400,
  });
  await ops.attemptCreate({
    state: liveState,
    binding,
    provider: 'gh',
    nonce: 'n',
    verifier: 'v',
    returnPath: '/',
    ttlMs: 60_000,
  });
  await ops.apiKeyIssue({
    userId,
    keyId: expiredKey,
    digest: fresh(),
    name: 'e',
    scopes: ['p:a'],
    expiresInMs: 400,
    max: 5,
  });
  await ops.apiKeyIssue({
    userId,
    keyId: liveKey,
    digest: fresh(),
    name: 'l',
    scopes: ['p:a'],
    expiresInMs: null,
    max: 5,
  });
  await ops.limitCharge({ key: expiredWindow, max: 1, windowMs: 400 });
  await ops.limitCharge({ key: liveWindow, max: 1, windowMs: 60_000 });
  if (live.kind !== 'done') {
    throw new Error('live session was not issued');
  }
  return {
    userId,
    expiredSession,
    liveSession,
    liveExpiresAt: live.expiresAt,
    expiredState,
    liveState,
    binding,
    expiredKey,
    liveKey,
    expiredWindow,
    liveWindow,
  };
}

async function reopened(rig: Rig, reopen: () => AuthStore, report: Report): Promise<void> {
  const label = `[${rig.kind}]`;
  const staged = await stage(rig.store);
  const expiresBefore = await rig.value('sessions', staged.expiredSession, 'expires_at');
  await rig.store.close();
  await sleepMs(700);
  const store = reopen();
  const installed = await settle(store.install());
  const attached = await settle(store.attach(attachConfig));
  report.check(
    `${label} reopen after a close: install answers current and attach answers attached on the same data`,
    installed.ok && installed.value.kind === 'current' && attached.ok && attached.value.kind === 'attached',
    `${show(installed)}, ${show(attached)}`,
  );
  const { ops } = store;
  const read = await settle(ops.sessionRead({ digest: staged.expiredSession }));
  const renew = await settle(ops.sessionRenew({ digest: staged.expiredSession, idleMs: 60_000 }));
  const rotate = await settle(
    ops.sessionRotate({ userId: staged.userId, digest: staged.expiredSession, next: fresh(), idleMs: 60_000 }),
  );
  const consume = await settle(
    ops.attemptConsume({ state: staged.expiredState, binding: staged.binding, provider: 'gh' }),
  );
  const key = await settle(ops.apiKeyRead({ keyId: staged.expiredKey }));
  const list = await settle(ops.apiKeyList({ userId: staged.userId, limit: 10 }));
  const charge = await settle(ops.limitCharge({ key: staged.expiredWindow, max: 1, windowMs: 60_000 }));
  report.check(
    `${label} the session that expired while the store was closed is not readable, not renewable and not rotatable`,
    read.ok &&
      read.value === null &&
      renew.ok &&
      renew.value.kind === 'lost' &&
      rotate.ok &&
      rotate.value.kind === 'lost' &&
      (await rig.value('sessions', staged.expiredSession, 'expires_at')) === expiresBefore,
    `read ${show(read)}, renew ${show(renew)}, rotate ${show(rotate)}; its expires_at ${expiresBefore} before and ${await rig.value('sessions', staged.expiredSession, 'expires_at')} after`,
  );
  report.check(
    `${label} the attempt, the API key and the limit window that expired while closed are not usable: the attempt is gone, the key unreadable and unlisted, the charge opens a new window at count 1`,
    consume.ok &&
      consume.value.kind === 'lost' &&
      key.ok &&
      key.value === null &&
      list.ok &&
      list.value.keys.every((info) => info.keyId !== staged.expiredKey) &&
      charge.ok &&
      charge.value.kind === 'done' &&
      charge.value.count === 1,
    `attempt ${show(consume)}, key ${show(key)}, listed keys ${list.ok ? list.value.keys.map((info) => (info.keyId === staged.liveKey ? 'live' : 'other')).join(',') : '-'}, charge ${show(charge)}`,
  );
  const liveRead = await settle(ops.sessionRead({ digest: staged.liveSession }));
  const liveKey = await settle(ops.apiKeyRead({ keyId: staged.liveKey }));
  const liveCharge = await settle(ops.limitCharge({ key: staged.liveWindow, max: 1, windowMs: 60_000 }));
  const liveConsume = await settle(
    ops.attemptConsume({ state: staged.liveState, binding: staged.binding, provider: 'gh' }),
  );
  report.check(
    `${label} what was live at the close is still live after the reopen, unchanged: the session with its expiry, the key, the full window and the attempt`,
    liveRead.ok &&
      liveRead.value !== null &&
      liveRead.value.expiresAt === staged.liveExpiresAt &&
      liveKey.ok &&
      liveKey.value !== null &&
      liveCharge.ok &&
      liveCharge.value.kind === 'lost' &&
      liveConsume.ok &&
      liveConsume.value.kind === 'done',
    `session ${liveRead.ok && liveRead.value !== null ? `expires ${liveRead.value.expiresAt} (was ${staged.liveExpiresAt})` : show(liveRead)}, key ${show(liveKey)}, window ${show(liveCharge)}, attempt ${show(liveConsume)}`,
  );
  const removed = await settle(ops.expiredRemove({ limit: 1000 }));
  const sessionsLeft = await rig.exists('sessions', staged.expiredSession);
  const keysLeft = await rig.exists('api_keys', staged.expiredKey);
  report.check(
    `${label} cleanup after the reopen removes the expired rows and leaves the live ones`,
    removed.ok &&
      removed.value.removed >= 2 &&
      !sessionsLeft &&
      !keysLeft &&
      (await rig.exists('sessions', staged.liveSession)) &&
      (await rig.exists('api_keys', staged.liveKey)),
    `removed ${removed.ok ? removed.value.removed : '-'}; expired session row ${sessionsLeft ? 'left' : 'gone'}, expired key row ${keysLeft ? 'left' : 'gone'}`,
  );
  await store.close();
}

async function reopenCase(kind: Kind, report: Report): Promise<void> {
  const rig = await makeRig(kind);
  try {
    if (kind === 'sqlite') {
      await reopened(rig, () => createSqliteStore({ path: rig.path, cleanupIntervalSeconds: 3600 }), report);
    } else {
      const database = rig.database;
      if (database === null) {
        throw new Error('PostgreSQL rig without a database');
      }
      const pool = database.pool({ max: 4, application: 'proof-reopen' });
      try {
        await reopened(rig, () => createPostgresStore({ pool, cleanupIntervalSeconds: 3600 }), report);
      } finally {
        await pool.end();
      }
    }
  } finally {
    await rig.dispose();
  }
}

async function unparseableRow(kind: Kind, report: Report): Promise<void> {
  const label = `[${kind}]`;
  const rig = await makeRig(kind);
  try {
    const { ops } = rig.store;
    const digestSql = kind === 'sqlite' ? 'hex(digest)' : "encode(digest, 'hex')";
    const snapshot = async (keyId: string): Promise<string> =>
      JSON.stringify(
        await rig.query(
          `SELECT key_id, user_id, ${digestSql} AS d, name, scopes, created_at, expires_at FROM api_keys WHERE key_id = ?`,
          [keyId],
        ),
      );
    const healthyUser = tag('ok');
    const healthyKey = tag('hk');
    await ops.apiKeyIssue({
      userId: healthyUser,
      keyId: healthyKey,
      digest: fresh(),
      name: 'h',
      scopes: ['p:a'],
      expiresInMs: null,
      max: 3,
    });
    const corrupt = [
      { what: 'a digest of 31 bytes', keyId: tag('bd'), digest: new Uint8Array(31), scopes: 'p:a' },
      { what: 'an empty scope list', keyId: tag('es'), digest: fresh(), scopes: '' },
      { what: 'two spaces between scopes', keyId: tag('ds'), digest: fresh(), scopes: 'p:a  p:b' },
      { what: 'a trailing space after a scope', keyId: tag('ts'), digest: fresh(), scopes: 'p:a ' },
    ];
    for (const row of corrupt) {
      // biome-ignore lint/performance/noAwaitInLoops: each corrupt row is written, read and judged on its own
      await rig.query(
        'INSERT INTO api_keys (key_id, user_id, digest, name, scopes, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [row.keyId, healthyUser, row.digest, 'bad', row.scopes, 0, null],
      );
      const before = await snapshot(row.keyId);
      const eventsBefore = rig.events.length;
      const outcome = await settle(ops.apiKeyRead({ keyId: row.keyId }));
      const healthy = await settle(ops.apiKeyRead({ keyId: healthyKey }));
      const unrelated = await settle(ops.subjectRead({ userId: 'nobody' }));
      report.check(
        `${label} a stored api_keys row with ${row.what}: the read rejects record, applied no, code null; the store called onFailure ${rig.events.length - eventsBefore} times; the row is unchanged; other rows stay readable`,
        isFailure(outcome, 'record', 'no') &&
          failureCode(outcome) === null &&
          rig.events.length === eventsBefore &&
          (await snapshot(row.keyId)) === before &&
          before !== '[]' &&
          healthy.ok &&
          healthy.value !== null &&
          unrelated.ok,
        `${show(outcome)}; onFailure calls ${rig.events.length - eventsBefore}; row ${before === (await snapshot(row.keyId)) ? 'byte for byte as written' : 'CHANGED'}; healthy key ${healthy.ok && healthy.value !== null ? 'resolves' : show(healthy)}; unrelated read ${show(unrelated)}`,
      );
    }
    if (kind === 'sqlite') {
      const userId = tag('ty');
      const digest = fresh();
      await rig.query(
        'INSERT INTO sessions (digest, user_id, created_at, last_seen_at, absolute_expires_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)',
        [digest, userId, 'not a number', 0, 9_000_000_000_000, 9_000_000_000_000],
      );
      const outcome = await settle(ops.sessionRead({ digest }));
      const rows = await rig.count('sessions', 'user_id', userId);
      report.check(
        '[sqlite] a stored sessions row whose created_at is text (SQLite lets the column hold it): the read rejects record, applied no, code null, and the row is still there',
        isFailure(outcome, 'record', 'no') && failureCode(outcome) === null && rows === 1,
        `${show(outcome)}; row present ${rows === 1}`,
      );
    }
  } finally {
    await rig.dispose();
  }
}

async function memoryStore(report: Report): Promise<void> {
  const first = createSqliteStore({ path: ':memory:' });
  await first.install();
  await first.attach(attachConfig);
  await first.ops.subjectEnsure({ userId: 'x' });
  await first.close();
  const second = createSqliteStore({ path: ':memory:' });
  const attached = await settle(second.attach(attachConfig));
  await second.close();
  report.check(
    '[sqlite :memory:] a closed in-memory store keeps nothing: a new one answers not_installed',
    attached.ok && attached.value.kind === 'not_installed',
    show(attached),
  );
}

// Does:  The child of the crash proof: issues short sessions as fast as it can and prints each acknowledged digest.
async function runChild(path: string): Promise<void> {
  const store = createSqliteStore({ path, cleanupIntervalSeconds: 3600 });
  await store.attach(attachConfig);
  await store.ops.subjectEnsure({ userId: 'crash' });
  process.stdout.write('ready\n');
  for (;;) {
    const digest = fresh();
    // biome-ignore lint/performance/noAwaitInLoops: each acknowledgement is printed before the next call starts
    const issued = await store.ops.sessionIssue({
      userId: 'crash',
      generation: 1,
      digest,
      replaces: null,
      idleMs: 1500,
      absoluteMs: 1500,
    });
    process.stdout.write(`ack ${hex(digest)} ${issued.kind}\n`);
  }
}

async function killedProcess(report: Report): Promise<void> {
  const rig = await makeRig('sqlite', { attach: false });
  try {
    await rig.store.close();
    const child = spawn(
      process.execPath,
      ['--conditions=skeld-source', fileURLToPath(import.meta.url), 'child', rig.path],
      { stdio: ['ignore', 'pipe', 'inherit'] },
    );
    const acknowledged: string[] = [];
    let ready = false;
    for await (const line of createInterface({ input: child.stdout })) {
      if (line === 'ready') {
        ready = true;
      }
      const parts = line.split(' ');
      if (parts[0] === 'ack' && parts[1] !== undefined && parts[2] === 'done') {
        acknowledged.push(parts[1]);
      }
      if (acknowledged.length >= 150) {
        child.kill('SIGKILL');
        break;
      }
    }
    await new Promise((resolve) => child.once('exit', resolve));
    const killedAt = Date.now();
    const db = new DatabaseSync(rig.path, { timeout: 2000 });
    const integrity = db.prepare('PRAGMA integrity_check').get();
    const present = db.prepare('SELECT count(*) AS n FROM sessions').get();
    const missing = acknowledged.filter((digest) => {
      const row = db.prepare('SELECT count(*) AS n FROM sessions WHERE hex(digest) = upper(?)').get(digest);
      return Number(row?.n) !== 1;
    }).length;
    db.close();
    const store = createSqliteStore({ path: rig.path, cleanupIntervalSeconds: 3600 });
    const attached = await settle(store.attach(attachConfig));
    await sleepMs(Math.max(0, 1700 - (Date.now() - killedAt)));
    let usable = 0;
    for (const digest of acknowledged) {
      // biome-ignore lint/performance/noAwaitInLoops: 150 small reads, one after the other
      const read = await store.ops.sessionRead({ digest: new Uint8Array(Buffer.from(digest, 'hex')) });
      if (read !== null) {
        usable += 1;
      }
    }
    const removed = await settle(store.ops.expiredRemove({ limit: 1000 }));
    const after = await settle(store.ops.subjectRead({ userId: 'crash' }));
    await store.close();
    report.check(
      '[sqlite] a process killed with SIGKILL while issuing sessions: the file passes integrity_check, reopens and attaches, and every acknowledged session was committed',
      ready &&
        integrity?.integrity_check === 'ok' &&
        attached.ok &&
        attached.value.kind === 'attached' &&
        missing === 0,
      `${acknowledged.length} acknowledged before the kill, ${String(present?.n)} rows on disk, ${missing} acknowledged missing; integrity ${String(integrity?.integrity_check)}; ${show(attached)}`,
    );
    report.check(
      '[sqlite] after the kill and a reopen past their 1.5 s lifetime, none of the sessions is usable or restored, and cleanup removes them',
      usable === 0 && removed.ok && removed.value.removed >= acknowledged.length && after.ok,
      `${usable} of ${acknowledged.length} readable; cleanup removed ${removed.ok ? removed.value.removed : '-'} (the one in flight at the kill may be included); the fence survived: ${show(after)}`,
    );
  } finally {
    await rig.dispose();
  }
}

async function main(): Promise<void> {
  const report = createReport(
    's06',
    'store-install',
    'install and the version check are explicit on both adapters, concurrent installs end in one schema, and a closed, reopened or killed store restores and exposes no expired state',
  );
  try {
    for (const kind of rigKinds) {
      report.note(`== ${kind}`);
      /* biome-ignore lint/performance/noAwaitInLoops: one adapter at a time */
      await report.run(`${kind} lifecycle`, () => lifecycle(kind, report));
      await report.run(`${kind} mismatch and unreadable`, () => mismatchAndUnreadable(kind, report));
      await report.run(`${kind} concurrent installs`, () => concurrentInstalls(kind, report));
      await report.run(`${kind} close with work outstanding`, () => closeWithWork(kind, report));
      await report.run(`${kind} closed store`, () => closedStore(kind, report));
      await report.run(`${kind} unparseable row`, () => unparseableRow(kind, report));
      await report.run(`${kind} cleanup stops at close`, () => cleanupStopsAtClose(kind, report));
      await report.run(`${kind} reopen`, () => reopenCase(kind, report));
    }
    await report.run('postgres queued callers at close', () => queuedRefusedAtClose(report));
    await report.run('sqlite file modes', () => fileModes(report));
    await report.run('sqlite memory', () => memoryStore(report));
    await report.run('sqlite killed process', () => killedProcess(report));
  } finally {
    await cleanAll();
  }
  report.finish();
}

if (process.argv[2] === 'child') {
  await runChild(process.argv[3] ?? '');
} else {
  await main();
}
