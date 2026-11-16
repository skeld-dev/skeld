// Does:  Proves unparseable stored rows are refused, the SQLite file mode, attach creating nothing and close behavior.
// Holds: A stored row that does not parse is never read as a record; close leaves the application's Pool open.

import { randomBytes } from 'node:crypto';
import { existsSync, statSync, writeFileSync } from 'node:fs';
// biome-ignore lint/correctness/noUnresolvedImports: Biome's Node module list lacks node:sqlite, which Node 26 ships
import { DatabaseSync } from 'node:sqlite';
import { createSqliteStore } from '@skeld/auth/sqlite';
import type { StoreEvent } from '@skeld/auth/store';
import {
  cleanAll,
  failureCode,
  fresh,
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
import { createReport } from './rig/report.ts';

type Report = ReturnType<typeof createReport>;

const tag = (prefix: string): string => `${prefix}-${randomBytes(6).toString('hex')}`;
const attachConfig = Object.freeze({ onFailure: (_event: StoreEvent) => undefined });

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
  } finally {
    await rig.dispose();
  }
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

async function closeLeavesPool(kind: Kind, report: Report): Promise<void> {
  const label = `[${kind}]`;
  const rig = await makeRig(kind);
  try {
    await rig.store.close();
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

async function main(): Promise<void> {
  const report = createReport(
    'attach on a store never installed creates nothing; a stored row that does not parse is a record failure; the SQLite file is created private; close stops the maintenance timer and leaves the application Pool open',
  );
  try {
    for (const kind of rigKinds) {
      report.note(`== ${kind}`);
      /* biome-ignore lint/performance/noAwaitInLoops: one adapter at a time */
      await report.run(`${kind} lifecycle`, () => lifecycle(kind, report));
      await report.run(`${kind} close leaves the Pool`, () => closeLeavesPool(kind, report));
      await report.run(`${kind} unparseable row`, () => unparseableRow(kind, report));
      await report.run(`${kind} cleanup stops at close`, () => cleanupStopsAtClose(kind, report));
    }
    await report.run('sqlite file modes', () => fileModes(report));
    await report.run('sqlite memory', () => memoryStore(report));
  } finally {
    await cleanAll();
  }
  report.finish();
}

await main();
