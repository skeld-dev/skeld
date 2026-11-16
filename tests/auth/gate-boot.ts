// Does:  Proves the boot refusals of a gated server and of a store factory, and that public routes read no identity.
// Holds: Each refusal is judged by its BootError code and exact message; a control with a valid declaration boots.

import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { generateKeyPairSync } from 'node:crypto';
import { apiKeys } from '@skeld/auth/api-key';
import { jwt } from '@skeld/auth/jwt';
import { oidc } from '@skeld/auth/oidc';
import { Secret } from '@skeld/core/secret';
import { definePolicy } from '@skeld/auth/policy';
import { sessionRoutes } from '@skeld/auth/routes';
import { createAuth } from '@skeld/auth/server';
import { createPostgresStore } from '@skeld/auth/postgres';
import { createSqliteStore } from '@skeld/auth/sqlite';
import { BootError } from '@skeld/core/boot-error';
import { defineContract } from '@skeld/core/contract';
import type { AccessTypes, Gate } from '@skeld/core/gate';
import { object, string } from '@skeld/core/schema';
import { createServer, type Server } from '@skeld/core/server';
import { Pool } from 'pg';
import { cookieHeader, get, type Observed, ORIGIN, observe, series, spareStore, startApp } from './rig/v1-app.ts';
import { createReport } from './rig/v1-report.ts';
import { cleanAll, makeRig, type Kind } from './support-store.ts';
import { behaviorKinds as rigKinds } from '../support/test-profile.ts';

const statement =
  'an omitted access declaration, an unknown policy or action, a policy input that is not in the route schemas, a credential kind that is not installed, a cookie route outside a strict csrf group, an access declaration without a gate, an invalid configuration and every unknown option key refuse boot with the contract wording; public routes do no identity lookup; a server without a gate behaves as before';
const report = createReport('v01', statement);

const jwtPair = generateKeyPairSync('ec', { namedCurve: 'P-256' });
const ok = { 200: object({ ok: string({ maxLength: 8 }) }) };
const reply = () => ({ status: 200 as const, body: { ok: 'y' } });

interface Outcome {
  readonly code: string;
  readonly message: string;
}

async function attempt<A extends AccessTypes>(
  gate: Gate<A>,
  register: (server: Server<A>) => void,
  extra: { publicOrigin?: string | readonly string[]; csrf?: { mode: 'strict' } } = {},
): Promise<Outcome | null> {
  const server = createServer({ gate, log: false, publicOrigin: ORIGIN, csrf: { mode: 'strict' }, ...extra });
  register(server);
  try {
    await server.listen({ host: '127.0.0.1', port: 0 });
    await server.close();
    return null;
  } catch (error) {
    if (error instanceof BootError) {
      return { code: error.code, message: error.message };
    }
    return { code: error instanceof Error ? error.name : typeof error, message: String(error) };
  }
}

function expectListens(name: string, outcome: Outcome | null): void {
  report.check(name, outcome === null, outcome === null ? 'listened' : `${outcome.code}: ${outcome.message}`);
}

function expectBoot(name: string, outcome: Outcome | null, code: string, message: string | RegExp): void {
  const matches =
    outcome !== null &&
    outcome.code === code &&
    (typeof message === 'string' ? outcome.message === message : message.test(outcome.message));
  report.check(name, matches, outcome === null ? 'listen resolved' : `${outcome.code}: ${outcome.message}`);
}

const idSchema = string({ maxLength: 36 });
const lookalike = string({ maxLength: 36 });

async function declarationCases(kind: Kind, makeStore: () => Observed): Promise<void> {
  const label = `[${kind}]`;
  const docs = definePolicy('docs', { credentials: ['session'], actions: { read: () => true } });
  const byId = definePolicy('byid', {
    credentials: ['session'],
    input: { id: idSchema },
    load: ({ input }) => ({ id: input.id }),
    actions: { read: () => true },
  });
  const needsJwt = definePolicy('needsjwt', { credentials: ['jwt'], actions: { read: () => true } });
  const needsKey = definePolicy('needskey', { credentials: ['api_key'], actions: { read: () => true } });
  const gated = () =>
    createAuth({ store: makeStore().store, origin: ORIGIN, policies: [docs, byId, needsJwt, needsKey] });
  const gatedWithKeys = () =>
    createAuth({ store: makeStore().store, origin: ORIGIN, policies: [docs, byId, needsKey], apiKeys: apiKeys() });
  const route = (access?: 'public' | 'optional' | { policy: string; action: string }) =>
    defineContract({
      thing: { method: 'GET', path: '/thing', responses: ok, ...(access === undefined ? {} : { access }) },
    });

  expectListens(
    `${label} control: a valid declaration listens`,
    await attempt(gatedWithKeys().gate, (s) => s.routes(route({ policy: 'docs', action: 'read' }), { thing: reply })),
  );

  const omitted = await attempt(gated().gate, (s) => s.routes(route(), { thing: reply }));
  expectBoot(`${label} omitted access refuses boot and names the route`, omitted, 'ACCESS_UNDECLARED', /thing/);
  const inPlugin = await attempt(gated().gate, (s) =>
    s.register((scope) => {
      scope.routes(route(), { thing: reply });
    }),
  );
  expectBoot(`${label} omitted access inside a plugin refuses boot too`, inPlugin, 'ACCESS_UNDECLARED', /thing/);
  expectBoot(
    `${label} an unknown policy refuses boot`,
    await attempt(gated().gate, (s) => s.routes(route({ policy: 'nope', action: 'read' }), { thing: reply })),
    'ACCESS_REFUSED',
    /unknown policy/,
  );
  expectBoot(
    `${label} an unknown action refuses boot`,
    await attempt(gated().gate, (s) => s.routes(route({ policy: 'docs', action: 'write' }), { thing: reply })),
    'ACCESS_REFUSED',
    /unknown action/,
  );
  expectBoot(
    `${label} a policy with no matching input schema in the route refuses boot`,
    await attempt(gated().gate, (s) => s.routes(route({ policy: 'byid', action: 'read' }), { thing: reply })),
    'ACCESS_REFUSED',
    /policy input not in the route schemas/,
  );
  const withParams = (schema: typeof idSchema, where: 'params' | 'query' | 'body') =>
    defineContract({
      thing: {
        method: where === 'body' ? 'POST' : 'GET',
        path: where === 'params' ? '/thing/:id' : '/thing',
        responses: ok,
        access: { policy: 'byid', action: 'read' },
        ...(where === 'params' ? { params: object({ id: schema }) } : {}),
        ...(where === 'query' ? { query: object({ id: schema }) } : {}),
        ...(where === 'body' ? { body: object({ id: schema }) } : {}),
      },
    });
  expectBoot(
    `${label} an equal-looking but different schema node refuses boot (identity, not shape)`,
    await attempt(gated().gate, (s) => s.routes(withParams(lookalike, 'params'), { thing: reply })),
    'ACCESS_REFUSED',
    /policy input not in the route schemas/,
  );
  await series(['params', 'query', 'body'] as const, async (where) => {
    expectListens(
      `${label} the same schema node in ${where} boots (control)`,
      await attempt(gated().gate, (s) => s.routes(withParams(idSchema, where), { thing: reply })),
    );
  });
  const inTwoParts = defineContract({
    thing: {
      method: 'GET',
      path: '/thing/:id',
      responses: ok,
      access: { policy: 'byid', action: 'read' },
      params: object({ id: idSchema }),
      query: object({ id: idSchema }),
    },
  });
  expectBoot(
    `${label} the same schema node under the same key in two parts refuses boot (exactly one)`,
    await attempt(gated().gate, (s) => s.routes(inTwoParts, { thing: reply })),
    'ACCESS_REFUSED',
    /policy input not in the route schemas/,
  );
  expectBoot(
    `${label} a jwt-only policy with no jwt part installed refuses boot`,
    await attempt(gated().gate, (s) => s.routes(route({ policy: 'needsjwt', action: 'read' }), { thing: reply })),
    'ACCESS_REFUSED',
    /credential kind not installed/,
  );
  expectBoot(
    `${label} an api_key policy with no api-key part installed refuses boot`,
    await attempt(gated().gate, (s) => s.routes(route({ policy: 'needskey', action: 'read' }), { thing: reply })),
    'ACCESS_REFUSED',
    /credential kind not installed/,
  );
  expectListens(
    `${label} an api_key policy with the part installed boots`,
    await attempt(gatedWithKeys().gate, (s) =>
      s.routes(route({ policy: 'needskey', action: 'read' }), { thing: reply }),
    ),
  );
}

async function csrfCases(kind: Kind, makeStore: () => Observed): Promise<void> {
  const label = `[${kind}]`;
  const auth = () => createAuth({ store: makeStore().store, origin: ORIGIN });
  const strict = { csrf: { mode: 'strict' as const } };
  expectBoot(
    `${label} auth's session routes on a baseline csrf group refuse boot`,
    await attempt(auth().gate, (s) => s.routes(sessionRoutes, auth().handlers.session, { csrf: { mode: 'baseline' } })),
    'ACCESS_REFUSED',
    /cookie route outside a strict csrf group/,
  );
  await series(['authSession', 'authSignOut', 'authSessionClear'] as const, async (name) => {
    const built = auth();
    expectBoot(
      `${label} ${name} listed in csrfExempt refuses boot`,
      await attempt(
        built.gate,
        (s) => s.routes(sessionRoutes, built.handlers.session, { csrf: { mode: 'strict' }, csrfExempt: [name] }),
        strict,
      ),
      'ACCESS_REFUSED',
      /cookie route listed in csrfExempt/,
    );
  });
  const control = auth();
  expectListens(
    `${label} control: the session routes in a strict group boot`,
    await attempt(
      control.gate,
      (s) => s.routes(sessionRoutes, control.handlers.session, { csrf: { mode: 'strict' } }),
      strict,
    ),
  );
  const optionalRoute = defineContract({ thing: { method: 'GET', path: '/thing', responses: ok, access: 'optional' } });
  expectBoot(
    `${label} an application 'optional' route (it reads the session cookie) in a baseline group refuses boot`,
    await attempt(auth().gate, (s) => s.routes(optionalRoute, { thing: reply }, { csrf: { mode: 'baseline' } })),
    'ACCESS_REFUSED',
    /cookie route outside a strict csrf group/,
  );
}

type Build = (extra: Record<string, unknown>) => ReturnType<typeof createAuth>;

function bootOutcome(
  auth: ReturnType<typeof createAuth>,
  publicOrigin: string | readonly string[] = ORIGIN,
): Promise<Outcome | null> {
  return attempt(
    auth.gate,
    (s) =>
      s.routes(defineContract({ p: { method: 'GET', path: '/p', responses: ok, access: 'public' } }), { p: reply }),
    { publicOrigin },
  );
}

async function configurationCases(kind: Kind, makeStore: () => Observed): Promise<void> {
  const label = `[${kind}]`;
  const build: Build = (extra) => createAuth({ store: makeStore().store, origin: ORIGIN, ...extra });
  const refused = async (
    name: string,
    extra: Record<string, unknown>,
    expected: string | RegExp,
    forbid?: string,
  ): Promise<void> => {
    const outcome = await bootOutcome(build(extra));
    expectBoot(`${label} ${name}`, outcome, 'GATE_FAILED', expected);
    if (forbid !== undefined) {
      report.check(
        `${label} ${name}: the message holds no value`,
        outcome !== null && !outcome.message.includes(forbid),
        outcome?.message ?? '',
      );
    }
  };
  const origin = await bootOutcome(createAuth({ store: makeStore().store, origin: ORIGIN }), 'http://localhost');
  expectBoot(
    `${label} an origin that is not one of publicOrigin`,
    origin,
    'GATE_FAILED',
    "gate failed: origin: not one of the server's publicOrigin",
  );
  await refused('an http origin on a public host', { origin: 'http://example.test' }, /^gate failed: origin: /);
  await refused('session idleSeconds below 2', { session: { idleSeconds: 1 } }, /^gate failed: session: /);
  await refused(
    'session idleSeconds above absoluteSeconds',
    { session: { idleSeconds: 7777, absoluteSeconds: 4000 } },
    /^gate failed: session: /,
    '7777',
  );
  await refused(
    'session renewSeconds above half of idleSeconds',
    { session: { idleSeconds: 100, renewSeconds: 9191 } },
    /^gate failed: session: /,
    '9191',
  );
  await refused(
    'a cookie name without the __Host- prefix',
    { session: { cookieName: 'plain-name' } },
    /^gate failed: session: /,
    'plain-name',
  );
  await refused(
    'a fractional session lifetime',
    { session: { idleSeconds: 3600.5 } },
    /^gate failed: session: /,
    '3600.5',
  );
  await refused(
    'a limit scope under the reserved auth. prefix',
    { limits: { 'auth.mine': { max: 1, windowSeconds: 1 } } },
    /^gate failed: limits: /,
  );
  await refused('a limit with max 0', { limits: { mine: { max: 0, windowSeconds: 1 } } }, /^gate failed: limits: /);
  await refused(
    'a limit with windowSeconds 86,401',
    { limits: { mine: { max: 1, windowSeconds: 86401 } } },
    /^gate failed: limits: /,
    '86401',
  );
  const many = Object.fromEntries(Array.from({ length: 33 }, (_, n) => [`s${n}`, { max: 1, windowSeconds: 1 }]));
  await refused('33 limit scopes', { limits: many }, /^gate failed: limits: /);
  const twice = definePolicy('twice', { credentials: ['session'], actions: { read: () => true } });
  await refused('two policies of one name', { policies: [twice, twice] }, /^gate failed: policies: /);
  await refused(
    'a policy with an empty credentials list',
    { policies: [definePolicy('bare', JSON.parse('{"credentials":[],"actions":{"read":null}}'))] },
    /^gate failed: policies: /,
  );

  await refused(
    "policies: null (null is a value, judged by the option's rule)",
    { policies: null },
    /^gate failed: policies: /,
  );
  await series(['session', 'limits', 'addressLimit', 'apiKeys', 'jwt', 'oidc'], async (key) => {
    await refused(`${key}: null`, { [key]: null }, /^gate failed: [a-z_]+: /);
  });
  await series(['policies', 'session', 'limits', 'addressLimit', 'apiKeys', 'jwt', 'oidc'], async (key) => {
    expectListens(`${label} ${key}: undefined is absent and boots`, await bootOutcome(build({ [key]: undefined })));
  });
  const unknown = (key: string | symbol): Record<string | symbol, unknown> => ({ [key]: 1 });
  await refused(
    'an unknown key with a control character',
    unknown('bad\nkey'),
    'gate failed: options: bad?key: is not a key of AuthOptions',
  );
  const long = (await bootOutcome(build(unknown('k'.repeat(300))))) ?? { code: '', message: '' };
  const finding = long.message.slice('gate failed: options: '.length);
  report.check(
    `${label} an unknown key of 300 characters: the finding is cut at 200 code units`,
    long.code === 'GATE_FAILED' && finding.length === 200,
    `finding length ${finding.length}`,
  );
  const pair = jwtPair.publicKey.export({ format: 'jwk' });
  const jwtBase = {
    ...JSON.parse('{}'),
    issuer: 'https://issuer.test',
    audience: 'skeld-test',
    algorithms: ['ES256'],
    keys: [{ kty: 'EC', crv: 'P-256', x: pair.x, y: pair.y, kid: 'k1' }],
    map: () => ({ kind: 'deny' }),
  };
  const oidcBase = {
    ...JSON.parse('{}'),
    providers: { local: { issuer: 'https://idp.test', clientId: 'client', clientSecret: new Secret('secret') } },
    failurePath: '/failed',
    resolveUser: () => ({ kind: 'deny' }),
  };
  const policyBase = JSON.parse('{"credentials":["session"],"actions":{"read":null}}');
  const tenantBase = {
    ...JSON.parse('{}'),
    credentials: ['session'],
    load: () => ({}),
    tenant: { of: () => 't', member: () => true },
    actions: { read: () => true },
  };
  const rows: [string, string, (text: string) => string, (key: string | symbol) => Record<string, unknown>][] = [
    ['createAuth options', 'options', (k) => `${k}: is not a key of AuthOptions`, (key) => unknown(key)],
    ['session', 'session', (k) => `session.${k}: is not a key of SessionOptions`, (key) => ({ session: { [key]: 1 } })],
    [
      'limits.<scope>',
      'limits',
      (k) => `limits.login.${k}: is not a key of LimitRule`,
      (key) => ({ limits: { login: { max: 1, windowSeconds: 1, [key]: 1 } } }),
    ],
    [
      'addressLimit',
      'limits',
      (k) => `addressLimit.${k}: is not a key of LimitRule`,
      (key) => ({ addressLimit: { max: 1, windowSeconds: 1, [key]: 1 } }),
    ],
    [
      'a policy',
      'policies',
      (k) => `policies[0].${k}: is not a key of PolicyOptions`,
      (key) => ({ policies: [definePolicy('weird', { ...policyBase, [key]: 1 })] }),
    ],
    [
      'a policy limit',
      'policies',
      (k) => `policies[0].limit.${k}: is not a key of LimitRule`,
      (key) => ({
        policies: [definePolicy('limitedp', { ...policyBase, limit: { max: 1, windowSeconds: 1, [key]: 1 } })],
      }),
    ],
    [
      'a policy tenant',
      'policies',
      (k) => `policies[0].tenant.${k}: is not a key of PolicyOptions.tenant`,
      (key) => ({
        policies: [definePolicy('tenanted', { ...tenantBase, tenant: { ...tenantBase.tenant, [key]: 1 } })],
      }),
    ],
    [
      'apiKeys()',
      'api_key',
      (k) => `apiKeys.${k}: is not a key of ApiKeyOptions`,
      (key) => ({ apiKeys: apiKeys({ [key]: 1 }) }),
    ],
    ['jwt()', 'jwt', (k) => `jwt.${k}: is not a key of JwtOptions`, (key) => ({ jwt: jwt({ ...jwtBase, [key]: 1 }) })],
    [
      'oidc()',
      'oidc',
      (k) => `oidc.${k}: is not a key of OidcOptions`,
      (key) => ({ oidc: oidc({ ...oidcBase, [key]: 1 }) }),
    ],
    [
      'an oidc provider',
      'oidc',
      (k) => `oidc.providers.local.${k}: is not a key of OidcProvider`,
      (key) => ({ oidc: oidc({ ...oidcBase, providers: { local: { ...oidcBase.providers.local, [key]: 1 } } }) }),
    ],
  ];
  await series(rows, async ([name, component, findingOf, extraOf]) => {
    await series(['typo', Symbol('sym')], async (key) => {
      const text = String(key);
      await refused(
        `an unknown ${typeof key === 'symbol' ? 'symbol' : 'string'} key of ${name}`,
        extraOf(key),
        `gate failed: ${component}: ${findingOf(text)}`,
      );
    });
  });
}

async function storeFindings(kind: Kind): Promise<void> {
  const label = `[${kind}]`;
  const fresh = async (options: { install?: boolean } = {}) => makeRig(kind, { attach: false, ...options });
  const runCase = async (
    name: string,
    rig: Awaited<ReturnType<typeof fresh>>,
    finding: string,
    prepare?: () => Promise<void>,
  ): Promise<void> => {
    try {
      await prepare?.();
      const outcome = await bootOutcome(createAuth({ store: rig.store, origin: ORIGIN }));
      expectBoot(`${label} ${name}`, outcome, 'GATE_FAILED', `gate failed: store: ${finding}`);
    } finally {
      await rig.dispose();
    }
  };
  await runCase('a store whose schema was never installed', await fresh({ install: false }), 'not installed');
  const mismatched = await fresh();
  await runCase('a store whose schema_version is 2', mismatched, 'version mismatch', async () => {
    await mismatched.query('UPDATE schema_version SET version = 2');
  });
  const unreadable = await fresh();
  await runCase('a store whose schema_version has no row', unreadable, 'version unreadable', async () => {
    await unreadable.query('DELETE FROM schema_version');
  });
  const inUse = await fresh();
  await runCase('a store that is already attached', inUse, 'in use', async () => {
    await inUse.store.attach({ onFailure: () => undefined });
  });
  const closed = await fresh();
  await runCase('a store that was closed', closed, 'unavailable', async () => {
    await closed.store.close();
  });
  const spare = await fresh();
  try {
    const first = createAuth({ store: spare.store, origin: ORIGIN });
    const one = createServer({ gate: first.gate, log: false, publicOrigin: ORIGIN });
    await one.listen({ host: '127.0.0.1', port: 0 });
    const second = createServer({ gate: first.gate, log: false, publicOrigin: ORIGIN });
    const again = await second.listen({ host: '127.0.0.1', port: 0 }).then(
      () => null,
      (error: unknown) => (error instanceof BootError ? { code: error.code, message: error.message } : null),
    );
    expectBoot(`${label} a second boot of one auth handle`, again, 'GATE_FAILED', 'gate failed: auth: already booted');
    await one.close();
  } finally {
    await spare.dispose();
  }
}

async function storeFactoryCases(): Promise<void> {
  const pool = new Pool({ max: 1 });
  try {
    const sqlite = (() => {
      try {
        createSqliteStore(JSON.parse('{"path":":memory:","pth":1}'));
        return 'returned';
      } catch (error) {
        return error instanceof BootError ? `${error.code}: ${error.message}` : String(error);
      }
    })();
    report.check(
      '[factory] createSqliteStore refuses an unknown key when called',
      sqlite === 'INVALID_OPTION: Invalid sqlite store option pth: is not a key of SqliteStoreOptions',
      sqlite,
    );
    const postgres = (() => {
      try {
        createPostgresStore({ pool, ...JSON.parse('{"maxClient":3}') });
        return 'returned';
      } catch (error) {
        return error instanceof BootError ? `${error.code}: ${error.message}` : String(error);
      }
    })();
    report.check(
      '[factory] createPostgresStore refuses an unknown key when called',
      postgres === 'INVALID_OPTION: Invalid postgres store option maxClient: is not a key of PostgresStoreOptions',
      postgres,
    );
  } finally {
    await pool.end();
  }
}

async function noGateCases(): Promise<void> {
  const publicRoute = defineContract({ thing: { method: 'GET', path: '/thing', responses: ok, access: 'public' } });
  const server = createServer({ log: false });
  server.routes(publicRoute, { thing: reply });
  const refused = await server.listen({ host: '127.0.0.1', port: 0 }).then(
    () => null,
    (error: unknown) => (error instanceof BootError ? { code: error.code, message: error.message } : null),
  );
  expectBoot(
    '[core] an access declaration on a server without a gate refuses boot and names the route',
    refused,
    'ACCESS_WITHOUT_GATE',
    /thing/,
  );
  const policyRoute = defineContract({
    thing: { method: 'GET', path: '/thing', responses: ok, access: { policy: 'p', action: 'a' } },
  });
  const second = createServer({ log: false });
  second.routes(policyRoute, { thing: reply });
  const refusedPolicy = await second.listen({ host: '127.0.0.1', port: 0 }).then(
    () => null,
    (error: unknown) => (error instanceof BootError ? { code: error.code, message: error.message } : null),
  );
  expectBoot(
    '[core] a policy declaration on a server without a gate refuses boot too',
    refusedPolicy,
    'ACCESS_WITHOUT_GATE',
    /thing/,
  );
  const plain = defineContract({ thing: { method: 'GET', path: '/thing', responses: ok } });
  const third = createServer({ log: false });
  third.routes(plain, { thing: reply });
  const address = await third.listen({ host: '127.0.0.1', port: 0 });
  const served = await get(address.port, '/thing');
  await third.close();
  report.check(
    '[core] a server without a gate serves a route with no access declaration: 200 and no www-authenticate',
    served.status === 200 && served.json().ok === 'y' && served.first('www-authenticate') === null,
    `${served.status} ${served.body}`,
  );
}

function baselineCase(): void {
  const result = spawnSync(
    process.execPath,
    ['--conditions=skeld-source', fileURLToPath(new URL('./rig/v1-baseline.ts', import.meta.url))],
    { encoding: 'utf8', timeout: 60_000 },
  );
  report.check(
    '[core] non-gated wire behavior matches fixed expectations',
    result.status === 0,
    `${result.stdout.trim()} ${result.stderr.slice(0, 300)}`,
  );
}

async function publicCases(kind: Kind): Promise<void> {
  const label = `[${kind}]`;
  const rig = await makeRig(kind, { attach: false });
  const observed = observe(rig.store);
  const app = await startApp({ store: observed.store });
  try {
    const live = await app.signIn('alice');
    observed.reset();
    const hostile = [
      cookieHeader('__Host-skeld', 'not-a-token'),
      'authorization: Bearer garbage',
      `cookie: __Host-skeld=${live.token ?? ''}; __Host-skeld=${live.token ?? ''}`,
    ];
    const pings = await Promise.all([
      get(app.port, '/ping'),
      get(app.port, '/ping', [hostile[0] ?? '']),
      get(app.port, '/ping', [hostile[1] ?? '']),
      get(app.port, '/ping', [hostile[2] ?? '']),
      get(app.port, '/ping', [
        cookieHeader('__Host-skeld', live.token ?? ''),
        `authorization: Bearer ${live.token ?? ''}`,
      ]),
    ]);
    report.check(
      `${label} a public route admits every request, valid, hostile or conflicting credentials alike, with no store call`,
      pings.every((r) => r.status === 200 && r.json().ok === 'y') && observed.calls() === 0 && app.hit('ping') === 5,
      `statuses ${pings.map((r) => r.status).join(',')}; store calls ${observed.calls()}`,
    );
    const anonymous = await get(app.port, '/auth/session');
    report.check(
      `${label} an optional route with no credential reads no store`,
      anonymous.status === 200 && observed.calls() === 0,
      `${anonymous.status}; store calls ${observed.calls()}`,
    );
    const withCookie = await get(app.port, '/auth/session', [cookieHeader('__Host-skeld', live.token ?? '')]);
    report.check(
      `${label} control: the same optional route with a live cookie reads the store`,
      withCookie.status === 200 && observed.calls('sessionRead') >= 1,
      `${withCookie.status}; sessionRead calls ${observed.calls('sessionRead')}`,
    );
  } finally {
    await app.close();
    await rig.dispose();
  }
}

try {
  await report.run('[factory] store factory unknown keys', storeFactoryCases);
  await report.run('[core] no-gate cases', noGateCases);
  await report.run('[core] fixed non-gated wire regression', () => Promise.resolve(baselineCase()));
  await series(rigKinds, async (kind) => {
    const pools: Pool[] = [];
    const rig = await makeRig(kind, { attach: false });
    const make = (): Observed => observe(spareStore(rig, pools));
    try {
      await report.run(`[${kind}] declaration cases`, () => declarationCases(kind, make));
      await report.run(`[${kind}] csrf cases`, () => csrfCases(kind, make));
      await report.run(`[${kind}] configuration cases`, () => configurationCases(kind, make));
    } finally {
      await Promise.all(pools.map((pool) => pool.end()));
      await rig.dispose();
    }
    await report.run(`[${kind}] store findings`, () => storeFindings(kind));
    await report.run(`[${kind}] public route cases`, () => publicCases(kind));
  });
} finally {
  await cleanAll();
}
report.finish();
