// Does:  Proves each of the ten security events is written exactly when its row says, by its writer, with its fields only.
// Holds: One trigger writes one record per row; a record has the fields its row names, no others, and no other auth event exists.
// biome-ignore-all lint/performance/noAwaitInLoops: each scenario must finish and settle before the next is judged
// biome-ignore-all lint/complexity/noExcessiveCognitiveComplexity: the run is a straight line of independent scenarios
// biome-ignore-all lint/nursery/noUnsafeTypeAssertion: hostile callbacks and a failing store answer shapes the types forbid
// biome-ignore-all lint/security/noSecrets: event and field names are fixtures, not secrets

import { apiKeys } from '@skeld/auth/api-key';
import { jwt } from '@skeld/auth/jwt';
import { oidc } from '@skeld/auth/oidc';
import { definePolicy } from '@skeld/auth/policy';
import { oidcRoutes, sessionRoutes } from '@skeld/auth/routes';
import { createAuth } from '@skeld/auth/server';
import { type AuthStore, StoreFailure } from '@skeld/auth/store';
import { defineContract } from '@skeld/core/contract';
import * as t from '@skeld/core/schema';
import { expose, Secret } from '@skeld/core/secret';
import { createServer } from '@skeld/core/server';
import type { LogLine } from './rig/app.ts';
import { childPki } from './rig/pki.ts';
import { type Provider, providerHost } from './rig/provider.ts';
import { createReport } from './rig/report.ts';
import { type Kind, makeStoreRig } from './rig/stores.ts';
import { behaviorKinds as kinds } from '../support/test-profile.ts';
import { settleLog, sleep } from './rig/util.ts';

const pki = await childPki(import.meta.url);
const report = createReport(
  'v06',
  'security-events',
  'each of the ten security events is written exactly when its row says, by the writer its row names, with the fields it names and no others; no other auth event exists',
);
const ORIGIN = 'http://localhost:3999';
const host = await providerHost(pki.good);
// Does:  Makes one run's providers afresh: the key and document caches are per URL and last 60 s after a failure.
function setup(kind: string) {
  const named = (name: string): Provider => host.add(`${name}${kind}`, `client-${name}`, `secret-${name}`);
  const pa = named('a');
  const refusals: [string, Record<string, unknown>][] = [['issuer', { issuer: 'https://other.example.test' }]];
  const refusing = refusals.map(([reason, doc]) => {
    const provider = named(`r${reason.replace('_', '')}`);
    provider.docOverride = doc;
    return { reason, provider };
  });
  const kFetch = named('kfetch');
  kFetch.jwks = ({ json }) => json(500, { error: 'down' });
  const pj = named('j');
  pj.cacheControl = 'no-store';
  pj.jwks = ({ json }) => json(200, { keys: [pj.key.jwk] });

  return { pa, refusing, kFetch, pj };
}

interface Want {
  readonly event: string;
  readonly severity: string;
  readonly fields: Record<string, string | RegExp>;
}
const want = (event: string, severity: string, fields: Record<string, string | RegExp>): Want => ({
  event,
  severity,
  fields,
});
const allowed: Record<string, readonly string[]> = {
  'auth.signin.succeeded': ['auth.user', 'auth.via', 'auth.provider'],
  'auth.signin.failed': ['auth.user', 'auth.via', 'auth.provider', 'auth.reason'],
  'auth.limit.refused': ['auth.limit'],
  'auth.session.revoked': ['auth.user', 'auth.cause'],
  'auth.credential.changed': ['auth.user', 'auth.credential', 'auth.change', 'auth.key'],
  'auth.subject.changed': ['auth.user', 'auth.change'],
  'auth.callback.failed': ['auth.callback', 'auth.cause'],
  'auth.oidc.provider_refused': ['auth.provider', 'auth.reason'],
  'auth.keys.unavailable': ['auth.source', 'auth.reason'],
  'auth.store.failed': ['auth.operation', 'auth.cause', 'auth.code'],
};
const severities: Record<string, string> = {
  'auth.signin.succeeded': 'info',
  'auth.signin.failed': 'warn',
  'auth.limit.refused': 'warn',
  'auth.session.revoked': 'info',
  'auth.credential.changed': 'info',
  'auth.subject.changed': 'warn',
  'auth.callback.failed': 'error',
  'auth.oidc.provider_refused': 'error',
  'auth.keys.unavailable': 'error',
  'auth.store.failed': 'error',
};

function matches(record: LogLine, expected: Want): boolean {
  const fields = record.fields ?? {};
  const keys = Object.keys(fields).filter((key) => key.startsWith('auth.'));
  const wantKeys = Object.keys(expected.fields);
  if (
    record.event_name !== expected.event ||
    record.severity_text !== expected.severity ||
    keys.length !== wantKeys.length
  ) {
    return false;
  }
  return wantKeys.every((key) => {
    const wanted = expected.fields[key];
    const got = fields[key];
    return typeof got === 'string' && (wanted instanceof RegExp ? wanted.test(got) : wanted === got);
  });
}

function flaky(store: AuthStore, plan: Map<string, StoreFailure>): AuthStore {
  const entries = Object.entries(store.ops).map(([name, original]) => [
    name,
    (...args: unknown[]) => {
      const failure = plan.get(name);
      return failure === undefined ? Reflect.apply(original, store.ops, args) : Promise.reject(failure);
    },
  ]);
  const ops = Object.freeze(Object.fromEntries(entries)) as unknown as AuthStore['ops'];
  return { install: () => store.install(), attach: (config) => store.attach(config), close: () => store.close(), ops };
}

const contract = defineContract({
  guarded: {
    method: 'GET',
    path: '/guarded',
    access: { policy: 'guard', action: 'go' },
    responses: { 200: t.object({ ok: t.boolean() }) },
  },
  limited: {
    method: 'GET',
    path: '/limited',
    access: { policy: 'capped', action: 'go' },
    responses: { 200: t.object({ ok: t.boolean() }) },
  },
  charged: {
    method: 'GET',
    path: '/charged',
    access: 'public',
    responses: { 200: t.object({ kind: t.string({ maxLength: 16 }) }) },
  },
});
const thrower = (): never => {
  throw new Error('callback text');
};

async function run(kind: Kind): Promise<void> {
  const tag = `[${kind}]`;
  const { pa, refusing, kFetch, pj } = setup(kind);
  const rig = await makeStoreRig(kind);
  const plan = new Map<string, StoreFailure>();
  const lines: string[] = [];
  const records: LogLine[] = [];
  const seenNames = new Set<string>();
  const hooks = {
    load: (): unknown => ({ id: 1 }),
    tenant: (): unknown => 't',
    member: (): unknown => true,
    action: (): unknown => true,
    map: (): unknown => ({ kind: 'accept', userId: 'jwt-user' }),
  };
  const resolver: (identity: { subject: string }, call: number) => unknown = (identity) => ({
    kind: 'user',
    userId: `u-${identity.subject}`,
  });
  let calls = 0;
  const keys = apiKeys();
  const providerList: [string, Provider][] = [
    ['a', pa],
    ['kfetch', kFetch],
    ...refusing.map((item): [string, Provider] => [`r${item.reason.replace('_', '')}`, item.provider]),
  ];
  const part = oidc({
    providers: Object.fromEntries(
      providerList.map(([name, provider]) => [
        name,
        { issuer: provider.issuer, clientId: provider.clientId, clientSecret: new Secret(provider.clientSecret) },
      ]),
    ),
    failurePath: '/login',
    returnPath: '/home',
    resolveUser: (identity) => {
      calls++;
      return resolver(identity, calls) as never;
    },
  });
  const auth = createAuth({
    store: flaky(rig.open(), plan),
    origin: ORIGIN,
    session: { idleSeconds: 2, absoluteSeconds: 120, renewSeconds: 1 },
    policies: [
      definePolicy('guard', {
        credentials: ['session', 'api_key', 'jwt'],
        load: () => hooks.load() as never,
        tenant: { of: () => hooks.tenant() as never, member: () => hooks.member() as never },
        actions: { go: () => hooks.action() as never },
      }),
      definePolicy('capped', {
        credentials: ['session', 'api_key'],
        limit: { max: 1, windowSeconds: 60 },
        actions: { go: () => true },
      }),
    ],
    limits: { charge: { max: 1, windowSeconds: 60 } },
    addressLimit: { max: 200, windowSeconds: 60 },
    apiKeys: keys,
    jwt: jwt({
      issuer: pj.issuer,
      audience: 'api',
      algorithms: ['RS256'],
      jwksUrl: `${pj.issuer}/jwks`,
      map: () => hooks.map() as never,
    }),
    oidc: part,
  });
  const server = createServer({
    gate: auth.gate,
    publicOrigin: ORIGIN,
    csrf: { mode: 'strict' },
    log: {
      thresholds: { security: 'debug' },
      sink: (batch: readonly string[]) => {
        for (const line of batch) {
          lines.push(line);
          const record: LogLine = JSON.parse(line);
          records.push(record);
          if (typeof record.event_name === 'string' && record.event_name.startsWith('auth.')) {
            seenNames.add(record.event_name);
          }
        }
      },
    },
  });
  server.routes(oidcRoutes, part.handlers, { csrf: { mode: 'strict' } });
  server.routes(sessionRoutes, auth.handlers.session, { csrf: { mode: 'strict' } });
  server.routes(contract, {
    guarded: () => ({ status: 200, body: { ok: true } }),
    limited: () => ({ status: 200, body: { ok: true } }),
    charged: async ({ clientAddress }) => ({
      status: 200,
      body: { kind: (await auth.limits.charge('charge', { clientAddress })).kind },
    }),
  });
  const { port } = await server.listen({ port: 0 });
  const base = `http://127.0.0.1:${port}`;
  const jar = new Map<string, string>();
  const cookie = (): string => [...jar].map(([name, value]) => `${name}=${value}`).join('; ');
  const hit = async (
    path: string,
    init: { method?: string; headers?: Record<string, string> } = {},
  ): Promise<{ status: number; text: string; location: string | null }> => {
    const res = await fetch(`${base}${path}`, {
      method: init.method ?? 'GET',
      redirect: 'manual',
      headers: {
        cookie: cookie(),
        ...(init.method === 'POST' ? { origin: ORIGIN, 'content-type': 'application/json' } : {}),
        ...init.headers,
      },
      ...(init.method === 'POST' ? { body: '{}' } : {}),
    });
    for (const line of res.headers.getSetCookie()) {
      const pair = line.split(';')[0] ?? '';
      const eq = pair.indexOf('=');
      if (/max-age=0/i.test(line)) {
        jar.delete(pair.slice(0, eq));
      } else {
        jar.set(pair.slice(0, eq), pair.slice(eq + 1));
      }
    }
    return { status: res.status, text: await res.text(), location: res.headers.get('location') };
  };
  const login = async (
    provider: Provider,
    name: string,
    subject = 'subject-1',
    extra: Record<string, string> = {},
  ): Promise<string> => {
    jar.clear();
    provider.subject = subject;
    calls = 0;
    const start = await hit(`/auth/oidc/${name}/start`, { method: 'POST' });
    const url = typeof JSON.parse(start.text).url === 'string' ? String(JSON.parse(start.text).url) : '';
    if (url === '') {
      return `start ${start.status}`;
    }
    const issued = provider.authorize(url);
    const query = new URLSearchParams({ code: issued.code, state: issued.state, ...extra });
    const done = await hit(`/auth/oidc/${name}/callback?${query.toString()}`);
    return done.location ?? `(${done.status})`;
  };
  const noCookies = { get: () => undefined, getAll: () => [] };

  // Does:  Runs one trigger, waits for the log to settle and requires exactly the wanted auth records.
  const scenario = async (name: string, trigger: () => Promise<unknown>, wanted: Want[]): Promise<void> => {
    await sleep(150);
    await settleLog(lines);
    const from = records.length;
    let seen = '';
    try {
      seen = String(await trigger());
    } catch (error) {
      seen = `threw ${error instanceof Error ? error.name : typeof error}`;
    }
    await sleep(120);
    await settleLog(lines);
    const got = records
      .slice(from)
      .filter((record) => typeof record.event_name === 'string' && record.event_name.startsWith('auth.'));
    const left = [...got];
    const missing: string[] = [];
    for (const expected of wanted) {
      const at = left.findIndex((record) => matches(record, expected));
      if (at === -1) {
        missing.push(expected.event);
      } else {
        left.splice(at, 1);
      }
    }
    const show = (record: LogLine): string =>
      `${record.event_name}[${record.severity_text}] ${JSON.stringify(Object.fromEntries(Object.entries(record.fields ?? {}).filter(([key]) => key.startsWith('auth.'))))}`;
    report.check(
      `${tag} ${name}`,
      missing.length === 0 && left.length === 0,
      `${seen}; wanted ${wanted.map((item) => item.event).join(', ') || 'no auth record'}; wrote ${got.map(show).join(' | ') || 'none'}${missing.length > 0 ? `; missing ${missing.join(', ')}` : ''}${left.length > 0 ? `; unexpected ${left.map(show).join(' | ')}` : ''}`,
    );
  };

  try {
    const via = (name: string, rest: Record<string, string | RegExp> = {}): Record<string, string | RegExp> => ({
      'auth.via': name,
      ...rest,
    });
    await scenario(
      'establish with a verify that answers true writes one auth.signin.succeeded (handoff)',
      () => auth.sessions.establish({ rawCookies: noCookies, userId: 'u1', verify: () => true }).then((r) => r.kind),
      [want('auth.signin.succeeded', 'info', { 'auth.user': 'u1', ...via('handoff') })],
    );
    await scenario(
      'a verify that answers false writes one auth.signin.failed, reason rejected',
      () => auth.sessions.establish({ rawCookies: noCookies, userId: 'u2', verify: () => false }).then((r) => r.kind),
      [want('auth.signin.failed', 'warn', { 'auth.user': 'u2', ...via('handoff', { 'auth.reason': 'rejected' }) })],
    );
    await scenario(
      'a verify that throws writes one auth.callback.failed (handoff.verify) and one auth.signin.failed, reason callback, both by establish',
      () => auth.sessions.establish({ rawCookies: noCookies, userId: 'u5', verify: thrower }).then((r) => r.kind),
      [
        want('auth.callback.failed', 'error', { 'auth.callback': 'handoff.verify', 'auth.cause': 'threw' }),
        want('auth.signin.failed', 'warn', { 'auth.user': 'u5', ...via('handoff', { 'auth.reason': 'callback' }) }),
      ],
    );
    plan.set('subjectEnsure', new StoreFailure('subjectEnsure', 'unavailable', 'no', '57P03'));
    await scenario(
      'a store that is unavailable at the handoff writes auth.store.failed (cause unavailable, with its code) and auth.signin.failed, reason unavailable',
      () => auth.sessions.establish({ rawCookies: noCookies, userId: 'u6', verify: () => true }).then((r) => r.kind),
      [
        want('auth.store.failed', 'error', {
          'auth.operation': 'subjectEnsure',
          'auth.cause': 'unavailable',
          'auth.code': '57P03',
        }),
        want('auth.signin.failed', 'warn', { 'auth.user': 'u6', ...via('handoff', { 'auth.reason': 'unavailable' }) }),
      ],
    );
    plan.delete('subjectEnsure');

    await auth.sessions.establish({ rawCookies: noCookies, userId: 'u9', verify: () => true });
    await scenario(
      'revokeSessions writes one auth.session.revoked, cause revoke_all, and no auth.subject.changed',
      () => auth.subjects.revokeSessions('u9').then((r) => r.kind),
      [want('auth.session.revoked', 'info', { 'auth.user': 'u9', 'auth.cause': 'revoke_all' })],
    );
    await scenario(
      'disable writes auth.subject.changed (disabled) and auth.session.revoked (disable)',
      () => auth.subjects.disable('u9').then((r) => r.kind),
      [
        want('auth.subject.changed', 'warn', { 'auth.user': 'u9', 'auth.change': 'disabled' }),
        want('auth.session.revoked', 'info', { 'auth.user': 'u9', 'auth.cause': 'disable' }),
      ],
    );
    await scenario('issuing an API key writes one auth.credential.changed, change added, naming the user, api_key and the key id, and no secret', async () => {
      const made = await keys.issue({ userId: 'owner', name: 'k', scopes: ['guard:go', 'capped:go'] });
      return made.kind;
    }, [
      want('auth.credential.changed', 'info', {
        'auth.user': 'owner',
        'auth.credential': 'api_key',
        'auth.change': 'added',
        'auth.key': /^[A-Za-z0-9_-]{16}$/,
      }),
    ]);
    for (const { reason, provider } of refusing) {
      const name = `r${reason.replace('_', '')}`;
      await scenario(
        `a provider document refused for ${reason} writes one auth.oidc.provider_refused`,
        () => hit(`/auth/oidc/${name}/start`, { method: 'POST' }).then((r) => r.status),
        [want('auth.oidc.provider_refused', 'error', { 'auth.provider': name, 'auth.reason': reason })],
      );
      void provider;
    }

    await scenario(
      'a failing provider key set writes auth.keys.unavailable (source the provider, reason fetch) and one auth.signin.failed from the callback',
      () => login(kFetch, 'kfetch'),
      [
        want('auth.keys.unavailable', 'error', { 'auth.source': 'kfetch', 'auth.reason': 'fetch' }),
        want('auth.signin.failed', 'warn', {
          'auth.via': 'oidc',
          'auth.provider': 'kfetch',
          'auth.reason': 'provider_unavailable',
        }),
      ],
    );
    const capped = await keys.issue({ userId: 'owner4', name: 'k4', scopes: ['capped:go'] });
    const cappedHeader = capped.kind === 'issued' ? { authorization: `Bearer ${expose(capped.key)}` } : {};
    await hit('/limited', { headers: cappedHeader });
    await scenario(
      'a policy limit writes one auth.limit.refused naming its policy scope and no key',
      () => hit('/limited', { headers: cappedHeader }).then((r) => r.status),
      [want('auth.limit.refused', 'warn', { 'auth.limit': 'auth.policy.capped' })],
    );

    await settleLog(lines);
    const stray = [...seenNames].filter((name) => allowed[name] === undefined);
    report.check(
      `${tag} no auth.* event exists outside the ten of the table`,
      stray.length === 0,
      `names seen: ${[...seenNames].sort().join(', ')}`,
    );
    report.check(
      `${tag} all ten events were written at least once in this run`,
      Object.keys(allowed).every((name) => seenNames.has(name)),
      `missing: ${
        Object.keys(allowed)
          .filter((name) => !seenNames.has(name))
          .join(', ') || 'none'
      }`,
    );
    const wrongSeverity = records.filter(
      (record) =>
        typeof record.event_name === 'string' &&
        severities[record.event_name] !== undefined &&
        record.severity_text !== severities[record.event_name],
    );
    report.check(
      `${tag} every record has its row's severity`,
      wrongSeverity.length === 0,
      `${records.filter((record) => String(record.event_name).startsWith('auth.')).length} auth records`,
    );
    const extra = records
      .filter((record) => typeof record.event_name === 'string' && record.event_name.startsWith('auth.'))
      .filter((record) =>
        Object.keys(record.fields ?? {}).some((key) => !(allowed[String(record.event_name)] ?? []).includes(key)),
      );
    report.check(
      `${tag} no record carries a field its row does not name`,
      extra.length === 0,
      extra.length === 0 ? 'every field name is in its row' : JSON.stringify(extra[0]?.fields),
    );
  } finally {
    await server.close();
    await rig.dispose();
  }
}

for (const kind of kinds) {
  await report.run(`${kind} security events`, () => run(kind));
}
await host.close();
pki.dispose();
report.finish();
