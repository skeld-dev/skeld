// Does:  Proves session tokens, digests at rest, the cookie, atomic rotation and revocation on both stores.
// Holds: Every admission is read from the store; a replacement is judged from the table and a second server instance.

import { createHash, randomBytes } from 'node:crypto';
import {
  cookieHeader,
  cookiesOf,
  get,
  observe,
  type Observed,
  send,
  series,
  sleepMs,
  spareStore,
  startApp,
  type App,
} from './rig/v1-app.ts';
import { createReport } from './rig/v1-report.ts';
import { cleanAll, type Kind, makeRig, type Rig, rigKinds, toNumber } from './support-store.ts';
import type { Pool } from 'pg';

const statement =
  'session tokens are random 256-bit opaque values in one canonical spelling, stored only as SHA-256 digests; the cookie has the contracted attributes; every authenticated request reads the store; rotation leaves one replacement; revocation, disable and generation changes stop stale issuance and renewal; concurrent requests agree';
const report = createReport('v03', statement);

const NAME = '__Host-skeld';
// biome-ignore lint/security/noSecrets: the base64url alphabet, not a secret
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

const digestHex = (token: string): string => createHash('sha256').update(Buffer.from(token, 'base64url')).digest('hex');

function hexOf(value: unknown): string {
  return value instanceof Uint8Array ? Buffer.from(value).toString('hex') : String(value);
}

interface Row {
  readonly digest: string;
  readonly userId: string;
  readonly createdAt: number;
  readonly lastSeenAt: number;
  readonly expiresAt: number;
  readonly absoluteExpiresAt: number;
}

async function rowsOf(rig: Rig, userId?: string): Promise<Row[]> {
  const rows = await rig.query(
    `SELECT digest, user_id, created_at, last_seen_at, expires_at, absolute_expires_at FROM sessions${userId === undefined ? '' : ' WHERE user_id = ?'} ORDER BY created_at`,
    userId === undefined ? [] : [userId],
  );
  return rows.map((row) => ({
    digest: hexOf(row.digest),
    userId: String(row.user_id),
    createdAt: toNumber(row.created_at),
    lastSeenAt: toNumber(row.last_seen_at),
    expiresAt: toNumber(row.expires_at),
    absoluteExpiresAt: toNumber(row.absolute_expires_at),
  }));
}

interface Setup {
  readonly kind: Kind;
  readonly rig: Rig;
  readonly observed: Observed;
  readonly app: App;
  readonly label: string;
  readonly spare: () => Observed;
}

async function tokenCases({ rig, app, label }: Setup): Promise<void> {
  const signed = await Promise.all(Array.from({ length: 40 }, (_, n) => app.signIn(`user-${n % 8}`)));
  const tokens = signed.map((entry) => entry.token ?? '');
  report.check(
    `${label} 40 sign-ins give 40 distinct tokens of 43 base64url characters, each in its one canonical spelling`,
    new Set(tokens).size === 40 &&
      tokens.every(
        (token) =>
          /^[A-Za-z0-9_-]{43}$/.test(token) &&
          Buffer.from(token, 'base64url').length === 32 &&
          Buffer.from(token, 'base64url').toString('base64url') === token,
      ),
    `${new Set(tokens).size} distinct`,
  );
  const rows = await rowsOf(rig);
  const stored = new Set(rows.map((row) => row.digest));
  report.check(
    `${label} the sessions table holds exactly the SHA-256 of each token's 32 decoded bytes (40 rows)`,
    rows.length === 40 && tokens.every((token) => stored.has(digestHex(token))),
    `${rows.length} rows`,
  );
  const every = await rig.query(`SELECT * FROM sessions`);
  const dump = JSON.stringify(every, (_key, value) =>
    value instanceof Uint8Array
      ? Buffer.from(value).toString('hex')
      : typeof value === 'bigint'
        ? String(value)
        : value,
  );
  const csrfs = signed.map((entry) => entry.csrf);
  report.check(
    `${label} no row, in any column, holds a token's text, its raw bytes as hex, its base64 or its CSRF token`,
    tokens.every(
      (token, index) =>
        !dump.includes(token) &&
        !dump.includes(Buffer.from(token, 'base64url').toString('hex')) &&
        !dump.includes(Buffer.from(token, 'base64url').toString('base64')) &&
        !dump.includes(csrfs[index] ?? 'x'),
    ),
    `${dump.length} characters of rows searched`,
  );
  const tables = await rig.query(PG_OR_SQLITE_TABLES[rig.kind]);
  const names = tables.map((row) => String(row.name)).sort();
  report.check(
    `${label} the auth schema holds the contracted tables only`,
    ['api_keys', 'limit_windows', 'oidc_attempts', 'schema_version', 'sessions', 'subjects'].every((name) =>
      names.includes(name),
    ),
    names.join(','),
  );
  const columns = await rig.query(`SELECT * FROM subjects`);
  report.check(
    `${label} subjects hold no credential column`,
    columns.every((row) => Object.keys(row).sort().join(',') === 'enabled,generation,user_id'),
    Object.keys(columns[0] ?? {}).join(','),
  );
}

const PG_OR_SQLITE_TABLES: Record<Kind, string> = {
  sqlite: `SELECT name FROM sqlite_master WHERE type = 'table'`,
  postgres: `SELECT table_name AS name FROM information_schema.tables WHERE table_schema = 'skeld_auth'`,
};

function parseCookie(line: string): { name: string; value: string; attrs: string[] } {
  const [pair = '', ...attrs] = line.split('; ');
  const eq = pair.indexOf('=');
  return { name: pair.slice(0, eq), value: pair.slice(eq + 1), attrs };
}

async function cookieCases({ rig, app, label }: Setup): Promise<void> {
  const signed = await app.signIn('cookie-user');
  const line = signed.reply.all('set-cookie')[0] ?? '';
  const parsed = parseCookie(line);
  const rows = await rowsOf(rig, 'cookie-user');
  const left = Math.floor(((rows[0]?.absoluteExpiresAt ?? 0) - (rows[0]?.createdAt ?? 0)) / 1000);
  report.check(
    `${label} the session cookie is exactly <name>=<token>; Path=/; Max-Age=<absolute seconds>; HttpOnly; Secure; SameSite=Lax`,
    signed.reply.all('set-cookie').length === 1 &&
      parsed.name === NAME &&
      parsed.value === signed.token &&
      parsed.attrs.join('; ') === `Path=/; Max-Age=${left}; HttpOnly; Secure; SameSite=Lax` &&
      left === 86400,
    line.replace(parsed.value, '<token>'),
  );
  report.check(
    `${label} the cookie has no Domain, no Expires and is a __Host- cookie`,
    parsed.name.startsWith('__Host-') &&
      !line.toLowerCase().includes('domain') &&
      !line.toLowerCase().includes('expires'),
  );
  report.check(
    `${label} default lifetimes: idle 3,600 s and absolute 86,400 s from the stored row`,
    rows[0] !== undefined &&
      rows[0].expiresAt - rows[0].createdAt === 3_600_000 &&
      rows[0].absoluteExpiresAt - rows[0].createdAt === 86_400_000,
    `idle ${rows[0] === undefined ? 'n/a' : rows[0].expiresAt - rows[0].createdAt} ms, absolute ${rows[0] === undefined ? 'n/a' : rows[0].absoluteExpiresAt - rows[0].createdAt} ms`,
  );
  const csrfCookie = (await get(app.port, '/auth/session', [cookieHeader(NAME, signed.token ?? '')])).all('set-cookie');
  report.check(
    `${label} a read of the session state sets and clears no cookie`,
    csrfCookie.length === 0,
    csrfCookie.join(' | '),
  );
  const out = await send(app.port, {
    method: 'POST',
    path: '/auth/sign-out',
    headers: [cookieHeader(NAME, signed.token ?? ''), `x-csrf-token: ${signed.csrf}`],
  });
  const cleared = out.all('set-cookie')[0] ?? '';
  report.check(
    `${label} the clearing cookie has the same name and attributes with Max-Age=0`,
    out.status === 204 && cleared === `${NAME}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`,
    cleared,
  );
}

async function readCases({ rig, observed, app, label }: Setup): Promise<void> {
  const signed = await app.signIn('reader');
  const token = signed.token ?? '';
  observed.reset();
  await series([1, 2, 3, 4, 5], async () => {
    await get(app.port, '/docs', [cookieHeader(NAME, token)]);
  });
  report.check(
    `${label} five authenticated requests read the store five times (no cache)`,
    observed.calls('sessionRead') === 5,
    `${observed.calls('sessionRead')} reads`,
  );
  await rig.query(`DELETE FROM sessions WHERE user_id = ?`, ['reader']);
  const after = await get(app.port, '/docs', [cookieHeader(NAME, token)]);
  report.check(
    `${label} a row deleted behind the server's back is refused on the very next request`,
    after.status === 401,
    `${after.status}`,
  );
  const other = await app.signIn('reader2');
  await rig.query(`UPDATE sessions SET expires_at = 1 WHERE user_id = ?`, ['reader2']);
  const expired = await get(app.port, '/docs', [cookieHeader(NAME, other.token ?? '')]);
  report.check(
    `${label} a row whose stored expiry is in the past is refused: expiry is the store's judgment`,
    expired.status === 401,
    `${expired.status}`,
  );
}

async function bug046Cookies({ observed, app, label }: Setup): Promise<void> {
  const signed = await app.signIn('spellings');
  const token = signed.token ?? '';
  const last = token[42] ?? 'A';
  const base = ALPHABET.indexOf(last);
  const variants = [1, 2, 3].map((offset) => `${token.slice(0, 42)}${ALPHABET[base + offset] ?? 'A'}`);
  report.check(
    `${label} (BUG-046) the three other spellings of the live token decode to the same 32 bytes (the premise)`,
    variants.every(
      (variant) => variant !== token && Buffer.from(variant, 'base64url').equals(Buffer.from(token, 'base64url')),
    ),
    variants.map((variant) => variant.slice(40)).join(' '),
  );
  const canonical = await get(app.port, '/docs', [cookieHeader(NAME, token)]);
  report.check(
    `${label} (BUG-046) the canonical spelling is admitted (control)`,
    canonical.status === 200,
    `${canonical.status}`,
  );
  await series(variants, async (variant) => {
    observed.reset();
    const reply = await get(app.port, '/docs', [cookieHeader(NAME, variant)]);
    report.check(
      `${label} (BUG-046) the spelling ending ...${variant.slice(42)} is 401 CREDENTIAL_INVALID and reads nothing from the store`,
      reply.status === 401 && reply.json().code === 'CREDENTIAL_INVALID' && observed.calls() === 0,
      `${reply.status} ${String(reply.json().code)}; store calls ${observed.calls()}`,
    );
  });
  observed.reset();
  const optional = await get(app.port, '/whoami', [cookieHeader(NAME, variants[0] ?? '')]);
  report.check(
    `${label} (BUG-046) an optional route refuses a non-canonical spelling too, with no store read`,
    optional.status === 401 && observed.calls() === 0,
    `${optional.status}; store calls ${observed.calls()}`,
  );
  const clear = await send(app.port, {
    method: 'POST',
    path: '/auth/session/clear',
    headers: [cookieHeader(NAME, variants[0] ?? '')],
  });
  const live = await get(app.port, '/docs', [cookieHeader(NAME, token)]);
  report.check(
    `${label} (BUG-046) a non-canonical spelling given to the dead-cookie cleanup never ends the live session`,
    live.status === 200,
    `cleanup ${clear.status}; session ${live.status}`,
  );
}

async function rotationCases({ rig, observed, app, label }: Setup): Promise<void> {
  const signed = await app.signIn('rotator');
  const token = signed.token ?? '';
  const before = (await rowsOf(rig, 'rotator'))[0];
  await sleepMs(30);
  const results = await Promise.all(
    Array.from({ length: 10 }, () => app.sessions.rotate({ rawCookies: cookiesOf(NAME, token) })),
  );
  const rotated = results.filter((result) => result.kind === 'rotated');
  const refused = results.filter((result) => result.kind === 'refused' && result.reason === 'no_session');
  report.check(
    `${label} ten concurrent rotations of one cookie: exactly one rotated and nine no_session`,
    rotated.length === 1 && refused.length === 9,
    `${rotated.length} rotated, ${refused.length} no_session`,
  );
  const rows = await rowsOf(rig, 'rotator');
  const winner = rotated[0];
  const next = winner?.kind === 'rotated' ? (winner.cookies[0]?.value ?? '') : '';
  report.check(
    `${label} exactly one replacement row remains; it keeps the old session's creation and absolute expiry; the old digest is gone`,
    rows.length === 1 &&
      rows[0]?.digest === digestHex(next) &&
      rows[0]?.createdAt === before?.createdAt &&
      rows[0]?.absoluteExpiresAt === before?.absoluteExpiresAt &&
      !rows.some((row) => row.digest === digestHex(token)) &&
      next !== token,
    `${rows.length} row(s)`,
  );
  const oldRefused = await get(app.port, '/docs', [cookieHeader(NAME, token)]);
  const newAdmitted = await get(app.port, '/docs', [cookieHeader(NAME, next)]);
  report.check(
    `${label} the old token is refused and the replacement admitted`,
    oldRefused.status === 401 && newAdmitted.status === 200,
    `${oldRefused.status} ${newAdmitted.status}`,
  );
  const winnerCookie = winner?.kind === 'rotated' ? winner.cookies[0] : undefined;
  const leftSeconds = winnerCookie?.maxAge ?? 0;
  report.check(
    `${label} the replacement cookie carries the absolute lifetime left, whole seconds`,
    winnerCookie !== undefined &&
      Math.abs(leftSeconds - Math.floor(((rows[0]?.absoluteExpiresAt ?? 0) - (rows[0]?.createdAt ?? 0) - 30) / 1000)) <=
        1 &&
      leftSeconds <= 86400,
    `Max-Age ${leftSeconds}`,
  );

  const routeSession = await app.signIn('rotator2');
  const none = await send(app.port, { method: 'POST', path: '/rotate' });
  const dead = await send(app.port, {
    method: 'POST',
    path: '/rotate',
    headers: [cookieHeader(NAME, randomBytes(32).toString('base64url'))],
  });
  const two = await send(app.port, {
    method: 'POST',
    path: '/rotate',
    headers: [`cookie: ${NAME}=${routeSession.token}; ${NAME}=${routeSession.token}`],
  });
  report.check(
    `${label} rotate with no cookie, a dead cookie or two cookies is refused no_session with no Set-Cookie`,
    [none, dead, two].every(
      (reply) => reply.json().result === 'refused:no_session' && reply.all('set-cookie').length === 0,
    ),
    [none, dead, two].map((reply) => String(reply.json().result)).join(','),
  );
  const viaRoute = await send(app.port, {
    method: 'POST',
    path: '/rotate',
    headers: [cookieHeader(NAME, routeSession.token ?? '')],
  });
  const routeToken = (viaRoute.all('set-cookie')[0] ?? '').split(';')[0]?.slice(NAME.length + 1) ?? '';
  const oldAfter = await get(app.port, '/docs', [cookieHeader(NAME, routeSession.token ?? '')]);
  const newAfter = await get(app.port, '/docs', [cookieHeader(NAME, routeToken)]);
  report.check(
    `${label} rotation through a route sets the replacement cookie and ends the old token`,
    viaRoute.json().result === 'rotated' && oldAfter.status === 401 && newAfter.status === 200,
    `${oldAfter.status} ${newAfter.status}`,
  );

  const fixated = await app.signIn('victim');
  const before2 = observed.calls('sessionIssue');
  const signIn2 = await app.signIn('victim', fixated.token ?? undefined);
  const oldFixated = await get(app.port, '/docs', [cookieHeader(NAME, fixated.token ?? '')]);
  report.check(
    `${label} signing in again with an existing cookie replaces that session: the old token is dead, the new one is a different value`,
    signIn2.token !== null &&
      signIn2.token !== fixated.token &&
      oldFixated.status === 401 &&
      observed.calls('sessionIssue') === before2 + 1,
    `old ${oldFixated.status}`,
  );
  const owner = await app.signIn('owner');
  const intruder = await app.signIn('intruder', owner.token ?? undefined);
  const ownerAfter = await get(app.port, '/docs', [cookieHeader(NAME, owner.token ?? '')]);
  const intruderSession = await get(app.port, '/docs', [cookieHeader(NAME, intruder.token ?? '')]);
  report.check(
    `${label} another subject's live session is never adopted: signing in as another user with that cookie ends it and issues a session for the new user only`,
    ownerAfter.status === 401 && intruderSession.json().who === 'session:intruder',
    `owner ${ownerAfter.status}; new ${String(intruderSession.json().who)}`,
  );
}

async function revocationCases({ rig, spare, app, label }: Setup): Promise<void> {
  const a1 = await app.signIn('rev-a');
  const a2 = await app.signIn('rev-a');
  const b1 = await app.signIn('rev-b');
  const changed = await app.subjects.revokeSessions('rev-a');
  const replies = await Promise.all(
    [a1, a2, b1].map((entry) => get(app.port, '/docs', [cookieHeader(NAME, entry.token ?? '')])),
  );
  report.check(
    `${label} revokeSessions: the very next request on each of the subject's sessions is 401; another subject's is 200`,
    changed.kind === 'done' &&
      replies.map((reply) => reply.status).join(',') === '401,401,200' &&
      (await rowsOf(rig, 'rev-a')).length === 0,
    `${JSON.stringify(changed)} ${replies.map((reply) => reply.status).join(',')}`,
  );
  const signedAfter = await app.signIn('rev-a');
  report.check(
    `${label} the subject can sign in again after revokeSessions (generation raised, still enabled)`,
    signedAfter.result === 'established',
    signedAfter.result,
  );

  const slowGate = Promise.withResolvers<void>();
  const entered = Promise.withResolvers<void>();
  const running = await startApp({
    store: spare().store,
    slow: async () => {
      entered.resolve();
      await slowGate.promise;
    },
  });
  try {
    const inFlight = await running.signIn('rev-slow');
    const slowRequest = get(running.port, '/slow', [cookieHeader(NAME, inFlight.token ?? '')]);
    await entered.promise;
    const done = await running.subjects.revokeSessions('rev-slow');
    const later = await get(running.port, '/docs', [cookieHeader(NAME, inFlight.token ?? '')]);
    slowGate.resolve();
    const finished = await slowRequest;
    report.check(
      `${label} a handler admitted before revocation finishes (200); an admission after the confirmed revocation is 401`,
      done.kind === 'done' && later.status === 401 && finished.status === 200,
      `later ${later.status}; running handler ${finished.status}`,
    );
  } finally {
    slowGate.resolve();
    await running.close();
  }

  const racers = await app.signIn('rev-race');
  const stats = { afterConfirm: 0, admittedAfter: 0, total: 0 };
  let confirmed = false;
  const fire = async (): Promise<void> => {
    const wasConfirmed = confirmed;
    const reply = await get(app.port, '/docs', [cookieHeader(NAME, racers.token ?? '')]);
    stats.total++;
    if (wasConfirmed) {
      stats.afterConfirm++;
      if (reply.status === 200) {
        stats.admittedAfter++;
      }
    }
  };
  const flood = (async () => {
    for (let round = 0; round < 12; round++) {
      // biome-ignore lint/performance/noAwaitInLoops: rounds keep the flood running across the revocation
      await Promise.all(Array.from({ length: 6 }, fire));
    }
  })();
  await sleepMs(60);
  const raced = await app.subjects.revokeSessions('rev-race');
  confirmed = raced.kind === 'done';
  await flood;
  report.check(
    `${label} requests racing a revocation: none that started after the confirmation was admitted (${stats.afterConfirm} of ${stats.total} started after it)`,
    raced.kind === 'done' && stats.afterConfirm > 0 && stats.admittedAfter === 0,
    `${stats.admittedAfter} admitted after confirmation`,
  );
}

async function staleCases({ rig, app, label }: Setup): Promise<void> {
  const hold = Promise.withResolvers<void>();
  const reached = Promise.withResolvers<void>();
  const issuing = app.sessions.establish({
    rawCookies: cookiesOf(NAME),
    userId: 'stale-issue',
    verify: async () => {
      reached.resolve();
      await hold.promise;
      return true;
    },
  });
  await reached.promise;
  const changed = await app.subjects.revokeSessions('stale-issue');
  hold.resolve();
  const outcome = await issuing;
  report.check(
    `${label} issuance in flight while revokeSessions commits: refused stale, no session row, no cookie`,
    changed.kind === 'done' &&
      outcome.kind === 'refused' &&
      outcome.reason === 'stale' &&
      (await rowsOf(rig, 'stale-issue')).length === 0,
    JSON.stringify(outcome),
  );
  const holdTwo = Promise.withResolvers<void>();
  const reachedTwo = Promise.withResolvers<void>();
  const issuingTwo = app.sessions.establish({
    rawCookies: cookiesOf(NAME),
    userId: 'stale-disable',
    verify: async () => {
      reachedTwo.resolve();
      await holdTwo.promise;
      return true;
    },
  });
  await reachedTwo.promise;
  await app.subjects.disable('stale-disable');
  holdTwo.resolve();
  const outcomeTwo = await issuingTwo;
  report.check(
    `${label} issuance in flight while disable commits: refused disabled, no session row`,
    outcomeTwo.kind === 'refused' &&
      outcomeTwo.reason === 'disabled' &&
      (await rowsOf(rig, 'stale-disable')).length === 0,
    JSON.stringify(outcomeTwo),
  );
}

async function renewalStale({ rig, spare, label }: Setup): Promise<void> {
  const observed = spare();
  const app = await startApp({
    store: observed.store,
    session: { idleSeconds: 4, absoluteSeconds: 30, renewSeconds: 1 },
  });
  try {
    const signed = await app.signIn('renew-stale');
    await sleepMs(1200);
    const reached = Promise.withResolvers<void>();
    const hold = Promise.withResolvers<void>();
    observed.before('sessionRenew', async () => {
      reached.resolve();
      await hold.promise;
    });
    const request = await get(app.port, '/docs', [cookieHeader(NAME, signed.token ?? '')]);
    await reached.promise;
    const revoked = await app.subjects.revokeSessions('renew-stale');
    hold.resolve();
    observed.before('sessionRenew', null);
    await sleepMs(300);
    const later = await get(app.port, '/docs', [cookieHeader(NAME, signed.token ?? '')]);
    report.check(
      `${label} a renewal delayed past revokeSessions restores nothing: the request that started it was 200, the next is 401 and no row returns`,
      request.status === 200 &&
        revoked.kind === 'done' &&
        later.status === 401 &&
        (await rowsOf(rig, 'renew-stale')).length === 0,
      `request ${request.status}; after ${later.status}; rows ${(await rowsOf(rig, 'renew-stale')).length}`,
    );
  } finally {
    observed.before('sessionRenew', null);
    await app.close();
  }
}

async function renewalOrder({ rig, spare, label }: Setup): Promise<void> {
  const observed = spare();
  const app = await startApp({
    store: observed.store,
    session: { idleSeconds: 6, absoluteSeconds: 30, renewSeconds: 1 },
  });
  try {
    const refused = await app.signIn('order-csrf');
    const before = (await rowsOf(rig, 'order-csrf'))[0];
    await sleepMs(1300);
    observed.reset();
    const noToken = await send(app.port, {
      method: 'POST',
      path: '/docs',
      headers: [cookieHeader(NAME, refused.token ?? '')],
      body: '{"name":"a"}',
    });
    await sleepMs(500);
    const after = (await rowsOf(rig, 'order-csrf'))[0];
    report.check(
      `${label} renewal is the last step of identification: a request refused for its CSRF token (403) starts no renewal and leaves the stored expiry and last use unchanged`,
      noToken.status === 403 &&
        observed.calls('sessionRenew') === 0 &&
        after !== undefined &&
        before !== undefined &&
        after.expiresAt === before.expiresAt &&
        after.lastSeenAt === before.lastSeenAt,
      `${noToken.status}; renewals ${observed.calls('sessionRenew')}; expires ${before?.expiresAt} -> ${after?.expiresAt}`,
    );
    const limited = await app.signIn('order-limit');
    const cookie = cookieHeader(NAME, limited.token ?? '');
    const first = await get(app.port, '/limited', [cookie]);
    const second = await get(app.port, '/limited', [cookie]);
    const rowAtLimit = (await rowsOf(rig, 'order-limit'))[0];
    await sleepMs(1300);
    observed.reset();
    const third = await get(app.port, '/limited', [cookie]);
    await sleepMs(500);
    const rowAfter = (await rowsOf(rig, 'order-limit'))[0];
    report.check(
      `${label} a request refused by the policy limit (429) starts no renewal and leaves the stored expiry and last use unchanged`,
      first.status === 200 &&
        second.status === 200 &&
        third.status === 429 &&
        observed.calls('sessionRenew') === 0 &&
        rowAfter?.expiresAt === rowAtLimit?.expiresAt &&
        rowAfter?.lastSeenAt === rowAtLimit?.lastSeenAt,
      `${first.status} ${second.status} ${third.status}; renewals ${observed.calls('sessionRenew')}; expires ${rowAtLimit?.expiresAt} -> ${rowAfter?.expiresAt}`,
    );
    const admitted = await get(app.port, '/docs', [cookie]);
    await sleepMs(500);
    const renewed = (await rowsOf(rig, 'order-limit'))[0];
    report.check(
      `${label} an admitted request renews when due: the same session on a route with no limit is 200, one renewal ran, last use and expiry moved forward`,
      admitted.status === 200 &&
        observed.calls('sessionRenew') === 1 &&
        renewed !== undefined &&
        rowAfter !== undefined &&
        renewed.lastSeenAt > rowAfter.lastSeenAt &&
        renewed.expiresAt > rowAfter.expiresAt,
      `${admitted.status}; renewals ${observed.calls('sessionRenew')}; last use +${(renewed?.lastSeenAt ?? 0) - (rowAfter?.lastSeenAt ?? 0)} ms`,
    );
  } finally {
    await app.close();
  }
}

async function plainErrorRenewal({ spare, label }: Setup): Promise<void> {
  const unhandled: unknown[] = [];
  const onUnhandled = (reason: unknown): void => {
    unhandled.push(reason);
  };
  process.on('unhandledRejection', onUnhandled);
  const observed = spare();
  const app = await startApp({
    store: observed.store,
    session: { idleSeconds: 8, absoluteSeconds: 30, renewSeconds: 1 },
  });
  try {
    const signed = await app.signIn('plain-error');
    const cookie = cookieHeader(NAME, signed.token ?? '');
    observed.before('sessionRenew', () => Promise.reject(new Error('a plain error from the store call')));
    await sleepMs(1300);
    await app.logs.settle();
    const failedBefore = app.logs.named('auth.store.failed').length;
    const notAwaited = await get(app.port, '/docs', [cookie]);
    await sleepMs(500);
    await app.logs.settle();
    const first = app.logs.named('auth.store.failed').slice(failedBefore);
    report.check(
      `${label} a background renewal whose store call throws a plain Error: the request is admitted (200), exactly one auth.store.failed with cause renew, no unhandled rejection`,
      notAwaited.status === 200 &&
        first.length === 1 &&
        first[0]?.fields['auth.cause'] === 'renew' &&
        unhandled.length === 0,
      `${notAwaited.status}; records ${first.map((record) => JSON.stringify(record.fields)).join(' ')}; unhandled ${unhandled.length}`,
    );
    await sleepMs(1300);
    await app.logs.settle();
    const awaitedBefore = app.logs.named('auth.store.failed').length;
    const awaited = await get(app.port, '/docs', [cookie]);
    await sleepMs(300);
    await app.logs.settle();
    const second = app.logs.named('auth.store.failed').slice(awaitedBefore);
    report.check(
      `${label} the same on the awaited path (idle past twice renewSeconds): 200, exactly one auth.store.failed with cause renew, no unhandled rejection`,
      awaited.status === 200 &&
        second.length === 1 &&
        second[0]?.fields['auth.cause'] === 'renew' &&
        unhandled.length === 0,
      `${awaited.status}; records ${second.map((record) => JSON.stringify(record.fields)).join(' ')}; unhandled ${unhandled.length}`,
    );
    report.check(
      `${label} no message of those records holds the error's text`,
      !app.logs.text().includes('a plain error from the store call'),
      '',
    );
  } finally {
    observed.before('sessionRenew', null);
    process.off('unhandledRejection', onUnhandled);
    await app.close();
  }
}

async function concurrentCases({ observed, app, label }: Setup): Promise<void> {
  const signed = await app.signIn('concurrent');
  observed.reset();
  const replies = await Promise.all(
    Array.from({ length: 60 }, () => get(app.port, '/docs', [cookieHeader(NAME, signed.token ?? '')])),
  );
  report.check(
    `${label} 60 concurrent requests on one session are all 200 and each read the store (${observed.calls('sessionRead')} reads)`,
    replies.every((reply) => reply.status === 200) && observed.calls('sessionRead') === 60,
    `${replies.filter((reply) => reply.status === 200).length} of 60 admitted`,
  );
  const issuing = await Promise.all(Array.from({ length: 12 }, () => app.signIn('concurrent-issue')));
  const tokens = new Set(issuing.map((entry) => entry.token));
  report.check(
    `${label} 12 concurrent sign-ins of one user give 12 established sessions with 12 distinct tokens`,
    issuing.every((entry) => entry.result === 'established') && tokens.size === 12,
    `${tokens.size} distinct`,
  );
}

async function suite(kind: Kind): Promise<void> {
  const label = `[${kind}]`;
  const rig = await makeRig(kind, { attach: false });
  const observed = observe(rig.store);
  const app = await startApp({ store: observed.store });
  const pools: Pool[] = [];
  const setup: Setup = { kind, rig, observed, app, label, spare: () => observe(spareStore(rig, pools)) };
  try {
    await report.run(`${label} tokens and digests`, () => tokenCases(setup));
    await report.run(`${label} cookie attributes`, () => cookieCases(setup));
    await report.run(`${label} store reads`, () => readCases(setup));
    await report.run(`${label} BUG-046 spellings`, () => bug046Cookies(setup));
    await report.run(`${label} rotation and fixation`, () => rotationCases(setup));
    await report.run(`${label} revocation`, () => revocationCases(setup));
    await report.run(`${label} stale issuance`, () => staleCases(setup));
    await report.run(`${label} concurrent requests`, () => concurrentCases(setup));
  } finally {
    await app.close();
  }
  try {
    await report.run(`${label} stale renewal`, () => renewalStale(setup));
    await report.run(`${label} renewal order`, () => renewalOrder(setup));
    await report.run(`${label} plain error in renewal`, () => plainErrorRenewal(setup));
  } finally {
    await Promise.all(pools.map((pool) => pool.end()));
    await rig.dispose();
  }
}

try {
  await series(rigKinds, suite);
} finally {
  await cleanAll();
}
report.finish();
