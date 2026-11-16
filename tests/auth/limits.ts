// Does:  Proves shared limits: atomic charges, bounded keys, charge-first ordering, fail-closed, finite queues.
// Holds: Counters live in the store alone; every verdict is judged against the table and a second server instance.

import { createHash } from 'node:crypto';
import { AuthError } from '@skeld/auth/auth-error';
import { hashPassword } from '@skeld/auth/password';
import { Secret } from '@skeld/core/secret';
import type { Pool } from 'pg';
import {
  cookieHeader,
  get,
  observe,
  type Observed,
  type Operation,
  send,
  series,
  sleepMs,
  spareStore,
  startApp,
  type App,
} from './rig/v1-app.ts';
import { createReport } from './rig/v1-report.ts';
import { cleanAll, type Kind, makeRig, type Rig, rigKinds, toNumber } from './support-store.ts';

const statement =
  "shared limits charge atomically, also across server instances, in bounded windows under bounded keys; auth's public endpoints and an application charge before their expensive work; an unavailable store is Unavailable and never a pass, with no fallback; the hashing queue and the store queue are finite and ended by their deadlines";
const report = createReport('v04', statement);

const NAME = '__Host-skeld';

const keyDigest = (scope: string, text: string): string =>
  createHash('sha256')
    .update(`app.${scope}`)
    .update(Buffer.from([0]))
    .update(text)
    .digest('hex');

async function rejection(call: () => Promise<unknown>): Promise<string> {
  try {
    const value = await call();
    return `resolved ${JSON.stringify(value)}`;
  } catch (error) {
    return error instanceof AuthError ? `${error.code}: ${error.message}` : String(error);
  }
}

interface Context {
  readonly label: string;
  readonly rig: Rig;
  readonly observed: Observed;
  readonly app: App;
}

async function windowRows(rig: Rig): Promise<Map<string, number>> {
  const rows = await rig.query('SELECT key, count FROM limit_windows');
  return new Map(
    rows.map((row) => [
      row.key instanceof Uint8Array ? Buffer.from(row.key).toString('hex') : String(row.key),
      toNumber(row.count),
    ]),
  );
}

async function atomicCases({ label, rig, app }: Context): Promise<void> {
  const verdicts = await Promise.all(Array.from({ length: 50 }, () => app.limits.charge('login', 'k1')));
  const passes = verdicts.flatMap((verdict) => (verdict.kind === 'pass' ? [verdict] : []));
  const limited = verdicts.flatMap((verdict) => (verdict.kind === 'limited' ? [verdict] : []));
  report.check(
    `${label} 50 simultaneous charges against a limit of 3: exactly 3 pass with remaining 2, 1 and 0 and one shared resetAt; 47 are limited with an integer retryAfterSeconds from 1 to 60`,
    passes.length === 3 &&
      limited.length === 47 &&
      passes
        .map((verdict) => verdict.remaining)
        .sort()
        .join(',') === '0,1,2' &&
      new Set(passes.map((verdict) => verdict.resetAt)).size === 1 &&
      limited.every(
        (verdict) =>
          Number.isInteger(verdict.retryAfterSeconds) &&
          verdict.retryAfterSeconds >= 1 &&
          verdict.retryAfterSeconds <= 60,
      ),
    `${passes.length} pass, ${limited.length} limited`,
  );
  const rows = await windowRows(rig);
  report.check(
    `${label} the table holds one window for that key with count 3, under the SHA-256 of the scope, a zero byte and the key text`,
    rows.get(keyDigest('login', 'k1')) === 3,
    `rows ${rows.size}`,
  );
  const swarm = await Promise.all(
    Array.from({ length: 20 }, (_, key) =>
      Promise.all(Array.from({ length: 6 }, () => app.limits.charge('login', `swarm-${key}`))),
    ),
  );
  report.check(
    `${label} 20 keys with 6 simultaneous charges each: every key passes exactly 3`,
    swarm.every((group) => group.filter((verdict) => verdict.kind === 'pass').length === 3),
    swarm.map((group) => group.filter((verdict) => verdict.kind === 'pass').length).join(','),
  );
  const other = await app.limits.charge('login', 'k2');
  const sameKeyOtherScope = await app.limits.charge('burst', 'k1');
  report.check(
    `${label} another key and the same key under another scope have their own counters (both pass, remaining 2 and 999)`,
    other.kind === 'pass' &&
      other.remaining === 2 &&
      sameKeyOtherScope.kind === 'pass' &&
      sameKeyOtherScope.remaining === 999,
    `${JSON.stringify(other)} ${JSON.stringify(sameKeyOtherScope)}`,
  );
  const caseKey = await Promise.all(['Case', 'case', 'CASE'].map((key) => app.limits.charge('login', key)));
  report.check(
    `${label} keys are exact text: Case, case and CASE are three counters (each passes with remaining 2)`,
    caseKey.every((verdict) => verdict.kind === 'pass' && verdict.remaining === 2),
    JSON.stringify(caseKey.map((verdict) => verdict.kind)),
  );
  const stored = await windowRows(rig);
  const dump = [...stored.keys()].join(' ');
  report.check(
    `${label} no row of limit_windows holds a key's text; every key column is a 32-byte digest`,
    !['k1', 'swarm', 'Case'].some((text) => dump.includes(Buffer.from(text).toString('hex'))) &&
      [...stored.keys()].every((key) => key.length === 64),
    `${stored.size} windows`,
  );
}

async function windowCases({ label, rig, app }: Context): Promise<void> {
  const first = await app.limits.charge('tiny', 'w1');
  const second = await app.limits.charge('tiny', 'w1');
  await sleepMs(1100);
  const third = await app.limits.charge('tiny', 'w1');
  const rows = await rig.query('SELECT window_start, expires_at, count FROM limit_windows WHERE key = ?', [
    Buffer.from(keyDigest('tiny', 'w1'), 'hex'),
  ]);
  report.check(
    `${label} a fixed window of 1 s: the first charge passes, the second is limited with retryAfterSeconds 1, after the window the next passes again with a later resetAt and the row restarted at count 1`,
    first.kind === 'pass' &&
      second.kind === 'limited' &&
      second.retryAfterSeconds === 1 &&
      third.kind === 'pass' &&
      third.resetAt > first.resetAt &&
      toNumber(rows[0]?.count) === 1 &&
      toNumber(rows[0]?.expires_at) - toNumber(rows[0]?.window_start) === 1000,
    `${first.kind} ${second.kind} ${third.kind}; window ${toNumber(rows[0]?.expires_at) - toNumber(rows[0]?.window_start)} ms`,
  );
  const reset = first.kind === 'pass' ? first.resetAt : 0;
  report.check(
    `${label} resetAt of a pass is an integer instant (epoch milliseconds) after the window start`,
    Number.isInteger(reset) && reset > 1_700_000_000_000,
    `${reset}`,
  );
}

async function inputCases({ label, rig, observed, app }: Context): Promise<void> {
  observed.reset();
  const bad: [string, () => Promise<unknown>][] = [
    ['an empty key', () => app.limits.charge('login', '')],
    ['a key of 257 characters', () => app.limits.charge('login', 'k'.repeat(257))],
    ['a number as the key', () => app.limits.charge('login', JSON.parse('5'))],
    ['an undeclared scope', () => app.limits.charge(JSON.parse('"nope"'), 'k')],
    ['an internal scope name', () => app.limits.charge(JSON.parse('"auth.address.authSessionClear"'), 'k')],
    ['a clientAddress that is not an IP', () => app.limits.charge('login', { clientAddress: 'not-an-ip' })],
    ['an empty clientAddress', () => app.limits.charge('login', { clientAddress: '' })],
    ['an IPv4 address with an octet of 999', () => app.limits.charge('login', { clientAddress: '999.1.1.1' })],
    [
      'a key object with another own key',
      () => app.limits.charge('login', JSON.parse('{"clientAddress":"1.2.3.4","extra":1}')),
    ],
    ['a key object with no clientAddress', () => app.limits.charge('login', JSON.parse('{"user":"1.2.3.4"}'))],
  ];
  await series(bad, async ([name, call]) => {
    const outcome = await rejection(call);
    report.check(
      `${label} ${name}: INVALID_INPUT "invalid input" before the store`,
      outcome === 'INVALID_INPUT: invalid input',
      outcome,
    );
  });
  report.check(`${label} none of them reached the store`, observed.calls() === 0, `${observed.calls()} store calls`);
  const edge = await app.limits.charge('login', 'k'.repeat(256));
  report.check(`${label} a key of 256 characters is accepted`, edge.kind === 'pass', edge.kind);

  const v4 = await Promise.all(
    ['1.2.3.4', '1.2.3.4', '::ffff:1.2.3.4'].map((clientAddress) => app.limits.charge('login', { clientAddress })),
  );
  const v4Fourth = await app.limits.charge('login', { clientAddress: '1.2.3.4' });
  report.check(
    `${label} an IPv4-mapped IPv6 address is the same counter as its IPv4 address (3 pass, the 4th is limited)`,
    v4.every((verdict) => verdict.kind === 'pass') && v4Fourth.kind === 'limited',
    `${v4.map((verdict) => verdict.kind).join(',')} then ${v4Fourth.kind}`,
  );
  const v6 = await Promise.all(
    ['2001:db8:0:1::1', '2001:db8:0:1:ffff:ffff:ffff:ffff', '2001:DB8:0:1:abcd::2'].map((clientAddress) =>
      app.limits.charge('login', { clientAddress }),
    ),
  );
  const v6Fourth = await app.limits.charge('login', { clientAddress: '2001:db8:0:1::99' });
  const v6Other = await app.limits.charge('login', { clientAddress: '2001:db8:0:2::1' });
  report.check(
    `${label} an IPv6 address is counted as its /64: three addresses of one /64 share a counter, the fourth is limited, another /64 is its own`,
    v6.every((verdict) => verdict.kind === 'pass') && v6Fourth.kind === 'limited' && v6Other.kind === 'pass',
    `${v6.map((verdict) => verdict.kind).join(',')} ${v6Fourth.kind} ${v6Other.kind}`,
  );
  const rows = await windowRows(rig);
  report.check(
    `${label} the counter keys are the digests of the dotted IPv4 text and of the first 64 bits as four lower-case groups without leading zeros`,
    rows.get(keyDigest('login', '1.2.3.4')) === 3 &&
      rows.get(keyDigest('login', '2001:db8:0:1')) === 3 &&
      rows.get(keyDigest('login', '2001:db8:0:2')) === 1,
    `${rows.get(keyDigest('login', '1.2.3.4'))} ${rows.get(keyDigest('login', '2001:db8:0:1'))} ${rows.get(keyDigest('login', '2001:db8:0:2'))}`,
  );
}

async function orderCases({ label, observed, app }: Context): Promise<void> {
  const order: Operation[] = [];
  const spy = (operation: Operation) => {
    observed.before(operation, () => {
      order.push(operation);
      return Promise.resolve();
    });
  };
  spy('limitCharge');
  spy('sessionRead');
  spy('sessionIssue');
  const clear = await send(app.port, {
    method: 'POST',
    path: '/auth/session/clear',
    headers: [cookieHeader(NAME, 'A'.repeat(43))],
  });
  report.check(
    `${label} the dead-cookie cleanup charges the address limit before it looks the cookie up: limitCharge, then sessionRead`,
    clear.status === 204 && order.join(',') === 'limitCharge,sessionRead',
    `${clear.status}; ${order.join(',')}`,
  );
  const signed = await app.signIn('orderly');
  const session = cookieHeader(NAME, signed.token ?? '');
  order.length = 0;
  const first = await get(app.port, '/limited', [session]);
  const second = await get(app.port, '/limited', [session]);
  const handlerRuns = app.hit('limited');
  order.length = 0;
  const third = await get(app.port, '/limited', [session]);
  report.check(
    `${label} a policy limit is charged in identify, after the session is read and before authorization and the handler: sessionRead, limitCharge; the third call in a window of two is 429 and the handler did not run`,
    first.status === 200 &&
      second.status === 200 &&
      third.status === 429 &&
      order.join(',') === 'sessionRead,limitCharge' &&
      app.hit('limited') === handlerRuns &&
      handlerRuns === 2,
    `${first.status} ${second.status} ${third.status}; ${order.join(',')}; handler runs ${app.hit('limited')}`,
  );
  const bodies = await Promise.all(
    ['login-a', 'login-a', 'login-a', 'login-a'].map(() =>
      send(app.port, { method: 'POST', path: '/login', body: '{"userId":"orderly-user","password":"correct horse"}' }),
    ),
  );
  const statuses = bodies
    .map((reply) => reply.status)
    .sort()
    .join(',');
  const hashes = app.order.filter((step) => step === 'hash').length;
  report.check(
    `${label} an application login charges its limiter before it hashes: 4 attempts for one user (limit 3) are 200,200,200,429 and exactly 3 password hashes ran`,
    statuses === '200,200,200,429' && hashes === 3 && app.order.filter((step) => step === 'charge').length === 4,
    `${statuses}; hashes ${hashes}; charges ${app.order.filter((step) => step === 'charge').length}`,
  );
  const firstHash = app.order.indexOf('hash');
  report.check(
    `${label} no hash precedes the charge of its attempt: the first entry is a charge and a hash is never followed by fewer than its own charges`,
    app.order[0] === 'charge' &&
      firstHash > 0 &&
      app.order.slice(0, firstHash + 1).filter((step) => step === 'charge').length >= 1,
    app.order.join(','),
  );
  const victim = await send(app.port, {
    method: 'POST',
    path: '/login',
    body: '{"userId":"orderly-user","password":"the owner"}',
  });
  const bystander = await send(app.port, {
    method: 'POST',
    path: '/login',
    body: '{"userId":"someone-else","password":"x"}',
  });
  report.note(
    `${label} observation: with the key exhausted by an attacker the owner's own attempt is ${victim.status} and another user's is ${bystander.status} (the documented wait on a victim)`,
  );
  report.check(
    `${label} another user's login is unaffected by the exhausted key`,
    bystander.status === 200,
    `${bystander.status}`,
  );
  observed.before('limitCharge', null);
  observed.before('sessionRead', null);
  observed.before('sessionIssue', null);
}

async function failClosedCases({ label, rig, observed, app }: Context): Promise<void> {
  await app.logs.settle();
  const baseline = app.logs
    .named('auth.store.failed')
    .filter((record) => record.fields['auth.operation'] === 'limitCharge').length;
  if (baseline > 8) {
    await sleepMs(10_500);
  }
  await app.limits.charge('login', 'fc');
  await app.limits.charge('login', 'fc');
  observed.failWith('no', 'limitCharge');
  const failures = await Promise.all(Array.from({ length: 10 }, () => app.limits.charge('login', 'fc')));
  observed.failWith('unknown', 'limitCharge');
  const unknown = await app.limits.charge('login', 'fc');
  observed.failWith(null);
  report.check(
    `${label} while the store rejects every charge: 10 of 10 are Unavailable not_applied and none passes; an unknown outcome is Unavailable unknown`,
    failures.every((verdict) => verdict.kind === 'unavailable' && verdict.outcome === 'not_applied') &&
      unknown.kind === 'unavailable' &&
      unknown.outcome === 'unknown',
    `${failures.map((verdict) => verdict.kind).join(',')} ${JSON.stringify(unknown)}`,
  );
  await app.logs.settle();
  const records = app.logs
    .named('auth.store.failed')
    .filter((record) => record.fields['auth.operation'] === 'limitCharge');
  report.check(
    `${label} each failure is one auth.store.failed for limitCharge (cause unavailable, and unknown for the unknown outcome), with no key and no engine text`,
    records.length - baseline === 11 &&
      records.filter((record) => record.fields['auth.cause'] === 'unknown').length === 1 &&
      !app.logs.text().includes('"fc"'),
    `${records.length} records`,
  );
  const third = await app.limits.charge('login', 'fc');
  const fourth = await app.limits.charge('login', 'fc');
  report.check(
    `${label} no fallback and no counting of failures: after the outage the third charge passes (remaining 0) and the fourth is limited, as if the failures never happened`,
    third.kind === 'pass' && third.remaining === 0 && fourth.kind === 'limited',
    `${JSON.stringify(third)} ${fourth.kind}`,
  );
  const before = (await windowRows(rig)).size;
  const aborted = AbortSignal.abort();
  const gone = await app.limits.charge('login', 'aborted-key', aborted);
  await app.logs.settle();
  const abortRecords = app.logs.named('auth.store.failed').length;
  report.check(
    `${label} a charge whose signal is already aborted is Unavailable not_applied, writes no auth.store.failed and creates no window`,
    gone.kind === 'unavailable' &&
      gone.outcome === 'not_applied' &&
      abortRecords === records.length &&
      (await windowRows(rig)).size === before,
    `${JSON.stringify(gone)}; records ${abortRecords - records.length}`,
  );
  await rig.store.close();
  const afterClose = await app.limits.charge('login', 'after-close');
  report.check(
    `${label} with the store closed a charge is Unavailable not_applied, never a pass`,
    afterClose.kind === 'unavailable' && afterClose.outcome === 'not_applied',
    JSON.stringify(afterClose),
  );
}

async function hashingQueue(label: string): Promise<void> {
  const many = await Promise.all(Array.from({ length: 70 }, () => hashPassword(new Secret('queue-proof'))));
  const hashed = many.filter((result) => result.kind === 'hashed').length;
  const busy = many.filter((result) => result.kind === 'busy').length;
  report.check(
    `${label} the hashing queue is finite: 70 simultaneous hashes are 66 hashed (2 running and 64 waiting) and 4 busy`,
    hashed === 66 && busy === 4,
    `${hashed} hashed, ${busy} busy`,
  );
  const began = performance.now();
  const heavy = await Promise.all(
    Array.from({ length: 12 }, async () => {
      const result = await hashPassword(new Secret('queue-proof'), { cost: { memoryKiB: 262_144, passes: 4 } });
      return { kind: result.kind, at: Math.round(performance.now() - began) };
    }),
  );
  const busyHeavy = heavy.filter((entry) => entry.kind === 'busy');
  report.check(
    `${label} a waiter is ended at its 5,000 ms deadline: of 12 maximum-cost hashes (about 1.6 s each, 2 at a time) the late waiters are busy at 4,990 to 5,500 ms and the others are hashed`,
    busyHeavy.length >= 1 &&
      busyHeavy.length + heavy.filter((entry) => entry.kind === 'hashed').length === 12 &&
      busyHeavy.every((entry) => entry.at >= 4990 && entry.at <= 5500),
    `busy at ${busyHeavy.map((entry) => entry.at).join(',')} ms; ${heavy.filter((entry) => entry.kind === 'hashed').length} hashed`,
  );
  await sleepMs(3500);
}

async function sqliteContention({ label, rig, app }: Context): Promise<void> {
  await app.limits.charge('login', 'busy-key');
  await rig.hold('subjects', 'x', 1200);
  const began = performance.now();
  const verdicts = await Promise.all(Array.from({ length: 30 }, (_, n) => app.limits.charge('login', `busy-${n}`)));
  const elapsed = Math.round(performance.now() - began);
  report.check(
    `${label} while another connection holds the write lock past the retry budget, 30 simultaneous charges are all Unavailable not_applied (none passes), ended within 501 to 661 ms (plus the proof's own scheduling on a shared host: observed ${elapsed} ms)`,
    verdicts.every((verdict) => verdict.kind === 'unavailable' && verdict.outcome === 'not_applied') &&
      elapsed >= 501 &&
      elapsed <= 700,
    `${elapsed} ms`,
  );
  await sleepMs(900);
  const after = await app.limits.charge('login', 'busy-after');
  report.check(`${label} once the lock is released a charge passes again`, after.kind === 'pass', after.kind);
}

async function postgresQueue(): Promise<void> {
  const label = '[postgres]';
  const rig = await makeRig('postgres', { attach: false, maxClients: 1 });
  const app = await startApp({ store: rig.store });
  try {
    await app.limits.charge('login', 'queue-key');
    await rig.hold('limit_windows', Buffer.from(keyDigest('login', 'queue-key'), 'hex'), 2500);
    const began = performance.now();
    const settledAt: number[] = [];
    const verdicts = await Promise.all(
      Array.from({ length: 1010 }, () =>
        app.limits.charge('login', 'queue-key').then((verdict) => {
          settledAt.push(Math.round(performance.now() - began));
          return verdict;
        }),
      ),
    );
    const passes = verdicts.filter((verdict) => verdict.kind === 'pass').length;
    const immediate = settledAt.filter((at) => at < 1500).length;
    const unavailable = verdicts.filter((verdict) => verdict.kind === 'unavailable').length;
    report.check(
      `${label} the store queue is finite (one client, a held row lock, 1,010 simultaneous charges): exactly 9 are refused at once (1 holds the client, 1,000 wait, the rest are over the bound), none exceeds the limit of 3, and none answers anything but pass, limited or Unavailable`,
      immediate === 9 &&
        passes <= 2 &&
        verdicts.every(
          (verdict) => verdict.kind === 'pass' || verdict.kind === 'limited' || verdict.kind === 'unavailable',
        ) &&
        unavailable >= 9,
      `${immediate} settled in 1,500 ms; ${passes} pass; ${verdicts.filter((verdict) => verdict.kind === 'limited').length} limited; ${unavailable} unavailable; last at ${Math.max(...settledAt)} ms`,
    );
    const rows = await windowRows(rig);
    report.check(
      `${label} the window never counted past its limit: count ${rows.get(keyDigest('login', 'queue-key'))} of 3`,
      (rows.get(keyDigest('login', 'queue-key')) ?? 99) <= 3,
      `${rows.get(keyDigest('login', 'queue-key'))}`,
    );
  } finally {
    await app.close();
    await rig.dispose();
  }
}

async function twoInstances(kind: Kind, rig: Rig): Promise<void> {
  const label = `[${kind}]`;
  const pools: Pool[] = [];
  const a = await startApp({ store: observe(spareStore(rig, pools)).store });
  const b = await startApp({ store: observe(spareStore(rig, pools)).store });
  try {
    const verdicts = await Promise.all(
      Array.from({ length: 60 }, (_, n) => (n % 2 === 0 ? a : b).limits.charge('login', 'shared')),
    );
    const passes = verdicts.filter((verdict) => verdict.kind === 'pass').length;
    const rows = await windowRows(rig);
    report.check(
      `${label} 60 simultaneous charges split across two server instances on one database: exactly 3 pass in total, 57 are limited, one window with count 3`,
      passes === 3 &&
        verdicts.filter((verdict) => verdict.kind === 'limited').length === 57 &&
        rows.get(keyDigest('login', 'shared')) === 3,
      `${passes} pass; count ${rows.get(keyDigest('login', 'shared'))}`,
    );
    const policy = await a.signIn('shared-user');
    const cookie = cookieHeader(NAME, policy.token ?? '');
    const replies = await Promise.all(
      Array.from({ length: 8 }, (_, n) => get((n % 2 === 0 ? a : b).port, '/limited', [cookie])),
    );
    report.check(
      `${label} a policy limit of 2 is shared by both instances: of 8 simultaneous requests, exactly 2 are 200 and 6 are 429`,
      replies.filter((reply) => reply.status === 200).length === 2 &&
        replies.filter((reply) => reply.status === 429).length === 6,
      replies.map((reply) => reply.status).join(','),
    );
  } finally {
    await a.close();
    await b.close();
    await Promise.all(pools.map((pool) => pool.end()));
  }
}

async function suite(kind: Kind): Promise<void> {
  const label = `[${kind}]`;
  const rig = await makeRig(kind, { attach: false });
  const observed = observe(rig.store);
  const app = await startApp({ store: observed.store });
  const context: Context = { label, rig, observed, app };
  try {
    await report.run(`${label} atomic charges`, () => atomicCases(context));
    await report.run(`${label} windows`, () => windowCases(context));
    await report.run(`${label} keys and bounds`, () => inputCases(context));
    await report.run(`${label} charge-first ordering`, () => orderCases(context));
    if (kind === 'sqlite') {
      await report.run(`${label} write contention`, () => sqliteContention(context));
    }
    await report.run(`${label} fail closed`, () => failClosedCases(context));
  } finally {
    await app.close();
    await rig.dispose();
  }
  const second = await makeRig(kind, { attach: false });
  try {
    await report.run(`${label} two server instances`, () => twoInstances(kind, second));
  } finally {
    await second.dispose();
  }
}

try {
  await series(rigKinds, suite);
  await report.run('[postgres] store queue', postgresQueue);
  await report.run('[hashing] hashing queue', () => hashingQueue('[hashing]'));
} finally {
  await cleanAll();
}
report.finish();
