// Does:  Proves a throwing, rejecting, malformed or late application callback never admits and leaks no text.
// Holds: Each failed request gets the fixed answer and one auth.callback.failed record, never the callback's words.
// biome-ignore-all lint/performance/noAwaitInLoops: each case is a request that must finish before the next
// biome-ignore-all lint/nursery/noUnsafeTypeAssertion: a hostile callback deliberately answers shapes the type forbids
// biome-ignore-all lint/security/noSecrets: canary text and header names are fixtures, not secrets

import { apiKeys } from '@skeld/auth/api-key';
import { jwt } from '@skeld/auth/jwt';
import { definePolicy } from '@skeld/auth/policy';
import { createAuth } from '@skeld/auth/server';
import { defineContract } from '@skeld/core/contract';
import { expose } from '@skeld/core/secret';
import * as t from '@skeld/core/schema';
import { createServer } from '@skeld/core/server';
import type { LogLine } from './rig/app.ts';
import { begin, bootOidc, COOKIE, location } from './rig/oidc-app.ts';
import { childPki } from './rig/pki.ts';
import { nowSeconds, providerHost, rsaKey, sign } from './rig/provider.ts';
import { createReport } from './rig/report.ts';
import { type Kind, makeStoreRig } from './rig/stores.ts';
import { behaviorKinds as kinds } from '../support/test-profile.ts';
import { parseRecord, settleLog } from './rig/util.ts';

const pki = await childPki(import.meta.url);
const report = createReport(
  'a policy callback, the JWT map, the OIDC mapper and the handoff verify that throw, reject, answer malformed or answer late never admit; each failed request gets the contracted fixed answer, exactly one auth.callback.failed record, and none of the callback text',
);
const CANARY = 'CANARY-CALLBACK-TEXT-7f3a';
const host = await providerHost(pki.good);
const k1 = rsaKey('k1');
const ORIGIN = 'http://localhost:3999';

type Hook = () => unknown | Promise<unknown>;
const hooks: Record<'load' | 'of' | 'member' | 'action' | 'map', Hook> = {
  load: () => ({ id: 1 }),
  of: () => 'tenant-1',
  member: () => true,
  action: () => true,
  map: () => ({ kind: 'accept', userId: 'u-1' }),
};
const healthy: typeof hooks = { ...hooks };
let handled = 0;

const answer = t.object({ ok: t.boolean() });
const contract = defineContract({
  policy: { method: 'GET', path: '/policy', access: { policy: 'faults', action: 'go' }, responses: { 200: answer } },
  token: { method: 'GET', path: '/token', access: { policy: 'jwtfaults', action: 'go' }, responses: { 200: answer } },
});
const policies = [
  definePolicy('faults', {
    credentials: ['api_key'],
    load: () => hooks.load() as never,
    tenant: { of: () => hooks.of() as never, member: () => hooks.member() as never },
    actions: { go: () => hooks.action() as never },
  }),
  definePolicy('jwtfaults', { credentials: ['jwt'], actions: { go: () => true } }),
] as const;

interface Reply {
  readonly status: number;
  readonly code: string;
  readonly text: string;
}

async function call(base: string, path: string, headers: Record<string, string>): Promise<Reply> {
  const res = await fetch(`${base}${path}`, { headers });
  const text = await res.text();
  return { status: res.status, code: String(parseRecord(text)?.code), text };
}

function jwtFor(): string {
  return sign(
    { alg: 'RS256', kid: 'k1' },
    { iss: 'https://faults.test', aud: 'api', sub: 'alice', exp: nowSeconds() + 300 },
    k1,
  );
}

function pairs(records: readonly LogLine[]): string[] {
  return records.map(
    (record) => `${String(record.fields?.['auth.callback'])}:${String(record.fields?.['auth.cause'])}`,
  );
}

type Fault = readonly [name: string, hook: keyof typeof hooks, answer: Hook, expect: string];

const thrower = (): never => {
  throw new Error(CANARY);
};
const rejecter: Hook = () => Promise.reject(new Error(CANARY));
// Does:  Makes callbacks that answer only when the test releases them, after the request was refused.
function holder(): { held: (value: unknown) => Hook; called: () => Promise<void>; release: () => void } {
  const answers: (() => void)[] = [];
  let next = Promise.withResolvers<void>();
  return {
    held: (value) => () =>
      new Promise((resolve) => {
        answers.push(() => resolve(value));
        next.resolve();
      }),
    called: async () => {
      await next.promise;
      next = Promise.withResolvers<void>();
    },
    release: () => {
      for (const answerNow of answers.splice(0)) {
        answerNow();
      }
    },
  };
}

const policyFaults: readonly Fault[] = [
  ['load throws', 'load', thrower, 'policy.load:threw'],
  ['load rejects', 'load', rejecter, 'policy.load:threw'],
  ['tenant.of throws', 'of', thrower, 'policy.tenant:threw'],
  ['tenant.of answers a non-string', 'of', () => 42, 'policy.tenant:malformed'],
  ['tenant.of answers an empty name', 'of', () => '', 'policy.tenant:malformed'],
  ['tenant.of answers undefined', 'of', () => undefined, 'policy.tenant:malformed'],
  ['tenant.member answers undefined', 'member', () => undefined, 'policy.tenant:malformed'],
  ['tenant.member rejects', 'member', rejecter, 'policy.tenant:threw'],
  ['tenant.member answers a non-boolean', 'member', () => 'yes', 'policy.tenant:malformed'],
  ['action throws', 'action', thrower, 'policy.action:threw'],
  ['action rejects', 'action', rejecter, 'policy.action:threw'],
  ['action answers a truthy non-boolean', 'action', () => 1, 'policy.action:malformed'],
  ['action answers undefined (abstains)', 'action', () => undefined, 'policy.action:malformed'],
];
const mapFaults: readonly Fault[] = [
  ['map throws', 'map', thrower, 'jwt.map:threw'],
  ['map rejects', 'map', rejecter, 'jwt.map:threw'],
  ['map answers a user id that is not text', 'map', () => ({ kind: 'accept', userId: 42 }), 'jwt.map:malformed'],
  ['map answers an unknown kind', 'map', () => ({ kind: 'admit' }), 'jwt.map:malformed'],
  ['map answers undefined', 'map', () => undefined, 'jwt.map:malformed'],
  ['map answers an object with no kind', 'map', () => ({ userId: 'u-1' }), 'jwt.map:malformed'],
  ['map accepts with an undefined user id', 'map', () => ({ kind: 'accept', userId: undefined }), 'jwt.map:malformed'],
  ['map answers null', 'map', () => null, 'jwt.map:malformed'],
];

function cleanErrorText(text: string): boolean {
  return !text.includes(CANARY) && !text.includes('stack');
}

report.check(
  'the disclosure check refuses a planted stack trace and callback text',
  !cleanErrorText(JSON.stringify({ stack: 'private trace' })) && !cleanErrorText(CANARY),
  'both poisoned controls refused',
);

async function gateSection(kind: Kind): Promise<void> {
  const tag = `[${kind}]`;
  handled = 0;
  const rig = await makeStoreRig(kind);
  const records: LogLine[] = [];
  const lines: string[] = [];
  const keys = apiKeys();
  const part = jwt({
    issuer: 'https://faults.test',
    audience: 'api',
    algorithms: ['RS256'],
    keys: [k1.jwk],
    map: () => hooks.map() as never,
  });
  const auth = createAuth({ store: rig.open(), origin: ORIGIN, policies, apiKeys: keys, jwt: part });
  const server = createServer({
    gate: auth.gate,
    publicOrigin: ORIGIN,
    csrf: { mode: 'strict' },
    log: {
      thresholds: { security: 'info' },
      sink: (batch: readonly string[]) => {
        for (const line of batch) {
          lines.push(line);
          records.push(JSON.parse(line));
        }
      },
    },
  });
  server.routes(contract, {
    policy: () => {
      handled++;
      return { status: 200, body: { ok: true } };
    },
    token: () => {
      handled++;
      return { status: 200, body: { ok: true } };
    },
  });
  const { port } = await server.listen({ port: 0 });
  const base = `http://127.0.0.1:${port}`;
  try {
    const issued = await keys.issue({ userId: 'owner', name: 'k', scopes: ['faults:go', 'jwtfaults:go'] });
    if (issued.kind !== 'issued') {
      report.check(`${tag} an API key was issued for the proof`, false, issued.kind);
      return;
    }
    const key = { authorization: `Bearer ${expose(issued.key)}` };
    const token = { authorization: `Bearer ${jwtFor()}` };
    const control = await call(base, '/policy', key);
    const controlToken = await call(base, '/token', token);
    report.check(
      `${tag} control: with healthy callbacks both routes admit and reach their handler`,
      control.status === 200 && controlToken.status === 200 && handled === 2,
      `${control.status}, ${controlToken.status}; handled ${handled}`,
    );
    for (const [section, faults, path, headers] of [
      ['policy', policyFaults, '/policy', key],
      ['jwt map', mapFaults, '/token', token],
    ] as const) {
      for (const [name, hook, answerOf, expect] of faults) {
        Object.assign(hooks, healthy);
        hooks[hook] = answerOf;
        const before = records.filter((record) => record.event_name === 'auth.callback.failed').length;
        const handledBefore = handled;
        const reply = await call(base, path, headers);
        Object.assign(hooks, healthy);
        await settleLog(lines);
        const written = pairs(records.filter((record) => record.event_name === 'auth.callback.failed').slice(before));
        const clean = cleanErrorText(reply.text);
        report.check(
          `${tag} ${section}: ${name} gives 500 INTERNAL, no handler, one auth.callback.failed ${expect}, no callback text in the response`,
          reply.status === 500 &&
            reply.code === 'INTERNAL' &&
            handled === handledBefore &&
            written.length === 1 &&
            written[0] === expect &&
            clean,
          `${reply.status} ${reply.code}; handler runs +${handled - handledBefore}; records ${written.join(', ') || 'none'}`,
        );
      }
    }
    const lateFaults: [string, keyof typeof hooks, string, Record<string, string>, number, string, string][] = [
      ['policy load late (past 5,000 ms)', 'load', '/policy', key, 503, 'AUTH_UNAVAILABLE', 'policy.load:deadline'],
      [
        'policy action late (past 5,000 ms)',
        'action',
        '/policy',
        key,
        503,
        'AUTH_UNAVAILABLE',
        'policy.action:deadline',
      ],
      ['map late (past 5,000 ms)', 'map', '/token', token, 500, 'INTERNAL', 'jwt.map:deadline'],
    ];
    Object.assign(hooks, healthy);
    const lateBefore = records.filter((record) => record.event_name === 'auth.callback.failed').length;
    const handledBeforeLate = handled;
    // Why: The three deadlines run at once; each request is sent only after the one before reached its held callback.
    const late = holder();
    const pending: Promise<{ answer: Reply; took: number }>[] = [];
    for (const [, hook, route, sent] of lateFaults) {
      hooks[hook] = late.held(
        hook === 'map' ? { kind: 'accept', userId: 'u-late' } : hook === 'load' ? { id: 1 } : true,
      );
      const started = Date.now();
      pending.push(call(base, route, sent).then((got) => ({ answer: got, took: Date.now() - started })));
      await late.called();
      hooks[hook] = healthy[hook];
    }
    const replies = await Promise.all(pending);
    late.release();
    await settleLog(lines);
    const written = pairs(records.filter((record) => record.event_name === 'auth.callback.failed').slice(lateBefore));
    lateFaults.forEach(([name, , , , status, code, expect], index) => {
      const seen = replies[index];
      report.check(
        `${tag} ${name} is answered ${status} ${code} at the deadline, never admitted, one record ${expect}`,
        seen !== undefined &&
          seen.answer.status === status &&
          seen.answer.code === code &&
          !seen.answer.text.includes(CANARY) &&
          written.filter((pair) => pair === expect).length === 1 &&
          seen.took >= 4900 &&
          seen.took < 6400,
        `${seen?.answer.status} ${seen?.answer.code} after ${seen?.took} ms; records ${written.join(', ') || 'none'}`,
      );
    });
    report.check(
      `${tag} the late answers, released after the refusals, admit nothing and write nothing more`,
      handled === handledBeforeLate && written.length === lateFaults.length,
      `handler runs +${handled - handledBeforeLate}; records ${written.length}`,
    );
    for (const [name, answerOf] of [
      ['null', () => null],
      ['undefined', () => undefined],
    ] as const) {
      Object.assign(hooks, healthy);
      hooks.load = answerOf;
      const missingBefore = records.filter((record) => record.event_name === 'skeld.refuse.resource_missing').length;
      const failedBefore = records.filter((record) => record.event_name === 'auth.callback.failed').length;
      const handledBefore = handled;
      const reply = await call(base, '/policy', key);
      Object.assign(hooks, healthy);
      await settleLog(lines);
      const missing = records
        .filter((record) => record.event_name === 'skeld.refuse.resource_missing')
        .slice(missingBefore);
      report.check(
        `${tag} policy: a load answering ${name} is the contracted 404 NOT_FOUND "Not found", no handler, no auth.callback.failed and exactly one skeld.refuse.resource_missing record`,
        reply.status === 404 &&
          reply.code === 'NOT_FOUND' &&
          reply.text === '{"status":404,"code":"NOT_FOUND","message":"Not found"}' &&
          handled === handledBefore &&
          missing.length === 1 &&
          records.filter((record) => record.event_name === 'auth.callback.failed').length === failedBefore,
        `${reply.status} ${reply.code}; handler runs +${handled - handledBefore}; resource_missing records ${missing.length}`,
      );
    }
    await settleLog(lines);
    const total = records.filter((record) => record.event_name === 'auth.callback.failed').length;
    report.check(
      `${tag} the whole run wrote exactly one auth.callback.failed per failed request (${policyFaults.length + mapFaults.length + lateFaults.length}) and none of the callback text appears in any log record`,
      total === policyFaults.length + mapFaults.length + lateFaults.length &&
        !lines.some((line) => line.includes(CANARY)),
      `${total} records over ${lines.length} lines`,
    );
    const after = await call(base, '/policy', key);
    report.check(`${tag} after the faults the healthy callbacks admit again`, after.status === 200, `${after.status}`);
  } finally {
    await server.close();
    await rig.dispose();
  }
}

async function handoffSection(kind: Kind): Promise<void> {
  const tag = `[${kind}]`;
  const rig = await makeStoreRig(kind);
  const records: LogLine[] = [];
  const lines: string[] = [];
  const auth = createAuth({ store: rig.open(), origin: ORIGIN });
  const server = createServer({
    gate: auth.gate,
    publicOrigin: ORIGIN,
    csrf: { mode: 'strict' },
    log: {
      thresholds: { security: 'info' },
      sink: (batch: readonly string[]) => {
        for (const line of batch) {
          lines.push(line);
          records.push(JSON.parse(line));
        }
      },
    },
  });
  server.routes(defineContract({}), {});
  await server.listen({ port: 0 });
  try {
    const cookies = { get: () => undefined, getAll: () => [] };
    const cases: [string, (signal: AbortSignal) => boolean | Promise<boolean>, string][] = [
      ['throws', () => thrower(), 'threw'],
      ['rejects', () => Promise.reject(new Error(CANARY)), 'threw'],
      ['answers a non-boolean', () => 'true' as never, 'malformed'],
      ['answers undefined', () => undefined as never, 'malformed'],
    ];
    for (const [name, verify, cause] of cases) {
      const before = records.filter((record) => record.event_name === 'auth.callback.failed').length;
      const result = await auth.sessions.establish({ rawCookies: cookies, userId: 'faulty', verify });
      await settleLog(lines);
      const written = records.filter((record) => record.event_name === 'auth.callback.failed').slice(before);
      const failed = records.filter((record) => record.event_name === 'auth.signin.failed').length;
      report.check(
        `${tag} a verify that ${name} is refused callback with no session, no cookie and one auth.callback.failed handoff.verify:${cause}`,
        result.kind === 'refused' &&
          result.reason === 'callback' &&
          !('cookies' in result) &&
          written.length === 1 &&
          pairs(written)[0] === `handoff.verify:${cause}` &&
          failed >= 1 &&
          (await rig.count('sessions')) === 0,
        `${result.kind}${result.kind === 'refused' ? `/${result.reason}` : ''}; records ${pairs(written).join(', ')}; sessions ${await rig.count('sessions')}`,
      );
    }
    const unavailableBefore = records.length;
    const busy = await auth.sessions.establish({ rawCookies: cookies, userId: 'busy', verify: () => 'unavailable' });
    await settleLog(lines);
    const unavailableRecords = records
      .slice(unavailableBefore)
      .filter((record) => String(record.event_name).startsWith('auth.'));
    report.check(
      `${tag} a verify that answers 'unavailable' is Unavailable not_applied, no session, one auth.signin.failed (reason unavailable) and no auth.callback.failed`,
      busy.kind === 'unavailable' &&
        busy.outcome === 'not_applied' &&
        unavailableRecords.length === 1 &&
        unavailableRecords[0]?.event_name === 'auth.signin.failed' &&
        unavailableRecords[0]?.fields?.['auth.reason'] === 'unavailable' &&
        (await rig.count('sessions')) === 0,
      `${busy.kind}${busy.kind === 'unavailable' ? `/${busy.outcome}` : ''}; records ${unavailableRecords.map((record) => `${record.event_name} ${JSON.stringify(record.fields)}`).join(' | ')}`,
    );
  } finally {
    await server.close();
    await rig.dispose();
  }
}

async function oidcSection(kind: Kind): Promise<void> {
  const tag = `[${kind}]`;
  const rig = await makeStoreRig(kind);
  const provider = host.add(`f-${kind}`, 'client-f', 'secret-f');
  let mapper: Hook = () => ({ kind: 'user', userId: 'u-1' });
  const app = await bootOidc({
    store: rig.open(),
    entries: [{ provider, name: 'a' }],
    resolveUser: () => mapper() as never,
    addressLimit: { max: 100_000, windowSeconds: 60 },
  });
  const login = async (): Promise<{ hop: string; session: boolean; body: string }> => {
    const browser = app.browser();
    const trip = await begin(browser, { provider, name: 'a' });
    const hop = await browser.callback('a', { code: trip.code, state: trip.state });
    return { hop: location(hop), session: browser.jar.has(COOKIE), body: hop.text + hop.setCookie.join(';') };
  };
  try {
    const faults: [string, Hook, string][] = [
      ['throws', thrower, 'threw'],
      ['rejects', rejecter, 'threw'],
      ['answers a user id that is not text', () => ({ kind: 'user', userId: 42 }), 'malformed'],
      ['answers null', () => null, 'malformed'],
      ['answers undefined', () => undefined, 'malformed'],
      ['answers a user whose user id is undefined', () => ({ kind: 'user', userId: undefined }), 'malformed'],
    ];
    for (const [name, hook, cause] of faults) {
      mapper = hook;
      const before = app.events('auth.callback.failed').length;
      const signinBefore = app.events('auth.signin.failed').length;
      const seen = await login();
      mapper = () => ({ kind: 'user', userId: 'u-1' });
      await app.settle();
      const written = pairs(app.events('auth.callback.failed').slice(before));
      const refusals = app.events('auth.signin.failed').slice(signinBefore);
      const pinned =
        cause !== 'malformed' ||
        (refusals.length === 1 &&
          refusals[0]?.fields?.['auth.reason'] === 'mapping_failed' &&
          !('auth.user' in (refusals[0]?.fields ?? {})));
      report.check(
        `${tag} an OIDC mapper that ${name} is mapping_failed, no session, one auth.callback.failed oidc.resolve:${cause}${cause === 'malformed' ? ', and one auth.signin.failed reason mapping_failed without auth.user' : ''}`,
        seen.hop === '/login?provider=a&error=mapping_failed' &&
          !seen.session &&
          written.join() === `oidc.resolve:${cause}` &&
          !seen.body.includes(CANARY) &&
          pinned,
        `${seen.hop}; records ${written.join(', ')}; sign-in refusals ${refusals.map((record) => JSON.stringify(record.fields)).join(' ')}`,
      );
    }
    for (const [name, second] of [
      ['undefined', () => undefined],
      ['a user whose user id is undefined', () => ({ kind: 'user', userId: undefined })],
    ] as const) {
      let calls = 0;
      mapper = () => (++calls === 1 ? { kind: 'user', userId: 'u-1' } : second());
      const failedBefore = app.events('auth.callback.failed').length;
      const signinBefore = app.events('auth.signin.failed').length;
      const seen = await login();
      mapper = () => ({ kind: 'user', userId: 'u-1' });
      await app.settle();
      const written = pairs(app.events('auth.callback.failed').slice(failedBefore));
      const refusals = app.events('auth.signin.failed').slice(signinBefore);
      report.check(
        `${tag} an OIDC mapper whose second call (inside the handoff) answers ${name} is mapping_failed, no session, one auth.callback.failed oidc.resolve:malformed and one auth.signin.failed reason rejected with auth.user`,
        calls === 2 &&
          seen.hop === '/login?provider=a&error=mapping_failed' &&
          !seen.session &&
          written.join() === 'oidc.resolve:malformed' &&
          refusals.length === 1 &&
          refusals[0]?.fields?.['auth.reason'] === 'rejected' &&
          typeof refusals[0]?.fields?.['auth.user'] === 'string' &&
          (await rig.count('sessions')) === 0,
        `${seen.hop}; ${calls} calls; callback records ${written.join(', ')}; sign-in refusals ${refusals.map((record) => JSON.stringify(record.fields)).join(' ')}`,
      );
    }
    const late = holder();
    mapper = late.held({ kind: 'user', userId: 'u-1' });
    const before = app.events('auth.callback.failed').length;
    const seen = await login();
    mapper = () => ({ kind: 'user', userId: 'u-1' });
    late.release();
    await app.settle();
    const written = pairs(app.events('auth.callback.failed').slice(before));
    report.check(
      `${tag} an OIDC mapper that answers after 5,000 ms is mapping_failed, no session, one record oidc.resolve:deadline`,
      seen.hop === '/login?provider=a&error=mapping_failed' &&
        !seen.session &&
        written.join() === 'oidc.resolve:deadline',
      `${seen.hop}; records ${written.join(', ')}`,
    );
    report.check(
      `${tag} no mapper text is in any OIDC record`,
      !app.lines.some((line) => line.includes(CANARY)),
      `${app.lines.length} records`,
    );
  } finally {
    await app.close();
    await rig.dispose();
  }
}

async function verifierSection(kind: Kind): Promise<void> {
  const tag = `[${kind}]`;
  const rig = await makeStoreRig(kind);
  const records: LogLine[] = [];
  const lines: string[] = [];
  let answerOf: () => unknown = () => undefined;
  let ran = 0;
  const part = { kind: 'api_key', attach: () => ({ verify: () => Promise.resolve(answerOf()) }) } as never;
  const policy = definePolicy('verified', { credentials: ['api_key'], actions: { go: () => true } });
  const auth = createAuth({ store: rig.open(), origin: ORIGIN, policies: [policy], apiKeys: part });
  const server = createServer({
    gate: auth.gate,
    publicOrigin: ORIGIN,
    csrf: { mode: 'strict' },
    log: {
      thresholds: { security: 'info' },
      sink: (batch: readonly string[]) => {
        for (const line of batch) {
          lines.push(line);
          records.push(JSON.parse(line));
        }
      },
    },
  });
  server.routes(
    defineContract({
      v: { method: 'GET', path: '/v', access: { policy: 'verified', action: 'go' }, responses: { 200: answer } },
    }),
    {
      v: () => {
        ran++;
        return { status: 200, body: { ok: true } };
      },
    },
  );
  const { port } = await server.listen({ port: 0 });
  const base = `http://127.0.0.1:${port}`;
  const bearer = { authorization: `Bearer skeld1.${'A'.repeat(16)}.${'A'.repeat(43)}` };
  const principal = { kind: 'api_key', userId: 'u', keyId: 'K'.repeat(16), scopes: ['verified:go'] };
  try {
    answerOf = () => ({ kind: 'verified', principal });
    const control = await call(base, '/v', bearer);
    report.check(
      `${tag} control: a verifier answering verified with its principal admits and reaches the handler`,
      control.status === 200 && ran === 1,
      `${control.status}; handler runs ${ran}`,
    );
    const cases: [string, () => unknown][] = [
      ['undefined', () => undefined],
      ['verified with no principal', () => ({ kind: 'verified' })],
      ['verified with an undefined principal', () => ({ kind: 'verified', principal: undefined })],
      ['verified with a null principal', () => ({ kind: 'verified', principal: null })],
      ['an object with no kind', () => ({ principal })],
      ['an unknown kind that carries a principal', () => ({ kind: 'maybe', principal })],
      ['kind undefined that carries a principal', () => ({ kind: undefined, principal })],
      [
        "verified with a principal whose kind is not the verifier's own (a jwt principal from the api_key verifier)",
        () => ({
          kind: 'verified',
          principal: { kind: 'jwt', issuer: 'https://i', subject: 's', userId: null, claims: {} },
        }),
      ],
      ['null', () => null],
    ];
    for (const [name, make] of cases) {
      answerOf = make;
      const ranBefore = ran;
      const errorsBefore = records.filter((record) => record.event_name === 'skeld.request.error').length;
      const authBefore = records.filter((record) => String(record.event_name).startsWith('auth.')).length;
      const reply = await call(base, '/v', bearer);
      await settleLog(lines);
      const authAfter = records.filter((record) => String(record.event_name).startsWith('auth.')).length;
      const written = records.filter((record) => record.event_name === 'skeld.request.error').slice(errorsBefore);
      report.check(
        `${tag} a verifier answering ${name} admits nothing: the fixed 500 INTERNAL, no handler, no principal, exactly one skeld.request.error (reason gate), no auth.* record and no verifier text`,
        reply.status === 500 &&
          reply.code === 'INTERNAL' &&
          ran === ranBefore &&
          written.length === 1 &&
          written[0]?.['skeld.reason'] === 'gate' &&
          authAfter === authBefore,
        `${reply.status} ${reply.code}; handler runs +${ran - ranBefore}; request.error records ${written.map((record) => String(record['skeld.reason'])).join(', ') || 'none'}; auth.* records +${authAfter - authBefore}`,
      );
    }
    answerOf = () => ({ kind: 'invalid' });
    const invalid = await call(base, '/v', bearer);
    report.check(
      `${tag} control: a verifier answering invalid is 401 CREDENTIAL_INVALID`,
      invalid.status === 401 && invalid.code === 'CREDENTIAL_INVALID',
      `${invalid.status} ${invalid.code}`,
    );
    report.check(
      `${tag} no session row was written by any of them`,
      (await rig.count('sessions')) === 0,
      `${await rig.count('sessions')}`,
    );
  } finally {
    await server.close();
    await rig.dispose();
  }
}

async function symbolSection(kind: Kind): Promise<void> {
  const tag = `[${kind}]`;
  const rig = await makeStoreRig(kind);
  const sym = Symbol('go');
  const policy = definePolicy('symbolic', { credentials: ['session'], actions: { [sym]: () => true } as never });
  const auth = createAuth({ store: rig.open(), origin: ORIGIN, policies: [policy] });
  const server = createServer({ gate: auth.gate, publicOrigin: ORIGIN, log: false });
  server.routes(defineContract({ p: { method: 'GET', path: '/p', access: 'public', responses: { 200: answer } } }), {
    p: () => ({ status: 200, body: { ok: true } }),
  });
  try {
    const outcome = await server.listen({ port: 0 }).then(
      async () => {
        await server.close();
        return 'listened';
      },
      (error: unknown) => (error instanceof Error ? `${Reflect.get(error, 'code')}: ${error.message}` : String(error)),
    );
    report.check(
      `${tag} a policy action keyed by a symbol is refused at boot: GATE_FAILED naming the policies`,
      outcome.startsWith('GATE_FAILED: gate failed: policies: policies[0]'),
      outcome,
    );
  } finally {
    await rig.dispose();
  }
}

for (const kind of kinds) {
  // Why: Each section has its own store, server and log sink, so their 5,000 ms deadlines overlap instead of adding up.
  await Promise.all([
    report.run(`${kind} verifier answers`, () => verifierSection(kind)),
    report.run(`${kind} symbol-keyed action`, () => symbolSection(kind)),
    report.run(`${kind} gate callbacks`, () => gateSection(kind)),
    report.run(`${kind} handoff verify`, () => handoffSection(kind)),
    report.run(`${kind} OIDC mapper`, () => oidcSection(kind)),
  ]);
}

await host.close();
pki.dispose();
report.finish();
