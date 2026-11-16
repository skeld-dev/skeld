// Does:  Proves the gate's ordering and its fixed refusals on a real auth server over SQLite and PostgreSQL.
// Holds: Each refusal is judged by status, exact body bytes and headers, and none reaches its handler or sets a cookie.

import { randomBytes } from 'node:crypto';
import { defineContract } from '@skeld/core/contract';
import type { Gate, GateRoute, IdentifyOutcome, AuthorizeOutcome, AccessTypes } from '@skeld/core/gate';
import { object, string } from '@skeld/core/schema';
import { expose } from '@skeld/core/secret';
import { createServer } from '@skeld/core/server';
import { makeRig, rigKinds, cleanAll, type Kind } from './support-store.ts';
import {
  type App,
  cookieHeader,
  createLogs,
  get,
  type Observed,
  observe,
  openSocket,
  type Reply,
  send,
  series,
  sleepMs,
  startApp,
  disableUser,
} from './rig/v1-app.ts';
import { createReport } from './rig/v1-report.ts';

const statement =
  'identity is checked before the body is read and authorization after validation; missing, invalid and conflicting credentials, a missing CSRF token, a limit, a denial and an outage each have their fixed refusal byte for byte; optional access admits a missing credential and never an invalid one; an action that throws, answers a non-boolean, passes its deadline or answers late never admits; no refused request reaches its handler';
const report = createReport('v01', statement);

const BODY = {
  missing: '{"status":401,"code":"CREDENTIAL_MISSING","message":"Credential required"}',
  invalid: '{"status":401,"code":"CREDENTIAL_INVALID","message":"Credential not accepted"}',
  conflict: '{"status":400,"code":"CREDENTIAL_CONFLICT","message":"More than one credential"}',
  csrf: '{"status":403,"code":"CSRF_TOKEN_INVALID","message":"CSRF token missing or not accepted"}',
  limited: '{"status":429,"code":"RATE_LIMITED","message":"Too many requests"}',
  denied: '{"status":403,"code":"ACCESS_DENIED","message":"Access denied"}',
  unavailable: '{"status":503,"code":"AUTH_UNAVAILABLE","message":"Service unavailable"}',
} as const;

const token = (): string => randomBytes(32).toString('base64url');
const SESSION = '__Host-skeld';

interface Want {
  readonly status: number;
  readonly body: string;
  readonly challenge: boolean;
}

function refusal(label: string, reply: Reply, want: Want, hits: () => number, hitsBefore: number): void {
  const challenge = reply.first('www-authenticate');
  report.check(
    `${label}: ${want.status} with the fixed body`,
    reply.status === want.status && reply.body === want.body,
    `${reply.status} ${reply.body}`,
  );
  report.check(
    `${label}: www-authenticate ${want.challenge ? 'Bearer' : 'absent'}, no set-cookie, handler not reached`,
    (want.challenge ? challenge === 'Bearer' : challenge === null) &&
      reply.all('set-cookie').length === 0 &&
      hits() === hitsBefore,
    `challenge ${challenge}, set-cookie ${reply.all('set-cookie').length}, handler runs ${hits() - hitsBefore}`,
  );
}

async function sessionOf(app: App, userId: string): Promise<{ token: string; csrf: string }> {
  const signed = await app.signIn(userId);
  if (signed.token === null) {
    throw new Error(`sign-in answered ${signed.result}`);
  }
  return { token: signed.token, csrf: signed.csrf };
}

interface Ctx {
  readonly label: string;
  readonly app: App;
  readonly observed: Observed;
  readonly key: string;
  readonly setRead: (behaviour: () => boolean | Promise<boolean>) => void;
}

interface Live {
  readonly token: string;
  readonly csrf: string;
}

async function missingAndInvalid(c: Ctx): Promise<void> {
  const { label, app, key } = c;
  const docsHits = (): number => app.hit('docs');
  const sessionOnlyHits = (): number => app.hit('sessionOnly');
  let before = docsHits();
  refusal(
    `${label} missing on a policy route`,
    await get(app.port, '/docs'),
    { status: 401, body: BODY.missing, challenge: true },
    docsHits,
    before,
  );
  before = sessionOnlyHits();
  refusal(
    `${label} missing on a session-only route`,
    await get(app.port, '/session-only'),
    { status: 401, body: BODY.missing, challenge: false },
    sessionOnlyHits,
    before,
  );
  await app.logs.settle();
  report.check(
    `${label} the missing refusal is one skeld.refuse.credential_missing record at info`,
    app.logs.named('skeld.refuse.credential_missing').length === 2 &&
      app.logs.named('skeld.refuse.credential_missing').every((r) => r.severity === 'info'),
    `${app.logs.named('skeld.refuse.credential_missing').length} records`,
  );
  const invalidCookies: [string, string][] = [
    ['42 characters', token().slice(0, 42)],
    ['44 characters', `${token()}A`],
    ['outside the alphabet', `${token().slice(0, 42)}+`],
    ['padding', `${token().slice(0, 42)}=`],
    ['well formed and unknown', token()],
    ['hex text of the right length', randomBytes(32).toString('hex').slice(0, 43)],
  ];
  await series(invalidCookies, async ([name, value]) => {
    const hitsBefore = docsHits();
    refusal(
      `${label} invalid session cookie (${name})`,
      await get(app.port, '/docs', [cookieHeader(SESSION, value)]),
      { status: 401, body: BODY.invalid, challenge: false },
      docsHits,
      hitsBefore,
    );
  });
  const invalidBearers: [string, string][] = [
    ['a Basic scheme', 'Basic YWxpY2U6eA=='],
    ['an empty token', 'Bearer '],
    ['a lower-case scheme', `bearer ${key}`],
    ['a token with a space', 'Bearer a b'],
    ['a token outside b64token', 'Bearer {x}'],
    ['4,097 characters', `Bearer ${'a'.repeat(4097)}`],
    ['an unknown API key', `Bearer skeld1.${randomBytes(12).toString('base64url')}.${token()}`],
    ['a JWT-shaped token with no jwt kind installed', 'Bearer eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJ4In0.c2ln'],
  ];
  await series(invalidBearers, async ([name, value]) => {
    const hitsBefore = docsHits();
    refusal(
      `${label} invalid authorization (${name})`,
      await get(app.port, '/docs', [`authorization: ${value}`]),
      { status: 401, body: BODY.invalid, challenge: true },
      docsHits,
      hitsBefore,
    );
  });
  before = sessionOnlyHits();
  refusal(
    `${label} a kind the route's policy does not list (an API key on a session-only route)`,
    await get(app.port, '/session-only', [`authorization: Bearer ${key}`]),
    { status: 401, body: BODY.invalid, challenge: true },
    sessionOnlyHits,
    before,
  );
}

async function revoked(c: Ctx): Promise<Live> {
  const { label, app, key } = c;
  const docsHits = (): number => app.hit('docs');
  let before = 0;
  const second = await sessionOf(app, 'alice');
  await app.subjects.revokeSessions('alice');
  before = docsHits();
  refusal(
    `${label} a session ended by revokeSessions`,
    await get(app.port, '/docs', [cookieHeader(SESSION, second.token)]),
    { status: 401, body: BODY.invalid, challenge: false },
    docsHits,
    before,
  );
  const offGeneration = await disableUser(app.subjects, 'alice');
  before = docsHits();
  refusal(
    `${label} an API key of a disabled subject`,
    await get(app.port, '/docs', [`authorization: Bearer ${key}`]),
    { status: 401, body: BODY.invalid, challenge: true },
    docsHits,
    before,
  );
  await app.subjects.enable('alice', offGeneration);
  const live = await sessionOf(app, 'alice');
  const okReply = await get(app.port, '/docs', [cookieHeader(SESSION, live.token)]);
  report.check(
    `${label} a fresh session after enable is admitted`,
    okReply.status === 200 && okReply.json().who === 'session:alice',
    okReply.body,
  );
  return live;
}

async function conflictAndOptional(c: Ctx, live: Live): Promise<void> {
  const { label, app, observed, key } = c;
  const docsHits = (): number => app.hit('docs');
  const liveCookie = cookieHeader(SESSION, live.token);
  let before = 0;
  const another = await sessionOf(app, 'bob');
  const conflicts: [string, string][] = [
    ['two session cookies, both live', `cookie: ${SESSION}=${live.token}; ${SESSION}=${another.token}`],
    ['two session cookies, one invalid', `cookie: ${SESSION}=${live.token}; ${SESSION}=${token()}`],
  ];
  await series(conflicts, async ([name, header]) => {
    const hitsBefore = docsHits();
    refusal(
      `${label} conflict (${name})`,
      await get(app.port, '/docs', [header]),
      { status: 400, body: BODY.conflict, challenge: false },
      docsHits,
      hitsBefore,
    );
  });
  before = docsHits();
  refusal(
    `${label} conflict (a session cookie beside an authorization header)`,
    await get(app.port, '/docs', [liveCookie, `authorization: Bearer ${key}`]),
    { status: 400, body: BODY.conflict, challenge: false },
    docsHits,
    before,
  );
  await app.logs.settle();
  report.check(
    `${label} each conflict is a skeld.refuse.credential_conflict record at warn`,
    app.logs.named('skeld.refuse.credential_conflict').length === 3 &&
      app.logs.named('skeld.refuse.credential_conflict').every((r) => r.severity === 'warn'),
    `${app.logs.named('skeld.refuse.credential_conflict').length} records`,
  );
  observed.reset();
  const anonymous = await get(app.port, '/whoami');
  report.check(
    `${label} optional: a missing credential is admitted as anonymous with no store read`,
    anonymous.status === 200 && anonymous.json().who === 'anonymous' && observed.calls() === 0,
    `${anonymous.status} ${anonymous.body}; store calls ${observed.calls()}`,
  );
  const whoamiHits = (): number => app.hit('whoami');
  before = whoamiHits();
  refusal(
    `${label} optional: an invalid cookie is refused`,
    await get(app.port, '/whoami', [cookieHeader(SESSION, token())]),
    { status: 401, body: BODY.invalid, challenge: false },
    whoamiHits,
    before,
  );
  before = whoamiHits();
  refusal(
    `${label} optional: an invalid bearer is refused`,
    await get(app.port, '/whoami', ['authorization: Bearer nope']),
    { status: 401, body: BODY.invalid, challenge: true },
    whoamiHits,
    before,
  );
  before = whoamiHits();
  refusal(
    `${label} optional: conflicting credentials are refused`,
    await get(app.port, '/whoami', [liveCookie, `authorization: Bearer ${key}`]),
    { status: 400, body: BODY.conflict, challenge: false },
    whoamiHits,
    before,
  );
  const seenSession = await get(app.port, '/whoami', [liveCookie]);
  const seenKey = await get(app.port, '/whoami', [`authorization: Bearer ${key}`]);
  report.check(
    `${label} optional: a live session and a live key are admitted as themselves`,
    seenSession.json().who === 'session:alice' && seenKey.json().who === 'api_key:alice',
    `${seenSession.body} ${seenKey.body}`,
  );
}

async function csrf(c: Ctx, live: Live): Promise<void> {
  const { label, app } = c;
  const liveCookie = cookieHeader(SESSION, live.token);
  const unsafeNoToken = await send(app.port, {
    method: 'POST',
    path: '/docs',
    headers: [liveCookie],
    body: '{"name":"a"}',
  });
  report.check(
    `${label} csrf_token: a missing token on an unsafe session request is 403 with the fixed body`,
    unsafeNoToken.status === 403 && unsafeNoToken.body === BODY.csrf && app.hit('save') === 0,
    `${unsafeNoToken.status} ${unsafeNoToken.body}`,
  );
  const wrongToken = await send(app.port, {
    method: 'POST',
    path: '/docs',
    headers: [liveCookie, `x-csrf-token: ${token()}`],
    body: '{"name":"a"}',
  });
  report.check(
    `${label} csrf_token: a wrong token is the same refusal`,
    wrongToken.status === 403 && wrongToken.body === BODY.csrf && app.hit('save') === 0,
    `${wrongToken.status} ${wrongToken.body}`,
  );
  const deadWithoutToken = await send(app.port, {
    method: 'POST',
    path: '/docs',
    headers: [cookieHeader(SESSION, token())],
    body: '{"name":"a"}',
  });
  report.check(
    `${label} csrf_token: a dead session with no token is 401 first`,
    deadWithoutToken.status === 401 && deadWithoutToken.body === BODY.invalid,
    `${deadWithoutToken.status} ${deadWithoutToken.body}`,
  );
  const withToken = await send(app.port, {
    method: 'POST',
    path: '/docs',
    headers: [liveCookie, `x-csrf-token: ${live.csrf}`],
    body: '{"name":"abc"}',
  });
  report.check(
    `${label} csrf_token: the session's own token admits and the handler runs once`,
    withToken.status === 200 && withToken.json().saved === 'abc' && app.hit('save') === 1,
    `${withToken.status} ${withToken.body}`,
  );
}

async function limitsAndAccess(c: Ctx, live: Live): Promise<void> {
  const { label, app } = c;
  const docsHits = (): number => app.hit('docs');
  const liveCookie = cookieHeader(SESSION, live.token);
  let before = 0;
  const carol = await sessionOf(app, 'dora');
  const lim = cookieHeader(SESSION, carol.token);
  const l1 = await get(app.port, '/limited', [lim]);
  const l2 = await get(app.port, '/limited', [lim]);
  const l3 = await get(app.port, '/limited', [lim]);
  const retry = Number(l3.first('retry-after'));
  report.check(
    `${label} rate_limited: the third call in a window of two is 429 with the fixed body`,
    l1.status === 200 && l2.status === 200 && l3.status === 429 && l3.body === BODY.limited,
    `${l1.status} ${l2.status} ${l3.status} ${l3.body}`,
  );
  report.check(
    `${label} rate_limited: retry-after is an integer from 1 to 86400 and the handler ran twice`,
    Number.isInteger(retry) && retry >= 1 && retry <= 86400 && app.hit('limited') === 2,
    `retry-after ${l3.first('retry-after')}`,
  );
  await app.logs.settle();
  report.check(
    `${label} rate_limited: one skeld.refuse.rate_limited record at warn`,
    app.logs.named('skeld.refuse.rate_limited').length === 1 &&
      app.logs.named('skeld.refuse.rate_limited').every((r) => r.severity === 'warn'),
    `${app.logs.named('skeld.refuse.rate_limited').length} records`,
  );

  const scopedKey = await app.keys.issue({ userId: 'erin', name: 'scoped', scopes: ['docs:read'] });
  if (scopedKey.kind !== 'issued') {
    throw new Error('issue failed');
  }
  const scoped = `authorization: Bearer ${expose(scopedKey.key)}`;
  before = app.hit('save');
  const saveByKey = await send(app.port, { method: 'POST', path: '/docs', headers: [scoped], body: '{"name":"a"}' });
  report.check(
    `${label} access_denied: an API key without the scope docs:write is 403 with the fixed body`,
    saveByKey.status === 403 && saveByKey.body === BODY.denied && app.hit('save') === before,
    `${saveByKey.status} ${saveByKey.body}`,
  );
  const readByKey = await get(app.port, '/docs', [scoped]);
  report.check(
    `${label} access_denied: the same key with the scope docs:read is admitted`,
    readByKey.status === 200 && readByKey.json().who === 'api_key:erin',
    `${readByKey.status} ${readByKey.body}`,
  );
  c.setRead(() => false);
  before = docsHits();
  refusal(
    `${label} access_denied: an action that answers false`,
    await get(app.port, '/docs', [liveCookie]),
    { status: 403, body: BODY.denied, challenge: false },
    docsHits,
    before,
  );
  c.setRead(() => true);
}

async function ordering(c: Ctx, live: Live): Promise<void> {
  const { label, app } = c;
  const liveCookie = cookieHeader(SESSION, live.token);
  const refusedEarly = await openSocket(app.port);
  refusedEarly.write(
    `POST /docs HTTP/1.1\r\nhost: x\r\norigin: http://127.0.0.1\r\ncontent-type: application/json\r\ncontent-length: 100000\r\n\r\n`,
  );
  const early = await refusedEarly.until('Credential required', 1500);
  report.check(
    `${label} identity before the body: a refusal arrives while 100,000 declared body bytes have not been sent`,
    early?.startsWith('HTTP/1.1 401') === true,
    early === null ? 'no response in 1,500 ms' : (early.split('\r\n')[0] ?? ''),
  );
  report.check(
    `${label} identity before the body: the connection is closed after the refusal (body bytes unread)`,
    await refusedEarly.closed(3000),
  );
  refusedEarly.destroy();
  const admittedWaits = await openSocket(app.port);
  admittedWaits.write(
    `POST /docs HTTP/1.1\r\nhost: x\r\norigin: http://127.0.0.1\r\ncookie: ${SESSION}=${live.token}\r\nx-csrf-token: ${live.csrf}\r\ncontent-type: application/json\r\ncontent-length: 800\r\n\r\n`,
  );
  const waiting = await admittedWaits.until('HTTP/1.1', 600);
  report.check(
    `${label} identity before the body: a live session with the same unsent body is admitted and waits for it (control)`,
    waiting === null,
    waiting === null ? 'no response in 600 ms' : (waiting.split('\r\n')[0] ?? ''),
  );
  admittedWaits.destroy();

  const badBodyNoCredential = await send(app.port, { method: 'POST', path: '/docs', body: '{"name":' });
  report.check(
    `${label} identity precedes validation: an invalid body with no credential is 401, not a validation error`,
    badBodyNoCredential.status === 401 && badBodyNoCredential.body === BODY.missing,
    `${badBodyNoCredential.status} ${badBodyNoCredential.body}`,
  );
  const writesBefore = app.actionCalls.get('docs.write') ?? 0;
  const tooLong = await send(app.port, {
    method: 'POST',
    path: '/docs',
    headers: [liveCookie, `x-csrf-token: ${live.csrf}`],
    body: `{"name":"${'x'.repeat(40)}"}`,
  });
  report.check(
    `${label} authorization follows validation: an invalid body with a live session is a validation error and no action runs`,
    tooLong.status === 400 && (app.actionCalls.get('docs.write') ?? 0) === writesBefore && app.hit('save') === 1,
    `${tooLong.status} ${tooLong.body}; action runs ${(app.actionCalls.get('docs.write') ?? 0) - writesBefore}`,
  );
  const valid = await send(app.port, {
    method: 'POST',
    path: '/docs',
    headers: [liveCookie, `x-csrf-token: ${live.csrf}`],
    body: '{"name":"ok"}',
  });
  report.check(
    `${label} authorization follows validation: a valid body runs the action once and then the handler`,
    valid.status === 200 && (app.actionCalls.get('docs.write') ?? 0) === writesBefore + 1 && app.hit('save') === 2,
    `${valid.status}; action runs ${(app.actionCalls.get('docs.write') ?? 0) - writesBefore}`,
  );
  const head = await send(app.port, { method: 'HEAD', path: '/docs', waitMs: 1500 });
  report.check(
    `${label} HEAD uses the GET route's gate`,
    head.status === 401,
    `HEAD /docs without a credential: ${head.status}`,
  );
}

async function actionFaultCases(c: Ctx, live: Live): Promise<void> {
  const { label, app, observed, key } = c;
  const docsHits = (): number => app.hit('docs');
  const liveCookie = cookieHeader(SESSION, live.token);
  let before = 0;
  const handlerRuns = (): number => app.hit('docs');
  const faults: [string, () => boolean | Promise<boolean>][] = [
    [
      'an action that throws',
      () => {
        throw new Error('ACTION-SECRET-TEXT');
      },
    ],
    ['an action that rejects', () => Promise.reject(new Error('ACTION-SECRET-TEXT'))],
    ['an action that answers the string "true"', () => JSON.parse('"true"')],
    ['an action that answers 1', () => JSON.parse('1')],
    ['an action that answers undefined', () => JSON.parse('null')],
  ];
  await series(faults, async ([name, behaviour]) => {
    c.setRead(behaviour);
    const hitsBefore = handlerRuns();
    const failed = await get(app.port, '/docs', [liveCookie]);
    report.check(
      `${label} ${name} never admits: 500 with the fixed body and no handler run`,
      failed.status === 500 &&
        failed.json().code === 'INTERNAL' &&
        !failed.body.includes('SECRET') &&
        handlerRuns() === hitsBefore,
      `${failed.status} ${failed.body}`,
    );
  });
  c.setRead(() => true);
  await app.logs.settle();
  report.check(
    `${label} the thrown text reaches no record`,
    !app.logs.text().includes('ACTION-SECRET-TEXT') && app.logs.named('auth.callback.failed').length >= 5,
    `${app.logs.named('auth.callback.failed').length} auth.callback.failed records`,
  );
  observed.failWith('no');
  before = docsHits();
  refusal(
    `${label} unavailable: a session request while the store fails`,
    await get(app.port, '/docs', [liveCookie]),
    { status: 503, body: BODY.unavailable, challenge: false },
    docsHits,
    before,
  );
  refusal(
    `${label} unavailable: an API key request while the store fails`,
    await get(app.port, '/docs', [`authorization: Bearer ${key}`]),
    { status: 503, body: BODY.unavailable, challenge: false },
    docsHits,
    before,
  );
  await app.logs.settle();
  const outageRecords = app.logs.named('skeld.refuse.unavailable');
  report.check(
    `${label} unavailable: two skeld.refuse.unavailable records at error`,
    outageRecords.length === 2 && outageRecords.every((r) => r.severity === 'error'),
    `${outageRecords.length} records`,
  );
  observed.failWith(null);
  const recovered = await get(app.port, '/docs', [liveCookie]);
  report.check(
    `${label} the same session is admitted when the store answers again`,
    recovered.status === 200,
    `${recovered.status}`,
  );
}

async function storeCases(kind: Kind): Promise<void> {
  const label = `[${kind}]`;
  const rig = await makeRig(kind, { attach: false });
  const observed: Observed = observe(rig.store);
  let docsRead: () => boolean | Promise<boolean> = () => true;
  const app = await startApp({ store: observed.store, docsRead: () => docsRead() });
  try {
    await sessionOf(app, 'alice');
    const issued = await app.keys.issue({ userId: 'alice', name: 'read key', scopes: ['docs:read'] });
    if (issued.kind !== 'issued') {
      throw new Error(`issue answered ${issued.kind}`);
    }
    const c: Ctx = {
      label,
      app,
      observed,
      key: expose(issued.key),
      setRead: (behaviour) => {
        docsRead = behaviour;
      },
    };
    await missingAndInvalid(c);
    const live = await revoked(c);
    await conflictAndOptional(c, live);
    await csrf(c, live);
    await limitsAndAccess(c, live);
    await ordering(c, live);
    await actionFaultCases(c, live);
  } finally {
    await app.close();
    await rig.dispose();
  }
}

async function preflightCases(kind: Kind): Promise<void> {
  const label = `[${kind}]`;
  const rig = await makeRig(kind, { attach: false });
  const observed = observe(rig.store);
  const identify = { count: 0 };
  const app = await startApp({
    store: observed.store,
    cors: { origins: ['https://app.example'] },
    identifyCalls: identify,
  });
  try {
    const allowed = 'origin: https://app.example';
    const ask = (path: string, headers: readonly string[]): Promise<Reply> =>
      send(app.port, { method: 'OPTIONS', path, headers });
    observed.reset();
    const docsHits = app.hit('docs');
    const whoamiHits = app.hit('whoami');
    const policy = await ask('/docs', [allowed, 'access-control-request-method: GET']);
    const optional = await ask('/whoami', [allowed, 'access-control-request-method: GET']);
    report.check(
      `${label} an OPTIONS preflight to a policy route and to an optional route is answered with no credential: 204, the CORS grant, no challenge, no gate call, no store read, no handler`,
      [policy, optional].every(
        (reply) =>
          reply.status === 204 &&
          reply.first('access-control-allow-origin') === 'https://app.example' &&
          reply.first('www-authenticate') === null &&
          reply.all('set-cookie').length === 0,
      ) &&
        identify.count === 0 &&
        observed.calls() === 0 &&
        app.hit('docs') === docsHits &&
        app.hit('whoami') === whoamiHits,
      `${policy.status} ${optional.status}; identify calls ${identify.count}; store calls ${observed.calls()}`,
    );
    const actual = await send(app.port, { method: 'GET', path: '/docs', headers: [allowed] });
    report.check(
      `${label} the actual request that follows without a credential is refused 401 CREDENTIAL_MISSING by the gate (identify now called once)`,
      actual.status === 401 && actual.body === BODY.missing && identify.count === 1 && app.hit('docs') === docsHits,
      `${actual.status} ${actual.body}; identify calls ${identify.count}`,
    );
    identify.count = 0;
    observed.reset();
    const refused = await ask('/docs', ['origin: https://evil.example', 'access-control-request-method: GET']);
    const refusedOptional = await ask('/whoami', [
      'origin: https://evil.example',
      'access-control-request-method: GET',
    ]);
    report.check(
      `${label} a preflight from an origin CORS does not allow gets core's refusal (403 CROSS_ORIGIN, no grant), with no gate call and no store read`,
      [refused, refusedOptional].every(
        (reply) =>
          reply.status === 403 &&
          reply.json().code === 'CROSS_ORIGIN' &&
          reply.first('access-control-allow-origin') === null,
      ) &&
        identify.count === 0 &&
        observed.calls() === 0,
      `${refused.status} ${refused.body}; identify calls ${identify.count}; store calls ${observed.calls()}`,
    );
    const plain = await ask('/docs', [allowed]);
    report.note(
      `${label} observation: an OPTIONS with no Access-Control-Request-Method (not a preflight) answers ${plain.status}; identify calls ${identify.count}`,
    );
  } finally {
    await app.close();
    await rig.dispose();
  }
}

async function deadlineCases(kind: Kind): Promise<void> {
  const label = `[${kind}]`;
  const rig = await makeRig(kind, { attach: false });
  let docsRead: () => boolean | Promise<boolean> = () => true;
  const app = await startApp({ store: rig.store, docsRead: () => docsRead() });
  try {
    const alice = await sessionOf(app, 'alice');
    const cookie = cookieHeader(SESSION, alice.token);
    const timed = async (name: string, behaviour: () => boolean | Promise<boolean>): Promise<void> => {
      docsRead = behaviour;
      const runs = app.hit('docs');
      const began = performance.now();
      const reply = await get(app.port, '/docs', [cookie]);
      const elapsed = Math.round(performance.now() - began);
      await sleepMs(800);
      report.check(
        `${label} ${name}: 503 with the fixed body at the 5,000 ms deadline, no handler run, the late answer ignored`,
        reply.status === 503 &&
          reply.body === BODY.unavailable &&
          app.hit('docs') === runs &&
          elapsed >= 4990 &&
          elapsed <= 5500,
        `${reply.status} after ${elapsed} ms (allowed 4,990 to 5,500 on a shared host); handler runs ${app.hit('docs') - runs}`,
      );
      docsRead = () => true;
    };
    await timed('an action that never settles', () => new Promise<boolean>(() => undefined));
    await timed('an action that answers true after the deadline', async () => {
      await sleepMs(5200);
      return true;
    });
    const deadline = app.logs.named('auth.callback.failed').filter((r) => r.fields['auth.cause'] === 'deadline');
    report.check(
      `${label} each deadline is one auth.callback.failed with cause deadline for policy.action`,
      deadline.length === 2 && deadline.every((r) => r.fields['auth.callback'] === 'policy.action'),
      `${deadline.length} records`,
    );
  } finally {
    await app.close();
    await rig.dispose();
  }
}

const gateContract = defineContract({
  p: {
    method: 'GET',
    path: '/p',
    access: { policy: 'p', action: 'a' },
    responses: { 200: object({ ok: string({ maxLength: 8 }) }) },
  },
});

interface Behaviours {
  identify: () => IdentifyOutcome<unknown> | Promise<IdentifyOutcome<unknown>>;
  authorize: () => AuthorizeOutcome | Promise<AuthorizeOutcome>;
  release: (grant: unknown) => void;
}

const SECRET_TEXT = 'THROWN-SECRET-TEXT';
const admit: IdentifyOutcome<unknown> = { kind: 'admit', principal: { id: 'p1' } };

async function withGate(
  behaviours: Behaviours,
  handlerTimeoutMs: number | undefined,
  body: (port: number, runs: () => number, logs: ReturnType<typeof createLogs>) => Promise<void>,
): Promise<void> {
  const logs = createLogs();
  let runs = 0;
  const gate: Gate<AccessTypes> = {
    boot: () => undefined,
    bind: (_route: GateRoute) => ({
      cookie: false,
      identify: () => behaviours.identify(),
      authorize: () => behaviours.authorize(),
      release: (grant) => behaviours.release(grant),
    }),
  };
  const server = createServer({
    gate,
    log: { thresholds: { security: 'info', app: 'info' }, sink: logs.sink },
    ...(handlerTimeoutMs === undefined ? {} : { handlerTimeoutMs }),
  });
  server.routes(gateContract, {
    p: () => {
      runs++;
      return { status: 200, body: { ok: 'y' } };
    },
  });
  const address = await server.listen({ host: '127.0.0.1', port: 0 });
  try {
    await body(address.port, () => runs, logs);
  } finally {
    await server.close();
  }
}

const never = <T>(): Promise<T> => new Promise<T>(() => undefined);
const grantOf = (): AuthorizeOutcome => ({ kind: 'admit', grant: { g: 1 } });
const okRelease = (): void => undefined;

async function coreGateCases(): Promise<void> {
  const throwing = createServer({ log: false });
  throwing.routes(
    defineContract({ p: { method: 'GET', path: '/p', responses: { 200: object({ ok: string({ maxLength: 8 }) }) } } }),
    {
      p: () => {
        throw new Error(SECRET_TEXT);
      },
    },
  );
  const baseline = await throwing.listen({ host: '127.0.0.1', port: 0 });
  const fixed500 = (await get(baseline.port, '/p')).body;
  await throwing.close();
  report.check(
    '[core] the fixed 500 body of core (a throwing handler) is INTERNAL',
    fixed500.includes('"code":"INTERNAL"'),
    fixed500,
  );
  const malformed: [string, Behaviours][] = [
    [
      'identify answers a kind that is neither value',
      { identify: () => JSON.parse('{"kind":"maybe"}'), authorize: grantOf, release: okRelease },
    ],
    [
      'identify refuses with an unknown reason',
      { identify: () => JSON.parse('{"kind":"refuse","reason":"nope"}'), authorize: grantOf, release: okRelease },
    ],
    [
      'identify admits a null principal on a policy route',
      { identify: () => JSON.parse('{"kind":"admit","principal":null}'), authorize: grantOf, release: okRelease },
    ],
    [
      'identify answers retryAfterSeconds 0',
      {
        identify: () => JSON.parse('{"kind":"refuse","reason":"rate_limited","retryAfterSeconds":0}'),
        authorize: grantOf,
        release: okRelease,
      },
    ],
    [
      'identify answers retryAfterSeconds 86401',
      {
        identify: () => JSON.parse('{"kind":"refuse","reason":"rate_limited","retryAfterSeconds":86401}'),
        authorize: grantOf,
        release: okRelease,
      },
    ],
    [
      'identify answers retryAfterSeconds 1.5',
      {
        identify: () => JSON.parse('{"kind":"refuse","reason":"rate_limited","retryAfterSeconds":1.5}'),
        authorize: grantOf,
        release: okRelease,
      },
    ],
    [
      'identify answers retryAfterSeconds "3"',
      {
        identify: () => JSON.parse('{"kind":"refuse","reason":"rate_limited","retryAfterSeconds":"3"}'),
        authorize: grantOf,
        release: okRelease,
      },
    ],
    [
      'identify admits with no principal member',
      { identify: () => JSON.parse('{"kind":"admit"}'), authorize: grantOf, release: okRelease },
    ],
    [
      'identify admits with an undefined principal',
      { identify: () => ({ kind: 'admit', principal: undefined }), authorize: grantOf, release: okRelease },
    ],
    [
      'authorize admits with no grant member',
      { identify: () => admit, authorize: () => JSON.parse('{"kind":"admit"}'), release: okRelease },
    ],
    [
      'authorize admits with an undefined grant',
      { identify: () => admit, authorize: () => ({ kind: 'admit', grant: undefined }), release: okRelease },
    ],
    ['identify answers nothing', { identify: () => JSON.parse('null'), authorize: grantOf, release: okRelease }],
    [
      'identify throws',
      {
        identify: () => {
          throw new Error(SECRET_TEXT);
        },
        authorize: grantOf,
        release: okRelease,
      },
    ],
    [
      'identify rejects',
      { identify: () => Promise.reject(new Error(SECRET_TEXT)), authorize: grantOf, release: okRelease },
    ],
    [
      'authorize answers a kind that is neither value',
      { identify: () => admit, authorize: () => JSON.parse('{"kind":"yes"}'), release: okRelease },
    ],
    [
      'authorize refuses with an unknown reason',
      { identify: () => admit, authorize: () => JSON.parse('{"kind":"refuse","reason":"nope"}'), release: okRelease },
    ],
    ['authorize answers nothing', { identify: () => admit, authorize: () => JSON.parse('null'), release: okRelease }],
    [
      'authorize throws',
      {
        identify: () => admit,
        authorize: () => {
          throw new Error(SECRET_TEXT);
        },
        release: okRelease,
      },
    ],
    [
      'authorize rejects',
      { identify: () => admit, authorize: () => Promise.reject(new Error(SECRET_TEXT)), release: okRelease },
    ],
  ];
  await series(malformed, async ([name, behaviours]) => {
    await withGate(behaviours, undefined, async (port, runs, logs) => {
      const reply = await get(port, '/p');
      await logs.settle();
      const errors = logs.named('skeld.request.error');
      report.check(
        `[core] ${name}: 500 with the fixed body, no handler run, one request.error with reason gate and no thrown text`,
        reply.status === 500 &&
          reply.body === fixed500 &&
          runs() === 0 &&
          errors.length === 1 &&
          errors[0]?.all['skeld.reason'] === 'gate' &&
          !logs.text().includes(SECRET_TEXT) &&
          !reply.raw.includes(SECRET_TEXT),
        `${reply.status} ${reply.body}; handler runs ${runs()}; request.error records ${errors.length}; reason ${String(errors[0]?.all['skeld.reason'])}`,
      );
    });
  });

  let released: unknown[] = [];
  const grant = { g: 'identity-checked' };
  await withGate(
    {
      identify: () => admit,
      authorize: () => ({ kind: 'admit', grant }),
      release: (value) => void released.push(value),
    },
    undefined,
    async (port, runs) => {
      const reply = await get(port, '/p');
      await sleepMs(100);
      report.check(
        '[core] an admitted request runs the handler once and releases the grant exactly once, by identity',
        reply.status === 200 && runs() === 1 && released.length === 1 && released[0] === grant,
        `${reply.status}; handler runs ${runs()}; releases ${released.length}`,
      );
    },
  );
  released = [];
  await withGate(
    {
      identify: () => admit,
      authorize: () => ({ kind: 'admit', grant }),
      release: (value) => {
        released.push(value);
        throw new Error(SECRET_TEXT);
      },
    },
    undefined,
    async (port, runs, logs) => {
      const reply = await get(port, '/p');
      await logs.settle();
      report.check(
        '[core] a release that throws changes nothing for the client: 200, one skeld.hook.error, no thrown text',
        reply.status === 200 &&
          runs() === 1 &&
          released.length === 1 &&
          logs.named('skeld.hook.error').length === 1 &&
          !logs.text().includes(SECRET_TEXT),
        `${reply.status}; hook.error records ${logs.named('skeld.hook.error').length}`,
      );
    },
  );
  released = [];
  await withGate(
    {
      identify: () => ({ kind: 'refuse', reason: 'csrf_token' }),
      authorize: grantOf,
      release: (value) => void released.push(value),
    },
    undefined,
    async (port, runs) => {
      const reply = await get(port, '/p');
      report.check(
        '[core] a refusal at identify runs no handler and releases nothing',
        reply.status === 403 && runs() === 0 && released.length === 0,
        `${reply.status}`,
      );
    },
  );

  released = [];
  const slow = 700;
  await withGate(
    {
      identify: () => sleepMs(slow).then(() => admit),
      authorize: () => ({ kind: 'admit', grant }),
      release: (value) => void released.push(value),
    },
    250,
    async (port, runs) => {
      const reply = await get(port, '/p');
      await sleepMs(slow + 300);
      report.check(
        '[core] an identify that answers admit after the handler deadline admits nothing: an error status, no handler, no grant made',
        reply.status >= 500 && runs() === 0 && released.length === 0,
        `${reply.status} ${reply.body}; handler runs ${runs()}; releases ${released.length}`,
      );
    },
  );
  released = [];
  await withGate(
    {
      identify: () => admit,
      authorize: () => sleepMs(slow).then(() => ({ kind: 'admit', grant })),
      release: (value) => void released.push(value),
    },
    250,
    async (port, runs) => {
      const reply = await get(port, '/p');
      await sleepMs(slow + 300);
      report.check(
        '[core] an authorize that answers admit after the handler deadline: no handler, and its grant is released once, at once',
        reply.status >= 500 && runs() === 0 && released.length === 1 && released[0] === grant,
        `${reply.status} ${reply.body}; handler runs ${runs()}; releases ${released.length}`,
      );
    },
  );
  released = [];
  await withGate(
    {
      identify: () => admit,
      authorize: () => never<AuthorizeOutcome>(),
      release: (value) => void released.push(value),
    },
    250,
    async (port, runs) => {
      const reply = await get(port, '/p');
      report.check(
        '[core] an authorize that never settles ends at the deadline with an error status and no handler',
        reply.status >= 500 && runs() === 0,
        `${reply.status} ${reply.body}`,
      );
    },
  );
  released = [];
  await withGate(
    {
      identify: () => admit,
      authorize: () => sleepMs(500).then(() => ({ kind: 'admit', grant })),
      release: (value) => void released.push(value),
    },
    undefined,
    async (port, runs) => {
      const client = await openSocket(port);
      client.write('GET /p HTTP/1.1\r\nhost: x\r\n\r\n');
      await sleepMs(100);
      client.destroy();
      await sleepMs(900);
      report.check(
        '[core] a client that leaves while authorize runs: the late grant is released once and no handler runs',
        runs() === 0 && released.length === 1 && released[0] === grant,
        `handler runs ${runs()}; releases ${released.length}`,
      );
    },
  );
}

try {
  await report.run('[core] custom gate cases', coreGateCases);
  await series(rigKinds, async (kind) => {
    await report.run(`[${kind}] store-backed gate cases`, () => storeCases(kind));
  });
  await series(rigKinds, async (kind) => {
    await report.run(`[${kind}] deadline cases`, () => deadlineCases(kind));
    await report.run(`[${kind}] preflight cases`, () => preflightCases(kind));
  });
} finally {
  await cleanAll();
}
report.finish();
