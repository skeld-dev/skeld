// Does:  Proves that a store outage fails every required store check closed with 503 while other requests continue.
// Holds: Each outage is real (a database refusing connections, a held write lock), never an injected rejection.

import { randomBytes } from 'node:crypto';
import { Client, type Pool } from 'pg';
import { createPostgresStore, type PgPool } from '@skeld/auth/postgres';
import { type AuthStore, type StoreEvent, StoreFailure } from '@skeld/auth/store';
import { expose } from '@skeld/core/secret';
import {
  cookieHeader,
  get,
  type Reply,
  send,
  series,
  signJwt,
  sleepMs,
  startApp,
  type App,
  observe,
  type Observed,
} from './rig/v1-app.ts';
import { createReport } from './rig/report.ts';
import { cleanAll, type Kind, makeRig, pgBase, type Rig, rigKinds } from './support-store.ts';

const statement =
  'while the store a check needs is unavailable every request whose required check cannot run is refused 503 AUTH_UNAVAILABLE and never admitted; public requests, optional requests with no credential and JWT requests under a policy with no limit continue; nothing is served from a cache or fallback and service resumes when the store answers';
const report = createReport(statement);

const NAME = '__Host-skeld';
const UNAVAILABLE = '{"status":503,"code":"AUTH_UNAVAILABLE","message":"Service unavailable"}';

interface Credentials {
  readonly session: string;
  readonly csrf: string;
  readonly key: string;
  readonly jwt: string;
}

interface Probe {
  readonly name: string;
  readonly continues: boolean;
  readonly run: (app: App, c: Credentials) => Promise<Reply>;
}

const probes: readonly Probe[] = [
  { name: 'GET /ping (public)', continues: true, run: (app) => get(app.port, '/ping') },
  {
    name: 'GET /ping (public) with a garbage cookie and a garbage authorization',
    continues: true,
    run: (app) => get(app.port, '/ping', [cookieHeader(NAME, 'garbage'), 'authorization: Bearer garbage']),
  },
  { name: 'GET /whoami (optional) with no credential', continues: true, run: (app) => get(app.port, '/whoami') },
  { name: 'GET /auth/session with no credential', continues: true, run: (app) => get(app.port, '/auth/session') },
  {
    name: 'GET /jwt-docs with a valid JWT (policy with no limit)',
    continues: true,
    run: (app, c) => get(app.port, '/jwt-docs', [`authorization: Bearer ${c.jwt}`]),
  },
  {
    name: 'GET /whoami with a session',
    continues: false,
    run: (app, c) => get(app.port, '/whoami', [cookieHeader(NAME, c.session)]),
  },
  {
    name: 'GET /docs with a session',
    continues: false,
    run: (app, c) => get(app.port, '/docs', [cookieHeader(NAME, c.session)]),
  },
  {
    name: 'GET /docs with an API key',
    continues: false,
    run: (app, c) => get(app.port, '/docs', [`authorization: Bearer ${c.key}`]),
  },
  {
    name: 'GET /jwt-limited with a valid JWT (policy with a limit: needs the shared limiter)',
    continues: false,
    run: (app, c) => get(app.port, '/jwt-limited', [`authorization: Bearer ${c.jwt}`]),
  },
  {
    name: 'GET /limited with a session (policy limit)',
    continues: false,
    run: (app, c) => get(app.port, '/limited', [cookieHeader(NAME, c.session)]),
  },
  {
    name: 'POST /docs with a session and its token',
    continues: false,
    run: (app, c) =>
      send(app.port, {
        method: 'POST',
        path: '/docs',
        headers: [cookieHeader(NAME, c.session), `x-csrf-token: ${c.csrf}`],
        body: '{"name":"a"}',
      }),
  },
  {
    name: 'GET /auth/session with a session',
    continues: false,
    run: (app, c) => get(app.port, '/auth/session', [cookieHeader(NAME, c.session)]),
  },
  {
    name: 'POST /auth/sign-out with a session and its token',
    continues: false,
    run: (app, c) =>
      send(app.port, {
        method: 'POST',
        path: '/auth/sign-out',
        headers: [cookieHeader(NAME, c.session), `x-csrf-token: ${c.csrf}`],
      }),
  },
  {
    name: 'POST /auth/session/clear (the address limit needs the store)',
    continues: false,
    run: (app) => send(app.port, { method: 'POST', path: '/auth/session/clear' }),
  },
];

async function matrix(label: string, app: App, credentials: Credentials, stage: string): Promise<void> {
  const replies = await Promise.all(probes.map((probe) => probe.run(app, credentials)));
  probes.forEach((probe, index) => {
    const reply = replies[index];
    if (reply === undefined) {
      return;
    }
    report.check(
      `${label} ${stage}: ${probe.name} ${probe.continues ? 'continues (200)' : 'is refused 503 AUTH_UNAVAILABLE and never admitted'}`,
      probe.continues
        ? reply.status === 200
        : reply.status === 503 && reply.body === UNAVAILABLE && reply.all('set-cookie').length === 0,
      `${reply.status} ${reply.body.slice(0, 90)}`,
    );
  });
  const malformed = await get(app.port, '/whoami', [cookieHeader(NAME, 'short')]);
  report.check(
    `${label} ${stage}: a malformed cookie is still refused 401 CREDENTIAL_INVALID (no store needed to know it)`,
    malformed.status === 401 && malformed.json().code === 'CREDENTIAL_INVALID',
    `${malformed.status}`,
  );
  const hashBefore = app.order.filter((step) => step === 'hash').length;
  const login = await send(app.port, {
    method: 'POST',
    path: '/login',
    body: '{"userId":"alice","password":"correct horse"}',
  });
  report.check(
    `${label} ${stage}: an application login that charges its limiter first is refused 503 before any hashing`,
    login.status === 503 && app.order.filter((step) => step === 'hash').length === hashBefore,
    `${login.status}; hashes ${app.order.filter((step) => step === 'hash').length - hashBefore}`,
  );
  const signIn = await app.signIn('new-user');
  report.check(
    `${label} ${stage}: signing in is Unavailable and sets no cookie`,
    signIn.result.startsWith('unavailable:') && signIn.token === null,
    signIn.result,
  );
  const runsBefore = ['docs', 'save', 'limited', 'jwtLimited'].map((name) => app.hit(name));
  const flood = await Promise.all(
    Array.from({ length: 60 }, (_, n) => {
      const kind = n % 3;
      return kind === 0
        ? get(app.port, '/docs', [cookieHeader(NAME, credentials.session)])
        : kind === 1
          ? get(app.port, '/docs', [`authorization: Bearer ${credentials.key}`])
          : get(app.port, '/jwt-docs', [`authorization: Bearer ${credentials.jwt}`]);
    }),
  );
  const admittedStoreChecks = flood.filter((reply, n) => n % 3 !== 2 && reply.status === 200).length;
  const refused = flood.filter((reply, n) => n % 3 !== 2 && reply.status === 503).length;
  const jwtOk = flood.filter((reply, n) => n % 3 === 2 && reply.status === 200).length;
  report.check(
    `${label} ${stage}: of 60 concurrent requests, no session or API-key request is admitted (${refused} of 40 refused 503), and every JWT request continues (${jwtOk} of 20)`,
    admittedStoreChecks === 0 && refused === 40 && jwtOk === 20,
    `${admittedStoreChecks} admitted; ${refused} refused; ${jwtOk} jwt ok`,
  );
  report.check(
    `${label} ${stage}: no handler of a store-checked route ran during the outage`,
    ['docs', 'save', 'limited', 'jwtLimited'].every((name, index) => app.hit(name) === runsBefore[index]),
  );
}

async function recovered(label: string, app: App, credentials: Credentials): Promise<void> {
  const replies = await Promise.all([
    get(app.port, '/docs', [cookieHeader(NAME, credentials.session)]),
    get(app.port, '/docs', [`authorization: Bearer ${credentials.key}`]),
    get(app.port, '/jwt-limited', [`authorization: Bearer ${credentials.jwt}`]),
  ]);
  report.check(
    `${label} when the store answers again the same session, key and token are admitted: nothing was kept or lost`,
    replies.map((reply) => reply.status).join(',') === '200,200,200',
    replies.map((reply) => reply.status).join(','),
  );
}

async function admin(run: (client: Client) => Promise<void>): Promise<void> {
  const client = new Client({ connectionString: pgBase().toString() });
  await client.connect();
  try {
    await run(client);
  } finally {
    await client.end();
  }
}

async function postgresOutage(rig: Rig, down: boolean, settle = true): Promise<void> {
  const name = rig.database?.name;
  if (name === undefined) {
    throw new Error('no database');
  }
  await admin(async (client) => {
    await client.query(`ALTER DATABASE ${name} WITH ALLOW_CONNECTIONS ${down ? 'false' : 'true'}`);
    if (down) {
      await client.query(
        'SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()',
        [name],
      );
    }
  });
  if (settle) {
    await sleepMs(150);
  }
}

interface Throwing {
  readonly store: AuthStore;
  readonly pool: Pool;
  readonly events: StoreEvent[];
  arm: (on: boolean) => void;
  setConnectDelay: (ms: number) => void;
}

async function throwingStore(rig: Rig, maxClients: number): Promise<Throwing> {
  const database = rig.database;
  if (database === null) {
    throw new Error('PostgreSQL only');
  }
  const pool = database.pool({ max: 8, application: 'proof-release' });
  let armed = false;
  let delay = 0;
  pool.on('release', () => {
    if (armed) {
      throw new Error('release listener of the application');
    }
  });
  const wrapped: PgPool = {
    connect: async () => {
      if (delay > 0) {
        await sleepMs(delay);
      }
      return pool.connect();
    },
    on: (event, listener) => pool.on(event, listener),
    removeListener: (event, listener) => pool.removeListener(event, listener),
    options: { max: 8 },
  };
  const store = createPostgresStore({ pool: wrapped, maxClients, cleanupIntervalSeconds: 3600 });
  const events: StoreEvent[] = [];
  const attached = await store.attach({ onFailure: (event) => void events.push(event) });
  if (attached.kind !== 'attached') {
    throw new Error(`attach answered ${attached.kind}`);
  }
  return {
    store,
    pool,
    events,
    arm: (on) => {
      armed = on;
    },
    setConnectDelay: (ms) => {
      delay = ms;
    },
  };
}

async function releaseCases(): Promise<void> {
  const label = '[postgres]';
  const rig = await makeRig('postgres', { attach: false });
  const unhandled: unknown[] = [];
  const onUnhandled = (reason: unknown): void => {
    unhandled.push(reason);
  };
  process.on('unhandledRejection', onUnhandled);
  const maxClients = 3;
  const t = await throwingStore(rig, maxClients);
  try {
    t.arm(true);
    const answer = await t.store.ops.subjectEnsure({ userId: 'release-user' });
    t.arm(false);
    const rows = await rig.query('SELECT enabled, generation FROM subjects WHERE user_id = ?', ['release-user']);
    report.check(
      `${label} a Pool whose release throws after a committed unit: the caller's answer is done, the row is present, one onFailure with the operation and cause fault`,
      answer.kind === 'done' &&
        rows.length === 1 &&
        t.events.length === 1 &&
        t.events[0]?.operation === 'subjectEnsure' &&
        t.events[0]?.cause === 'fault' &&
        t.events[0]?.code === null,
      `${answer.kind}; rows ${rows.length}; events ${JSON.stringify(t.events)}`,
    );
    const burst = await Promise.all(
      Array.from({ length: maxClients * 3 }, (_, n) => t.store.ops.subjectEnsure({ userId: `after-${n}` })),
    );
    report.check(
      `${label} all ${maxClients} slots are free afterwards: ${maxClients * 3} simultaneous units all answer done at once (a held slot would leave them waiting to the 5,000 ms deadline) and none waits in the Pool`,
      burst.every((entry) => entry.kind === 'done') && t.pool.waitingCount === 0 && t.pool.waitingCount === 0,
      `${burst.filter((entry) => entry.kind === 'done').length} done; waiting in the Pool ${t.pool.waitingCount}`,
    );
    t.arm(true);
    const failedUnit = await t.store.ops.subjectEnsure({ userId: 'release-user' });
    const readBack = await t.store.ops.subjectRead({ userId: 'release-user' });
    t.arm(false);
    report.check(
      `${label} a throwing release after a read and after a second write changes no answer either (done, a record), one more onFailure each`,
      failedUnit.kind === 'done' &&
        readBack !== null &&
        t.events.length === 3 &&
        t.events.every((event) => event.cause === 'fault'),
      `${failedUnit.kind}; events ${t.events.map((event) => event.operation).join(',')}`,
    );
    await sleepMs(300);

    t.events.length = 0;
    const state = randomBytes(32);
    const attempt = {
      state: new Uint8Array(state),
      binding: new Uint8Array(randomBytes(32)),
      provider: 'p',
      nonce: 'n',
      verifier: 'v',
      returnPath: '/',
      ttlMs: 60_000,
    };
    const first = await t.store.ops.attemptCreate(attempt);
    t.events.length = 0;
    t.arm(true);
    const repeated = await t.store.ops.attemptCreate({ ...attempt, state: new Uint8Array(state) }).then(
      (value) => `resolved ${value.kind}`,
      (error: unknown) =>
        error instanceof StoreFailure
          ? `StoreFailure ${error.reason}/${error.applied}/${error.operation}`
          : `other ${String(error)}`,
    );
    t.arm(false);
    report.check(
      `${label} a unit that fails (a repeated attempt state) while the application's release listener throws: the caller receives the unit's own StoreFailure fault/no, not the release error, and one onFailure with cause fault reports the release`,
      first.kind === 'done' &&
        repeated === 'StoreFailure fault/no/attemptCreate' &&
        t.events.length === 1 &&
        t.events[0]?.cause === 'fault' &&
        t.events[0]?.operation === 'attemptCreate',
      `${repeated}; events ${JSON.stringify(t.events)}`,
    );
    await sleepMs(300);

    t.events.length = 0;
    t.setConnectDelay(5500);
    t.arm(true);
    const began = performance.now();
    const late = await t.store.ops.subjectEnsure({ userId: 'late-user' }).then(
      (value) => `resolved ${value.kind}`,
      (error: unknown) =>
        error instanceof StoreFailure ? `StoreFailure ${error.reason}/${error.applied}` : String(error),
    );
    const elapsed = Math.round(performance.now() - began);
    await sleepMs(1500);
    t.arm(false);
    t.setConnectDelay(0);
    const after = await t.store.ops.subjectEnsure({ userId: 'late-user-2' });
    report.check(
      `${label} a client that arrives after its caller's deadline: the caller was answered unavailable/no at the deadline (4,990 to 5,500 ms), the late client's release throw is reported once with cause fault, the slot is free and the next unit is done (the Pool itself keeps the clients whose release the application's own listener aborted, so its totals are not judged)`,
      late === 'StoreFailure unavailable/no' &&
        elapsed >= 4990 &&
        elapsed <= 5500 &&
        t.events.filter((event) => event.cause === 'fault').length === 1 &&
        after.kind === 'done' &&
        t.pool.waitingCount === 0,
      `${late} after ${elapsed} ms; events ${JSON.stringify(t.events)}; next ${after.kind}; pool total ${t.pool.totalCount}, idle ${t.pool.idleCount}`,
    );
    await sleepMs(200);
    report.check(
      `${label} no unhandled rejection arose in any of these cases`,
      unhandled.length === 0,
      `${unhandled.length} unhandled rejection(s)`,
    );
  } finally {
    process.off('unhandledRejection', onUnhandled);
    t.arm(false);
    await t.store.close();
    await rig.dispose();
    t.pool.end().catch(() => undefined);
  }
}

interface Closing {
  readonly store: AuthStore;
  readonly pool: Pool;
  readonly statements: { at: number; text: string }[];
  readonly counts: { connected: number; released: number };
  setConnectDelay: (ms: number) => void;
}

async function closingStore(rig: Rig, maxClients: number): Promise<Closing> {
  const database = rig.database;
  if (database === null) {
    throw new Error('PostgreSQL only');
  }
  const pool = database.pool({ max: 8, application: 'proof-close' });
  const statements: { at: number; text: string }[] = [];
  const counts = { connected: 0, released: 0 };
  let delay = 0;
  const wrapped: PgPool = {
    connect: async () => {
      if (delay > 0) {
        await sleepMs(delay);
      }
      const client = await pool.connect();
      counts.connected++;
      return {
        query: (text, values) => {
          statements.push({ at: performance.now(), text });
          return client.query(text, values === undefined ? undefined : [...values]);
        },
        release: (destroy) => {
          counts.released++;
          client.release(destroy);
        },
        on: (event, listener) => client.on(event, listener),
        removeListener: (event, listener) => client.removeListener(event, listener),
      };
    },
    on: (event, listener) => pool.on(event, listener),
    removeListener: (event, listener) => pool.removeListener(event, listener),
    options: { max: 8 },
  };
  const store = createPostgresStore({ pool: wrapped, maxClients, cleanupIntervalSeconds: 3600 });
  const attached = await store.attach({ onFailure: () => undefined });
  if (attached.kind !== 'attached') {
    throw new Error(`attach answered ${attached.kind}`);
  }
  return {
    store,
    pool,
    statements,
    counts,
    setConnectDelay: (ms) => {
      delay = ms;
    },
  };
}

async function closeCases(): Promise<void> {
  const unhandled: unknown[] = [];
  const onUnhandled = (reason: unknown): void => {
    unhandled.push(reason);
  };
  process.on('unhandledRejection', onUnhandled);
  try {
    await series(
      [['callers wait both inside pool.connect and for a slot (2 slots, 5 callers)', 2, 5, 2]] as const,
      async ([name, maxClients, callers, inConnect]) => {
        const label = `[postgres] close while ${name}`;
        const rig = await makeRig('postgres', { attach: false });
        const c = await closingStore(rig, maxClients);
        try {
          c.setConnectDelay(1500);
          const began = performance.now();
          const results = Array.from({ length: callers }, (_, n) =>
            c.store.ops.subjectEnsure({ userId: `closing-${n}` }).then(
              (value) => ({ answer: `resolved ${value.kind}`, at: performance.now() - began }),
              (error: unknown) => ({
                answer: error instanceof StoreFailure ? `StoreFailure ${error.reason}/${error.applied}` : String(error),
                at: performance.now() - began,
              }),
            ),
          );
          await sleepMs(50);
          const closedAt = performance.now();
          await c.store.close();
          const resolvedAfter = Math.round(performance.now() - closedAt);
          const settled = await Promise.all(results);
          const slowest = Math.round(Math.max(...settled.map((entry) => entry.at)));
          await sleepMs(1800);
          const after = await c.store.ops.subjectEnsure({ userId: 'after-close' }).then(
            (value) => `resolved ${value.kind}`,
            (error: unknown) =>
              error instanceof StoreFailure ? `StoreFailure ${error.reason}/${error.applied}` : String(error),
          );
          const lateStatements = c.statements.filter((sent) => sent.at > closedAt).length;
          const rows = await rig.query('SELECT count(*) AS n FROM subjects WHERE user_id LIKE ?', ['closing-%']);
          report.check(
            `${label}: every caller is refused unavailable/no within 300 ms (slowest ${slowest} ms), close resolves at once (${resolvedAfter} ms), and nothing is written`,
            settled.every((entry) => entry.answer === 'StoreFailure unavailable/no' && entry.at < 300) &&
              resolvedAfter < 300 &&
              Number(rows[0]?.n) === 0,
            `${settled.map((entry) => entry.answer).join(',')}; rows written ${String(rows[0]?.n)}`,
          );
          report.check(
            `${label}: no statement is sent after close was called, a later call is refused unavailable/no, and the ${inConnect} late client(s) (and the one attach used) were all released`,
            lateStatements === 0 &&
              after === 'StoreFailure unavailable/no' &&
              c.counts.connected === inConnect + 1 &&
              c.counts.released === inConnect + 1 &&
              c.pool.totalCount === c.pool.idleCount &&
              c.pool.waitingCount === 0,
            `statements after close ${lateStatements}; later call ${after}; clients connected ${c.counts.connected}, released ${c.counts.released}; pool total ${c.pool.totalCount}, idle ${c.pool.idleCount}`,
          );
        } finally {
          await c.pool.end();
          await rig.dispose();
        }
      },
    );
    await sleepMs(200);
    report.check(
      '[postgres] no unhandled rejection arose in any close case',
      unhandled.length === 0,
      `${unhandled.length} unhandled rejection(s)`,
    );
  } finally {
    process.off('unhandledRejection', onUnhandled);
  }
}

async function recoveryCases(): Promise<void> {
  const maxClients = 3;
  await series([maxClients + 1], async (failures) => {
    const label = `[postgres] maxClients ${maxClients}, ${failures} failed operations`;
    const rig = await makeRig('postgres', { attach: false, maxClients });
    const app = await startApp({ store: rig.store });
    try {
      const signed = await app.signIn('alice');
      const cookie = cookieHeader(NAME, signed.token ?? '');
      await postgresOutage(rig, true);
      const during = await Promise.all(Array.from({ length: failures }, () => get(app.port, '/docs', [cookie])));
      await postgresOutage(rig, false, false);
      const began = performance.now();
      const next = await get(app.port, '/docs', [cookie]);
      const elapsed = Math.round(performance.now() - began);
      const again = await get(app.port, '/limited', [cookie]);
      report.check(
        `${label} by the real outage, then the database is restored: every failed operation was 503, and the very next request is 200 on the first try (${elapsed} ms), as is the one after`,
        during.every((reply) => reply.status === 503 && reply.body === UNAVAILABLE) &&
          next.status === 200 &&
          elapsed < 2000 &&
          again.status === 200,
        `${during.map((reply) => reply.status).join(',')} then ${next.status} then ${again.status}`,
      );
      const signIn = await app.signIn('bob');
      const charge = await app.limits.charge('login', 'after-outage');
      report.check(
        `${label} sign-in and a limiter charge work as well after the restore`,
        signIn.result === 'established' && charge.kind === 'pass',
        `${signIn.result} ${charge.kind}`,
      );
    } finally {
      await postgresOutage(rig, false, false).catch(() => undefined);
      await app.close();
      await rig.dispose();
    }
  });
}

async function outageSuite(kind: Kind): Promise<void> {
  const label = `[${kind}]`;
  const rig = await makeRig(kind, { attach: false });
  const observed: Observed = observe(rig.store);
  const app = await startApp({ store: observed.store });
  try {
    const signed = await app.signIn('alice');
    const issued = await app.keys.issue({ userId: 'alice', name: 'outage key', scopes: ['docs:read', 'docs:write'] });
    if (signed.token === null || issued.kind !== 'issued') {
      throw new Error('setup failed');
    }
    const credentials: Credentials = {
      session: signed.token,
      csrf: signed.csrf,
      key: expose(issued.key),
      jwt: signJwt('jwt-user'),
    };
    await recovered(`${label} control`, app, credentials);
    if (kind === 'postgres') {
      await postgresOutage(rig, true);
      const began = performance.now();
      const first = await get(app.port, '/docs', [cookieHeader(NAME, credentials.session)]);
      const elapsed = Math.round(performance.now() - began);
      report.check(
        `${label} real outage (the database refuses connections and its backends were terminated): the first request is 503 within the 5,000 ms deadline`,
        first.status === 503 && first.body === UNAVAILABLE && elapsed <= 5500,
        `${first.status} after ${elapsed} ms`,
      );
      await matrix(label, app, credentials, 'real outage');
      await app.logs.settle();
      const text = app.logs.text().toLowerCase();
      const failures = app.logs.named('auth.store.failed');
      report.check(
        `${label} real outage: auth.store.failed records exist and no engine or driver text is in any record`,
        failures.length > 0 &&
          !['terminating', 'not currently accepting', 'fatal', 'econnrefused', 'connection terminated'].some((word) =>
            text.includes(word),
          ),
        `${failures.length} records; codes ${[...new Set(failures.map((record) => String(record.fields['auth.code'] ?? 'none')))].join(',')}`,
      );
      await postgresOutage(rig, false);
      await sleepMs(500);
      await recovered(`${label} after the real outage`, app, credentials);
    } else {
      const holding = rig.hold('subjects', 'alice', 3000);
      await holding;
      const began = performance.now();
      const limited = await get(app.port, '/limited', [cookieHeader(NAME, credentials.session)]);
      const elapsed = Math.round(performance.now() - began);
      report.check(
        `${label} real contention (another connection holds the write lock past the 511 ms retry budget): a request that needs the limiter's write is 503, within 501 to 661 ms of waiting`,
        limited.status === 503 && limited.body === UNAVAILABLE && elapsed >= 501 && elapsed <= 700,
        `${limited.status} after ${elapsed} ms (the 511 ms budget plus the request's own reads; allowed 501 to 661 ms plus 40 ms of HTTP on a shared host)`,
      );
      const reads = await get(app.port, '/docs', [cookieHeader(NAME, credentials.session)]);
      report.note(
        `${label} observation: a read-only session check while a writer holds the file answers ${reads.status} (WAL readers are not blocked)`,
      );
      await sleepMs(3200);
      await recovered(`${label} after the lock is released`, app, credentials);
    }
  } finally {
    await app.close();
    await rig.dispose();
  }
}

try {
  await series(rigKinds, async (kind) => {
    await report.run(`[${kind}] outage suite`, () => outageSuite(kind));
  });
  await report.run('[postgres] a throwing release', releaseCases);
  await report.run('[postgres] close while callers wait in connect and for a slot', closeCases);
  await report.run(
    '[postgres] recovery after maxClients, maxClients + 1 and 3 x maxClients failed operations',
    recoveryCases,
  );
} finally {
  await cleanAll();
}
report.finish();
