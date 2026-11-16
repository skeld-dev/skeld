// Does:  Proves an unanswered COMMIT is reported unknown, never as success or as not applied, and is never replayed.
// Holds: PostgreSQL's COMMIT is cut on a proxy, SQLite's fails under a file-size limit, and the database is read after.

import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import net from 'node:net';
import { join } from 'node:path';
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
  makeRig,
  pgBase,
  type Rig,
  scratchDir,
  settle,
  show,
  sleepMs,
} from './support-store.ts';

let uncaught = 0;
process.on('uncaughtException', () => {
  uncaught += 1;
});

type Mode = 'drop-reply' | 'drop-request';

interface Counts {
  begin: number;
  commit: number;
  rollback: number;
}

interface CuttingProxy {
  readonly port: number;
  readonly counts: Counts;
  arm: (mode: Mode) => void;
  reset: () => void;
  close: () => Promise<void>;
}

// Does:  Forwards a PostgreSQL connection and, once armed, cuts the next COMMIT or the server's answer to it.
async function cuttingProxy(): Promise<CuttingProxy> {
  const base = pgBase();
  const target = { host: base.hostname, port: Number(base.port) };
  const counts: Counts = { begin: 0, commit: 0, rollback: 0 };
  let armed: Mode | null = null;
  const sockets = new Set<net.Socket>();
  const commitNeedle = Buffer.from('COMMIT\0');
  const rollbackNeedle = Buffer.from('ROLLBACK\0');
  const beginNeedle = Buffer.from('BEGIN ISOLATION');
  const server = net.createServer((client) => {
    const upstream = net.connect(target);
    sockets.add(client);
    sockets.add(upstream);
    let dropping = false;
    const end = (): void => {
      client.destroy();
      upstream.destroy();
    };
    client.on('data', (received) => {
      const chunk = typeof received === 'string' ? Buffer.from(received, 'latin1') : received;
      if (chunk.includes(beginNeedle)) {
        counts.begin += 1;
      }
      if (chunk.includes(rollbackNeedle)) {
        counts.rollback += 1;
      }
      if (chunk.includes(commitNeedle)) {
        counts.commit += 1;
        if (armed === 'drop-request') {
          armed = null;
          end();
          return;
        }
        if (armed === 'drop-reply') {
          armed = null;
          dropping = true;
        }
      }
      upstream.write(chunk);
    });
    upstream.on('data', (received) => {
      const chunk = typeof received === 'string' ? Buffer.from(received, 'latin1') : received;
      if (dropping) {
        end();
        return;
      }
      client.write(chunk);
    });
    client.on('error', () => undefined);
    upstream.on('error', () => undefined);
    client.on('close', () => upstream.destroy());
    upstream.on('close', () => client.destroy());
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('proxy has no port');
  }
  return {
    port: address.port,
    counts,
    arm: (mode) => {
      armed = mode;
    },
    reset: () => {
      counts.begin = 0;
      counts.commit = 0;
      counts.rollback = 0;
    },
    close: () =>
      new Promise<void>((resolve) => {
        for (const socket of sockets) {
          socket.destroy();
        }
        server.close(() => resolve());
      }),
  };
}

interface Prepared {
  readonly call: () => Promise<unknown>;
  readonly stands: () => Promise<boolean>;
}

interface Scenario {
  readonly name: string;
  readonly prepare: (rig: Rig, store: AuthStore) => Promise<Prepared>;
}

const tag = (prefix: string): string => `${prefix}-${randomBytes(6).toString('hex')}`;

const scenarios: readonly Scenario[] = [
  {
    name: 'sessionIssue',
    prepare: async (rig, store) => {
      const userId = tag('issue');
      const digest = fresh();
      await rig.store.ops.subjectEnsure({ userId });
      return {
        call: () =>
          store.ops.sessionIssue({ userId, generation: 1, digest, replaces: null, idleMs: 60_000, absoluteMs: 60_000 }),
        stands: () => rig.exists('sessions', digest),
      };
    },
  },
  {
    name: 'sessionRotate',
    prepare: async (rig, store) => {
      const userId = tag('rotate');
      const old = fresh();
      const next = fresh();
      await rig.store.ops.subjectEnsure({ userId });
      await rig.store.ops.sessionIssue({
        userId,
        generation: 1,
        digest: old,
        replaces: null,
        idleMs: 60_000,
        absoluteMs: 60_000,
      });
      return {
        call: () => store.ops.sessionRotate({ userId, digest: old, next, idleMs: 60_000 }),
        stands: async () => (await rig.exists('sessions', next)) && !(await rig.exists('sessions', old)),
      };
    },
  },
  {
    name: 'subjectDisable',
    prepare: async (rig, store) => {
      const userId = tag('disable');
      await rig.store.ops.subjectEnsure({ userId });
      return {
        call: () => store.ops.subjectDisable({ userId }),
        stands: async () => (await rig.value('subjects', userId, 'generation')) === 2,
      };
    },
  },
  {
    name: 'apiKeyIssue',
    prepare: async (rig, store) => {
      const userId = tag('key');
      const keyId = tag('k');
      await rig.store.ops.subjectEnsure({ userId });
      return {
        call: () =>
          store.ops.apiKeyIssue({
            userId,
            keyId,
            digest: fresh(),
            name: 'n',
            scopes: ['p:a'],
            expiresInMs: null,
            max: 3,
          }),
        stands: () => rig.exists('api_keys', keyId),
      };
    },
  },
  {
    name: 'limitCharge',
    prepare: (rig, store) => {
      const key = fresh();
      return Promise.resolve({
        call: () => store.ops.limitCharge({ key, max: 5, windowMs: 60_000 }),
        stands: () => rig.exists('limit_windows', key),
      });
    },
  },
];

async function lostCommit(rig: Rig, report: ReturnType<typeof createReport>): Promise<void> {
  const database = rig.database;
  if (database === null) {
    throw new Error('PostgreSQL rig without a database');
  }
  const proxy = await cuttingProxy();
  const pool = database.pool({ max: 2, application: 'proof-proxy', port: proxy.port });
  const store = createPostgresStore({ pool, maxClients: 2, cleanupIntervalSeconds: 3600 });
  const events: StoreEvent[] = [];
  await store.attach({ onFailure: (event) => events.push(event) });
  try {
    for (const scenario of scenarios) {
      for (const mode of ['drop-reply', 'drop-request'] as const) {
        // biome-ignore lint/performance/noAwaitInLoops: each fault is cut on its own connection, one at a time
        const prepared = await scenario.prepare(rig, store);
        proxy.reset();
        proxy.arm(mode);
        const outcome = await settle(prepared.call());
        // Why: A replay would start within the pool's reconnect; 1.5 s after the cut is long enough to see its BEGIN.
        await sleepMs(1500);
        const standing = await prepared.stands();
        const { begin, commit, rollback } = proxy.counts;
        const expectStands = mode === 'drop-reply';
        const what =
          mode === 'drop-reply'
            ? 'the server committed and its answer was dropped'
            : 'the COMMIT was dropped before the server saw it';
        report.check(
          `[postgres] ${scenario.name}, ${what}: rejected unknown, never success`,
          isFailure(outcome, 'unavailable', 'unknown'),
          `${show(outcome)} code ${String(failureCode(outcome))}`,
        );
        report.check(
          `[postgres] ${scenario.name}, ${what}: the database ${expectStands ? 'holds' : 'does not hold'} the change`,
          standing === expectStands,
          `change ${standing ? 'stands' : 'absent'} 1.5 s after`,
        );
        report.check(
          `[postgres] ${scenario.name}, ${what}: nothing replayed (one BEGIN, one COMMIT, no ROLLBACK on the wire)`,
          begin === 1 && commit === 1 && rollback === 0,
          `BEGIN ${begin}, COMMIT ${commit}, ROLLBACK ${rollback} in 1.5 s`,
        );
      }
    }
    const reads = await settle(store.ops.subjectRead({ userId: 'nobody' }));
    report.check(
      '[postgres] the store works again after the cut connections (the clients were destroyed, not reused)',
      reads.ok,
      show(reads),
    );
    report.check(
      '[postgres] the callers received the failures, so onFailure reported none of the cut operations',
      events.every((event) => event.operation === 'pool'),
      `${events.length} events: ${[...new Set(events.map((event) => `${event.operation}/${event.cause}`))].join(', ')}`,
    );
  } finally {
    await store.close();
    await pool.end();
    await proxy.close();
  }
}

async function endedBeforeCommit(rig: Rig, report: ReturnType<typeof createReport>): Promise<void> {
  const database = rig.database;
  if (database === null) {
    throw new Error('PostgreSQL rig without a database');
  }
  const pool = database.pool({ max: 2, application: 'proof-kill' });
  const store = createPostgresStore({ pool, maxClients: 2, cleanupIntervalSeconds: 3600 });
  await store.attach({ onFailure: () => undefined });
  const userId = tag('kill');
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
  await rig.hold('sessions', digest, 1500);
  const call = settle(store.ops.sessionRevoke({ digest }));
  await sleepMs(400);
  const killed = await rig.query(
    "SELECT count(*)::int AS n FROM (SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = current_database() AND application_name = 'proof-kill' AND wait_event_type = 'Lock') AS t",
  );
  const outcome = await call;
  await sleepMs(1300);
  const afterwards = await settle(store.ops.sessionRead({ digest }));
  report.check(
    '[postgres] a backend ended while the unit waited on its row lock (earlier statement unanswered, COMMIT never sent): unavailable, applied no',
    Number(killed[0]?.n) === 1 && isFailure(outcome, 'unavailable', 'no') && (await rig.exists('sessions', digest)),
    `${killed[0]?.n} backend ended; ${show(outcome)}; row ${(await rig.exists('sessions', digest)) ? 'stands' : 'deleted'} after the lock was released`,
  );
  report.check(
    '[postgres] and the store reads the row again on a new connection',
    afterwards.ok && afterwards.value !== null,
    show(afterwards),
  );
  report.check(
    '[postgres] no uncaught client error ended or disturbed the process through the cut connections and the killed backend',
    uncaught === 0,
    `${uncaught} uncaught exceptions`,
  );
  await store.close();
  await pool.end();
}

// Does:  The child of the SQLite proof: runs two sessionIssue calls on lines from its parent and prints each outcome.
async function runChild(path: string): Promise<void> {
  // Why: Without a handler SIGXFSZ ends the process; with one the write fails with EFBIG and SQLite reports it.
  process.on('SIGXFSZ', () => undefined);
  const store = createSqliteStore({ path });
  process.stdout.write(`attach ${(await store.attach({ onFailure: () => undefined })).kind}\n`);
  const lines = createInterface({ input: process.stdin })[Symbol.asyncIterator]();
  const issue = async (label: string): Promise<void> => {
    const digest = fresh();
    const outcome = await settle(
      store.ops.sessionIssue({
        userId: 'u',
        generation: 1,
        digest,
        replaces: null,
        idleMs: 60_000,
        absoluteMs: 60_000,
      }),
    );
    const code = failureCode(outcome);
    process.stdout.write(`${label} ${show(outcome)} code ${String(code)} digest ${hex(digest)}\n`);
  };
  process.stdout.write('ready\n');
  for (const label of ['first', 'second']) {
    // biome-ignore lint/performance/noAwaitInLoops: the parent drives the child one line at a time
    await lines.next();
    await issue(label);
  }
  await store.close();
}

function rowsHolding(path: string, digestHex: string): number {
  const db = new DatabaseSync(path, { timeout: 2000 });
  try {
    const row = db.prepare('SELECT count(*) AS n FROM sessions WHERE hex(digest) = upper(?)').get(digestHex);
    return Number(row?.n);
  } finally {
    db.close();
  }
}

async function failedCommit(report: ReturnType<typeof createReport>): Promise<void> {
  const dir = scratchDir();
  const path = join(dir, 'auth.db');
  const setup = createSqliteStore({ path });
  await setup.install();
  await setup.attach({ onFailure: () => undefined });
  await setup.ops.subjectEnsure({ userId: 'u' });
  await setup.close();
  const tidy = new DatabaseSync(path);
  // biome-ignore lint/security/noSecrets: SQL pragma text, not a credential
  tidy.exec('PRAGMA wal_checkpoint(TRUNCATE)');
  tidy.close();
  const child = spawn(process.execPath, ['--conditions=skeld-source', fileURLToPath(import.meta.url), 'child', path], {
    stdio: ['pipe', 'pipe', 'inherit'],
  });
  const lines = createInterface({ input: child.stdout })[Symbol.asyncIterator]();
  const nextLine = async (): Promise<string> => {
    const line = await lines.next();
    return line.done === true ? '' : line.value;
  };
  const limit = (size: string): void => {
    spawnSync('prlimit', ['--pid', String(child.pid), `--fsize=${size}`]);
  };
  await nextLine();
  await nextLine();
  limit('1:');
  child.stdin.write('go\n');
  const first = await nextLine();
  const firstDigest = first.slice(first.indexOf('digest ') + 7);
  const heldAfterFailure = rowsHolding(path, firstDigest);
  limit('unlimited:');
  // Why: A replay would start on a timer within a few hundred ms, and with the limit lifted it could now succeed.
  await sleepMs(1500);
  const heldAfterLift = rowsHolding(path, firstDigest);
  child.stdin.write('go\n');
  const second = await nextLine();
  const secondDigest = second.slice(second.indexOf('digest ') + 7);
  child.stdin.end();
  await new Promise((resolve) => child.once('exit', resolve));
  const integrity = new DatabaseSync(path);
  const check = integrity.prepare('PRAGMA integrity_check').get();
  integrity.close();
  report.check(
    '[sqlite] a COMMIT that fails (file-size limit of 1 byte on a child process): rejected unknown, never success',
    first.startsWith('first StoreFailure unavailable/unknown/'),
    first.slice(0, first.indexOf(' digest')),
  );
  report.check(
    '[sqlite] the database does not hold the change after the failure',
    heldAfterFailure === 0,
    `${heldAfterFailure} rows with the digest`,
  );
  report.check(
    '[sqlite] with the limit lifted and 1.5 s passed, nothing was replayed: the digest is still absent',
    heldAfterLift === 0,
    `${heldAfterLift} rows with the digest`,
  );
  report.check(
    '[sqlite] the store works on the same connection afterwards: a new call is done and only the new digest is stored',
    second.startsWith('second done ') && rowsHolding(path, secondDigest) === 1 && rowsHolding(path, firstDigest) === 0,
    second.slice(0, second.indexOf(' digest')),
  );
  report.check(
    '[sqlite] the file passes PRAGMA integrity_check',
    check?.integrity_check === 'ok',
    String(check?.integrity_check),
  );
}

async function main(): Promise<void> {
  const report = createReport(
    's05',
    'store-unknown-outcome',
    'a COMMIT whose answer never arrives is reported unknown (not success, not not-applied) on PostgreSQL and SQLite, the database is read to show what happened, and nothing is replayed',
  );
  const rig = await makeRig('postgres');
  try {
    await report.run('[postgres] lost COMMIT', () => lostCommit(rig, report));
    await report.run('[postgres] backend ended before COMMIT', () => endedBeforeCommit(rig, report));
    await report.run('[sqlite] failed COMMIT', () => failedCommit(report));
  } finally {
    await rig.dispose();
    await cleanAll();
  }
  report.finish();
}

if (process.argv[2] === 'child') {
  await runChild(process.argv[3] ?? '');
} else {
  await main();
}
