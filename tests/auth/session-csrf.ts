// Does:  Proves the cross-site check and session-bound CSRF token on every cookie route, sign-out and cleanup.
// Holds: Each refusal is judged by status and exact body; no token or session value reaches a log or a refusal.

import { createHmac, randomBytes } from 'node:crypto';
import {
  cookieHeader,
  get,
  observe,
  type Observed,
  type Reply,
  send,
  series,
  sleepMs,
  startApp,
  type App,
} from './rig/v1-app.ts';
import { createReport } from './rig/v1-report.ts';
import { cleanAll, type Kind, makeRig, type Rig, rigKinds, toNumber } from './support-store.ts';
import { StoreFailure } from '@skeld/auth/store';

const statement =
  'cookie routes sit in strict cross-site groups and cannot be csrfExempt; every unsafe session request, sign-out included, needs the session-bound header token in its one canonical spelling; sign-out reports success only after confirmed revocation and answers 503 on store uncertainty; dead-cookie cleanup never revokes or clears a live session; responses are not cacheable and carry no secret beyond the allowed one';
const report = createReport('v03', statement);

const NAME = '__Host-skeld';
const CSRF = '{"status":403,"code":"CSRF_TOKEN_INVALID","message":"CSRF token missing or not accepted"}';
const CROSS = '{"status":403,"code":"CROSS_ORIGIN","message":"Cross-origin request refused"}';
const UNAVAILABLE = '{"status":503,"code":"AUTH_UNAVAILABLE","message":"Service unavailable"}';
// biome-ignore lint/security/noSecrets: the base64url alphabet, not a secret
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

const csrfOf = (token: string): string =>
  createHmac('sha256', Buffer.from(token, 'base64url')).update('skeld.auth.csrf.v1').digest('base64url');

interface Context {
  readonly label: string;
  readonly rig: Rig;
  readonly observed: Observed;
  readonly app: App;
}

async function sessionRowCount(rig: Rig, userId: string): Promise<number> {
  const rows = await rig.query('SELECT count(*) AS n FROM sessions WHERE user_id = ?', [userId]);
  return toNumber(rows[0]?.n);
}

async function tokenCases({ label, observed, app }: Context): Promise<void> {
  const signed = await app.signIn('csrf-user');
  const token = signed.token ?? '';
  const cookie = cookieHeader(NAME, token);
  const state = await get(app.port, '/auth/session', [cookie]);
  report.check(
    `${label} the CSRF token is HMAC-SHA-256 keyed by the 32 token bytes over "skeld.auth.csrf.v1", base64url, 43 characters (independent computation)`,
    signed.csrf === csrfOf(token) && /^[A-Za-z0-9_-]{43}$/.test(signed.csrf) && state.json().csrfToken === signed.csrf,
    `${signed.csrf === csrfOf(token) ? 'equal' : 'different'} to the recomputed value; state body ${String(state.json().status)}`,
  );
  const other = await app.signIn('csrf-other');
  report.check(
    `${label} two sessions have different CSRF tokens`,
    other.csrf !== signed.csrf && other.csrf === csrfOf(other.token ?? ''),
    '',
  );

  const unsafe: [string, string, string][] = [
    ['POST', '/docs', '{"name":"a"}'],
    ['PUT', '/docs', ''],
    ['PATCH', '/docs', ''],
    ['DELETE', '/docs', ''],
    ['POST', '/auth/sign-out', ''],
  ];
  await series(unsafe, async ([method, path, body]) => {
    const spec = { method, path, ...(body === '' ? {} : { body }) };
    const none = await send(app.port, { ...spec, headers: [cookie] });
    report.check(
      `${label} ${method} ${path} with no token: 403 CSRF_TOKEN_INVALID, nothing done`,
      none.status === 403 && none.body === CSRF,
      `${none.status} ${none.body}`,
    );
    const wrong = await send(app.port, { ...spec, headers: [cookie, `x-csrf-token: ${other.csrf}`] });
    report.check(
      `${label} ${method} ${path} with another session's token: 403 CSRF_TOKEN_INVALID`,
      wrong.status === 403 && wrong.body === CSRF,
      `${wrong.status} ${wrong.body}`,
    );
  });
  const handlersRun = ['save', 'putDoc', 'patchDoc', 'delDoc'].map((name) => app.hit(name));
  report.check(
    `${label} no refused request reached its handler`,
    handlersRun.every((count) => count === 0),
    handlersRun.join(','),
  );
  await series(
    [
      ['POST', '/docs', 'save', '{"name":"a"}'],
      ['PUT', '/docs', 'putDoc', ''],
      ['PATCH', '/docs', 'patchDoc', ''],
      ['DELETE', '/docs', 'delDoc', ''],
    ] as const,
    async ([method, path, route, body]) => {
      const reply = await send(app.port, {
        method,
        path,
        headers: [cookie, `x-csrf-token: ${signed.csrf}`],
        ...(body === '' ? {} : { body }),
      });
      report.check(
        `${label} ${method} ${path} with the session's token: 200 and the handler ran once`,
        reply.status === 200 && app.hit(route) === 1,
        `${reply.status}`,
      );
    },
  );
  const last = signed.csrf[42] ?? 'A';
  const base = ALPHABET.indexOf(last);
  const variants = [1, 2, 3].map((offset) => `${signed.csrf.slice(0, 42)}${ALPHABET[(base + offset) % 64] ?? 'A'}`);
  report.check(
    `${label} (BUG-046) the token's other spellings decode to the same 32 bytes (the premise)`,
    variants.every(
      (variant) =>
        variant !== signed.csrf && Buffer.from(variant, 'base64url').equals(Buffer.from(signed.csrf, 'base64url')),
    ),
    variants.map((variant) => variant.slice(40)).join(' '),
  );
  await series(variants, async (variant) => {
    observed.reset();
    const reply = await send(app.port, {
      method: 'POST',
      path: '/docs',
      headers: [cookie, `x-csrf-token: ${variant}`],
      body: '{"name":"a"}',
    });
    report.check(
      `${label} (BUG-046) the header spelling ...${variant.slice(42)} is 403 CSRF_TOKEN_INVALID, the handler does not run, and the store sees only the one session read`,
      reply.status === 403 &&
        reply.body === CSRF &&
        app.hit('save') === 1 &&
        observed.calls() === observed.calls('sessionRead') &&
        observed.calls('sessionRead') === 1,
      `${reply.status}; store calls ${observed.calls()} (sessionRead ${observed.calls('sessionRead')})`,
    );
  });
  const lengths: [string, string][] = [
    ['one character short', signed.csrf.slice(0, 42)],
    ['one character long', `${signed.csrf}A`],
    ['upper-cased', signed.csrf.toUpperCase()],
    ['the token with an inner space in place of a character', `${signed.csrf.slice(0, 20)} ${signed.csrf.slice(21)}`],
    ['empty', ''],
  ];
  await series(lengths, async ([name, value]) => {
    const reply = await send(app.port, {
      method: 'POST',
      path: '/docs',
      headers: [cookie, `x-csrf-token: ${value}`],
      body: '{"name":"a"}',
    });
    report.check(
      `${label} a header token ${name}: 403 CSRF_TOKEN_INVALID`,
      reply.status === 403 && reply.body === CSRF,
      `${reply.status}`,
    );
  });
  const twice = await send(app.port, {
    method: 'POST',
    path: '/docs',
    headers: [cookie, `x-csrf-token: ${signed.csrf}`, `x-csrf-token: ${signed.csrf}`],
    body: '{"name":"a"}',
  });
  report.note(`${label} observation: two identical x-csrf-token headers answer ${twice.status}`);
  const inBody = await send(app.port, {
    method: 'POST',
    path: '/docs',
    headers: [cookie],
    body: JSON.stringify({ name: 'a', csrf: signed.csrf, 'x-csrf-token': signed.csrf }),
  });
  const inCookie = await send(app.port, {
    method: 'POST',
    path: '/docs',
    headers: [`cookie: ${NAME}=${token}; x-csrf-token=${signed.csrf}; csrf=${signed.csrf}`],
    body: '{"name":"a"}',
  });
  report.check(
    `${label} the token is read from the header only: the valid token in the body or in a cookie is 403`,
    inBody.status === 403 && inCookie.status === 403,
    `${inBody.status} ${inCookie.status}`,
  );
  const safe = await Promise.all([
    get(app.port, '/docs', [cookie]),
    send(app.port, { method: 'HEAD', path: '/docs', headers: [cookie], waitMs: 1500 }),
  ]);
  report.check(
    `${label} safe methods (GET, HEAD) need no token`,
    safe.every((reply) => reply.status === 200),
    safe.map((reply) => reply.status).join(','),
  );
  const bearer = await app.keys.issue({ userId: 'csrf-user', name: 'k', scopes: ['docs:write'] });
  report.check(
    `${label} (control) an API key issued for the same user is not a session`,
    bearer.kind === 'issued',
    bearer.kind,
  );
}

async function crossSiteCases({ label, app }: Context): Promise<void> {
  const signed = await app.signIn('cross-user');
  const cookie = cookieHeader(NAME, signed.token ?? '');
  const token = `x-csrf-token: ${signed.csrf}`;
  const attempts: [string, readonly string[], boolean][] = [
    ['an Origin of another site', ['origin: https://evil.example', cookie, token], false],
    ['Sec-Fetch-Site cross-site with no Origin', ['sec-fetch-site: cross-site', cookie, token], false],
    ['Sec-Fetch-Site same-site with no Origin', ['sec-fetch-site: same-site', cookie, token], false],
    ['no Origin and no Sec-Fetch-Site', [cookie, token], false],
    [
      'an Origin of null with cross-site metadata',
      ['origin: null', 'sec-fetch-site: cross-site', cookie, token],
      false,
    ],
    ['the allowed Origin', ['origin: http://127.0.0.1', cookie, token], true],
    ['Sec-Fetch-Site same-origin with no Origin', ['sec-fetch-site: same-origin', cookie, token], true],
  ];
  await series(attempts, async ([name, headers, allowed]) => {
    const before = app.hit('save');
    const reply = await send(app.port, { method: 'POST', path: '/docs', headers, body: '{"name":"a"}', origin: false });
    const signOut = await send(app.port, {
      method: 'POST',
      path: '/auth/session/clear',
      headers: headers.filter((line) => !line.startsWith('x-csrf')),
      origin: false,
    });
    report.check(
      `${label} ${name}: POST /docs ${allowed ? '200' : '403 CROSS_ORIGIN'}, and the public cleanup route ${allowed ? 'is judged on its own merits' : '403 CROSS_ORIGIN'}`,
      allowed
        ? reply.status === 200 && app.hit('save') === before + 1
        : reply.status === 403 &&
            reply.body === CROSS &&
            signOut.status === 403 &&
            signOut.body === CROSS &&
            app.hit('save') === before,
      `${reply.status} ${reply.body.slice(0, 80)}; cleanup ${signOut.status}`,
    );
  });
  const signOutCross = await send(app.port, {
    method: 'POST',
    path: '/auth/sign-out',
    headers: ['origin: https://evil.example', cookie, token],
    origin: false,
  });
  const stillLive = await get(app.port, '/docs', [cookie]);
  report.check(
    `${label} a cross-site sign-out is 403 CROSS_ORIGIN and the session stays live`,
    signOutCross.status === 403 && signOutCross.body === CROSS && stillLive.status === 200,
    `${signOutCross.status} ${stillLive.status}`,
  );
}

async function exemptCases({ label, rig }: Context): Promise<void> {
  const attempt = async (exempt: readonly ('docs' | 'keysOnly')[]): Promise<string> => {
    const spare = await makeRig(rig.kind, { attach: false });
    try {
      const app = await startApp({ store: spare.store, exempt });
      await app.close();
      return 'listened';
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    } finally {
      await spare.dispose();
    }
  };
  const session = await attempt(['docs']);
  const keysOnly = await attempt(['keysOnly']);
  report.check(
    `${label} a route a session can authenticate (policy docs lists session) in csrfExempt refuses boot`,
    /access refused: cookie route listed in csrfExempt/.test(session),
    session.slice(0, 160),
  );
  report.check(
    `${label} a route whose policy lists no session (API key only) may be csrfExempt: it boots`,
    keysOnly === 'listened',
    keysOnly.slice(0, 160),
  );
}

async function signOutCases({ label, rig, observed, app }: Context): Promise<void> {
  const signed = await app.signIn('leaver');
  const cookie = cookieHeader(NAME, signed.token ?? '');
  const headers = [cookie, `x-csrf-token: ${signed.csrf}`];
  await app.logs.settle();
  const revokedBefore = app.logs.named('auth.session.revoked').length;
  observed.failWith('no', 'sessionRevoke');
  const failed = await send(app.port, { method: 'POST', path: '/auth/sign-out', headers });
  observed.failWith(null);
  const stillThere = await get(app.port, '/docs', [cookie]);
  report.check(
    `${label} sign-out while the store fails (applied no): 503 AUTH_UNAVAILABLE, no Set-Cookie, the session still works`,
    failed.status === 503 &&
      failed.body === UNAVAILABLE &&
      failed.all('set-cookie').length === 0 &&
      stillThere.status === 200,
    `${failed.status} ${failed.body}; set-cookie ${failed.all('set-cookie').length}; session ${stillThere.status}`,
  );
  observed.after('sessionRevoke', () =>
    Promise.reject(new StoreFailure('sessionRevoke', 'unavailable', 'unknown', null)),
  );
  const unknown = await send(app.port, { method: 'POST', path: '/auth/sign-out', headers });
  observed.after('sessionRevoke', null);
  const afterUnknown = await get(app.port, '/docs', [cookie]);
  report.check(
    `${label} sign-out whose acknowledgment is lost (the revocation committed): 503 and nothing cleared, never reported as success; the session is in fact ended`,
    unknown.status === 503 &&
      unknown.body === UNAVAILABLE &&
      unknown.all('set-cookie').length === 0 &&
      afterUnknown.status === 401,
    `${unknown.status}; set-cookie ${unknown.all('set-cookie').length}; later request ${afterUnknown.status}`,
  );
  await app.logs.settle();
  report.check(
    `${label} the two failed sign-outs wrote no auth.session.revoked record`,
    app.logs.named('auth.session.revoked').length === revokedBefore,
    `${app.logs.named('auth.session.revoked').length - revokedBefore} records`,
  );

  const second = await app.signIn('leaver');
  const secondHeaders = [cookieHeader(NAME, second.token ?? ''), `x-csrf-token: ${second.csrf}`];
  const out = await send(app.port, { method: 'POST', path: '/auth/sign-out', headers: secondHeaders });
  const rows = await sessionRowCount(rig, 'leaver');
  const later = await get(app.port, '/docs', [cookieHeader(NAME, second.token ?? '')]);
  await app.logs.settle();
  const revoked = app.logs.named('auth.session.revoked').slice(revokedBefore);
  report.check(
    `${label} a confirmed sign-out: 204, the clearing cookie, the row gone, the next request 401, one auth.session.revoked with cause sign_out`,
    out.status === 204 &&
      out.all('set-cookie')[0] === `${NAME}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax` &&
      rows === 0 &&
      later.status === 401 &&
      revoked.length === 1 &&
      revoked[0]?.fields['auth.cause'] === 'sign_out',
    `${out.status}; rows ${rows}; later ${later.status}; ${revoked.length} record(s)`,
  );
  const again = await send(app.port, { method: 'POST', path: '/auth/sign-out', headers: secondHeaders });
  const anonymous = await send(app.port, { method: 'POST', path: '/auth/sign-out' });
  report.check(
    `${label} sign-out again, or with no session: 401 and no Set-Cookie`,
    again.status === 401 && anonymous.status === 401 && again.all('set-cookie').length === 0,
    `${again.status} ${anonymous.status}`,
  );
}

async function cleanupCases({ label, rig, observed, app }: Context): Promise<void> {
  const live = await app.signIn('cleaner');
  const liveCookie = cookieHeader(NAME, live.token ?? '');
  const dead = randomBytes(32).toString('base64url');
  const cleared = `${NAME}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`;
  const deadReply = await send(app.port, {
    method: 'POST',
    path: '/auth/session/clear',
    headers: [cookieHeader(NAME, dead)],
  });
  report.check(
    `${label} cleanup of a dead cookie: 204 with the clearing cookie and no-store`,
    deadReply.status === 204 &&
      deadReply.all('set-cookie')[0] === cleared &&
      deadReply.first('cache-control') === 'no-store',
    `${deadReply.status} ${deadReply.all('set-cookie')[0]}`,
  );
  const rowsBefore = await sessionRowCount(rig, 'cleaner');
  observed.reset();
  const liveReply = await send(app.port, { method: 'POST', path: '/auth/session/clear', headers: [liveCookie] });
  const stillLive = await get(app.port, '/docs', [liveCookie]);
  report.check(
    `${label} cleanup with a live session's cookie: 409 SESSION_LIVE, nothing cleared, nothing revoked, the session still works`,
    liveReply.status === 409 &&
      liveReply.json().code === 'SESSION_LIVE' &&
      liveReply.body === '{"status":409,"code":"SESSION_LIVE","message":"Session is live"}' &&
      liveReply.all('set-cookie').length === 0 &&
      stillLive.status === 200 &&
      (await sessionRowCount(rig, 'cleaner')) === rowsBefore &&
      observed.calls('sessionRevoke') === 0,
    `${liveReply.status} ${liveReply.body}; set-cookie ${liveReply.all('set-cookie').length}; session ${stillLive.status}`,
  );
  const none = await send(app.port, { method: 'POST', path: '/auth/session/clear' });
  const malformed = await send(app.port, {
    method: 'POST',
    path: '/auth/session/clear',
    headers: [cookieHeader(NAME, 'short')],
  });
  report.note(
    `${label} observation: cleanup with no cookie answers ${none.status} (set-cookie ${none.all('set-cookie').length}); with a malformed cookie ${malformed.status} (set-cookie ${malformed.all('set-cookie').length})`,
  );
  report.check(
    `${label} cleanup with no cookie or a malformed one is 204`,
    none.status === 204 && malformed.status === 204,
    `${none.status} ${malformed.status}`,
  );
  const revoked = await app.signIn('cleaner2');
  await app.subjects.revokeSessions('cleaner2');
  const afterRevoke = await send(app.port, {
    method: 'POST',
    path: '/auth/session/clear',
    headers: [cookieHeader(NAME, revoked.token ?? '')],
  });
  report.check(
    `${label} cleanup of a revoked session's cookie: 204 with the clearing cookie`,
    afterRevoke.status === 204 && afterRevoke.all('set-cookie')[0] === cleared,
    `${afterRevoke.status}`,
  );
  observed.failWith('no', 'sessionRead');
  const outage = await send(app.port, { method: 'POST', path: '/auth/session/clear', headers: [liveCookie] });
  const outageDead = await send(app.port, {
    method: 'POST',
    path: '/auth/session/clear',
    headers: [cookieHeader(NAME, dead)],
  });
  observed.failWith(null);
  report.check(
    `${label} cleanup while the store cannot confirm: 503 AUTH_UNAVAILABLE and nothing cleared, for a live and for a dead cookie`,
    [outage, outageDead].every(
      (reply) => reply.status === 503 && reply.body === UNAVAILABLE && reply.all('set-cookie').length === 0,
    ),
    `${outage.status} ${outageDead.status}`,
  );
  const afterOutage = await get(app.port, '/docs', [liveCookie]);
  report.check(
    `${label} the live session survived every cleanup call`,
    afterOutage.status === 200,
    `${afterOutage.status}`,
  );
}

async function limitCases({ label, rig }: Context): Promise<void> {
  const spare = await makeRig(rig.kind, { attach: false });
  const probe = observe(spare.store);
  const app = await startApp({ store: probe.store, addressLimit: { max: 5, windowSeconds: 60 } });
  try {
    const live = await app.signIn('limited-cleaner');
    const cookie = cookieHeader(NAME, live.token ?? '');
    const replies: Reply[] = [];
    await series(
      Array.from({ length: 7 }, (_, n) => n),
      async () => {
        replies.push(await send(app.port, { method: 'POST', path: '/auth/session/clear', headers: [cookie] }));
      },
    );
    const statuses = replies.map((reply) => reply.status).join(',');
    const reads = probe.calls('sessionRead');
    const retry = Number(replies[5]?.first('retry-after'));
    report.check(
      `${label} the address limit comes first on cleanup: 5 calls in the window are judged (409), the 6th and 7th are 429 RATE_LIMITED with retry-after and are not looked up`,
      statuses === '409,409,409,409,409,429,429' &&
        replies[5]?.body === '{"status":429,"code":"RATE_LIMITED","message":"Too many requests"}' &&
        Number.isInteger(retry) &&
        retry >= 1 &&
        retry <= 60 &&
        reads === 5,
      `${statuses}; retry-after ${replies[5]?.first('retry-after')}; sessionRead calls ${reads}`,
    );
    const still = await get(app.port, '/docs', [cookie]);
    report.check(`${label} the session survived the cleanup flood`, still.status === 200, `${still.status}`);
  } finally {
    await app.close();
    await spare.dispose();
  }
}

async function cacheCases({ label, app }: Context): Promise<void> {
  const signed = await app.signIn('cache-user');
  const cookie = cookieHeader(NAME, signed.token ?? '');
  const replies: [string, Reply][] = [
    ['GET /auth/session with a session', await get(app.port, '/auth/session', [cookie])],
    ['GET /auth/session with no cookie', await get(app.port, '/auth/session')],
    [
      'GET /auth/session with a dead cookie',
      await get(app.port, '/auth/session', [cookieHeader(NAME, randomBytes(32).toString('base64url'))]),
    ],
    [
      'POST /auth/sign-out without the token',
      await send(app.port, { method: 'POST', path: '/auth/sign-out', headers: [cookie] }),
    ],
    [
      'POST /auth/session/clear with a dead cookie',
      await send(app.port, {
        method: 'POST',
        path: '/auth/session/clear',
        headers: [cookieHeader(NAME, randomBytes(32).toString('base64url'))],
      }),
    ],
    [
      'the sign-in route (application-owned)',
      await send(app.port, { method: 'POST', path: '/sign-in', body: '{"userId":"cache-user2"}' }),
    ],
  ];
  await series(replies, ([name, reply]) => {
    report.check(
      `${label} ${name} (${reply.status}): cache-control no-store`,
      reply.first('cache-control') === 'no-store',
      `${reply.first('cache-control')}`,
    );
    return Promise.resolve();
  });
  const stateBody = replies[0]?.[1].body ?? '';
  report.check(
    `${label} the only secret in the session state is its own CSRF token; the session token is in no body`,
    stateBody.includes(signed.csrf) && !stateBody.includes(signed.token ?? 'x'),
    stateBody.replace(signed.csrf, '<csrf>'),
  );
  const refusals = replies.slice(1, 5);
  report.check(
    `${label} no refusal or error body contains a token`,
    refusals.every(([, reply]) => !reply.body.includes(signed.csrf) && !reply.body.includes(signed.token ?? 'x')),
  );
  await sleepMs(0);
  await app.logs.settle();
  report.check(
    `${label} neither the session token, the CSRF token nor the cookie value is in any log record`,
    !app.logs.text().includes(signed.csrf) &&
      !app.logs.text().includes(signed.token ?? 'x') &&
      !app.logs.text().includes(csrfOf(signed.token ?? '')),
    `${app.logs.records().length} records searched`,
  );
}

async function suite(kind: Kind): Promise<void> {
  const label = `[${kind}]`;
  const rig = await makeRig(kind, { attach: false });
  const observed = observe(rig.store);
  const app = await startApp({ store: observed.store });
  const context: Context = { label, rig, observed, app };
  try {
    await report.run(`${label} CSRF token`, () => tokenCases(context));
    await report.run(`${label} cross-site check`, () => crossSiteCases(context));
    await report.run(`${label} sign-out`, () => signOutCases(context));
    await report.run(`${label} cleanup`, () => cleanupCases(context));
    await report.run(`${label} cache and secrets`, () => cacheCases(context));
  } finally {
    await app.close();
  }
  try {
    await report.run(`${label} csrfExempt`, () => exemptCases(context));
    const fresh = await makeRig(kind, { attach: false });
    try {
      await report.run(`${label} cleanup address limit`, () => limitCases({ ...context, rig: fresh }));
    } finally {
      await fresh.dispose();
    }
  } finally {
    await rig.dispose();
  }
}

try {
  await series(rigKinds, suite);
} finally {
  await cleanAll();
}
report.finish();
