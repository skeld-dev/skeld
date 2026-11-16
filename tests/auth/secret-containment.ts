// Does:  Plants canaries in every secret auth handles, runs the retained methods, and searches every surface for them.
// Holds: A secret appears only where the contract returns it once to its owner; no response, record or diag key repeats it.
// biome-ignore-all lint/performance/noAwaitInLoops: each step is a request that must finish before the next
// biome-ignore-all lint/complexity/noExcessiveCognitiveComplexity: the battery is a straight line of independent steps
// biome-ignore-all lint/nursery/noUnsafeTypeAssertion: hostile callbacks deliberately answer shapes the type forbids
// biome-ignore-all lint/security/noSecrets: canary text and header names are fixtures, not secrets

import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { apiKeys } from '@skeld/auth/api-key';
import { jwt } from '@skeld/auth/jwt';
import { oidc } from '@skeld/auth/oidc';
import { hashPassword, needsRehash, verifyPassword } from '@skeld/auth/password';
import { definePolicy } from '@skeld/auth/policy';
import { oidcRoutes, sessionRoutes } from '@skeld/auth/routes';
import { createAuth } from '@skeld/auth/server';
import { defineContract } from '@skeld/core/contract';
import * as t from '@skeld/core/schema';
import { expose, Secret } from '@skeld/core/secret';
import { createServer } from '@skeld/core/server';
import type { Provider } from './rig/provider.ts';
import { loadPki, makePki } from './rig/pki.ts';
import { nowSeconds, providerHost, sign } from './rig/provider.ts';
import { createReport, type Report } from './rig/report.ts';
import { type Kind, kinds, makeStoreRig } from './rig/stores.ts';
import { settleLog, sleep } from './rig/util.ts';

interface Surface {
  readonly label: string;
  readonly text: string;
}
interface Outcome {
  readonly secrets: Record<string, string[]>;
  readonly surfaces: Surface[];
  readonly steps: string[];
}

const ORIGIN = 'http://localhost:3999';
const COOKIE = '__Host-skeld';
const here = fileURLToPath(import.meta.url);
const tag = randomBytes(4).toString('hex');
const CALLBACK_CANARY = `CANARY-CALLBACK-EXCEPTION-${tag}`;
const PROVIDER_CANARY = `CANARY-PROVIDER-TEXT-${tag}`;
const PARAM_CANARY = `CANARY-ERR-PARAM-${tag}`;
const CLIENT_SECRET = `CANARY-CLIENT-SECRET-${tag}`;
const REFRESH_TOKEN = `CANARY-REFRESH-TOKEN-${tag}`;
const PASSWORD = `CANARY-PASSWORD-${tag}`;

// Does:  The child: runs every retained method against one store under the diag build and returns what it saw.
async function battery(kind: Kind): Promise<Outcome> {
  const secrets: Record<string, string[]> = {};
  const surfaces: Surface[] = [];
  const steps: string[] = [];
  const plant = (label: string, value: string | undefined): void => {
    if (value !== undefined && value !== '') {
      const list = secrets[label] ?? [];
      list.push(value);
      secrets[label] = list;
    }
  };
  plant('callback exception text', CALLBACK_CANARY);
  plant('provider exception text', PROVIDER_CANARY);
  plant('error parameter text', PARAM_CANARY);
  plant('client secret', CLIENT_SECRET);
  plant('refresh token', REFRESH_TOKEN);
  plant('password', PASSWORD);
  const pki = loadPki(String(process.env.SKELD_PKI_DIR));
  const host = await providerHost(pki.good);
  const pa = host.add('a', 'client-a', CLIENT_SECRET);
  const pb = host.add('b', 'client-b', CLIENT_SECRET);
  const pc = host.add('c', 'client-c', CLIENT_SECRET);
  const pd = host.add('d', 'client-d', CLIENT_SECRET);
  const pj = host.add('j', 'client-j', CLIENT_SECRET);
  pa.extraToken = { refresh_token: REFRESH_TOKEN };
  pb.token = ({ json }) => json(500, { error: PROVIDER_CANARY, error_description: PROVIDER_CANARY });
  pc.discovery = ({ res }) => {
    res.writeHead(500, { 'content-type': 'text/plain' }).end(PROVIDER_CANARY);
  };
  pd.jwks = ({ res }) => {
    res.writeHead(200, { 'content-type': 'application/json' }).end(`{"keys":"${PROVIDER_CANARY}"}`);
  };
  const rig = await makeStoreRig(kind);
  const lines: string[] = [];
  const hooks = {
    action: (): unknown => true,
    load: (): unknown => ({ id: 1 }),
    map: (): unknown => ({ kind: 'accept', userId: 'jwt-user' }),
  };
  let resolver: () => unknown = () => ({ kind: 'user', userId: 'oidc-user' });
  const keys = apiKeys();
  const contract = defineContract({
    guarded: {
      method: 'GET',
      path: '/guarded',
      access: { policy: 'guard', action: 'go' },
      responses: { 200: t.object({ ok: t.boolean() }) },
    },
    charged: {
      method: 'GET',
      path: '/charged',
      access: 'public',
      responses: { 200: t.object({ kind: t.string({ maxLength: 16 }) }) },
    },
  });
  const part = oidc({
    providers: {
      a: { issuer: pa.issuer, clientId: 'client-a', clientSecret: new Secret(CLIENT_SECRET) },
      b: { issuer: pb.issuer, clientId: 'client-b', clientSecret: new Secret(CLIENT_SECRET) },
      c: { issuer: pc.issuer, clientId: 'client-c', clientSecret: new Secret(CLIENT_SECRET) },
    },
    failurePath: '/login',
    returnPath: '/home',
    resolveUser: () => resolver() as never,
  });
  const auth = createAuth({
    store: rig.open(),
    origin: ORIGIN,
    policies: [
      definePolicy('guard', {
        credentials: ['session', 'api_key', 'jwt'],
        load: () => hooks.load() as never,
        actions: { go: () => hooks.action() as never },
      }),
    ],
    limits: { charge: { max: 2, windowSeconds: 60 } },
    addressLimit: { max: 6, windowSeconds: 60 },
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
      access: true,
      correlation: true,
      clientAddress: true,
      errorIdentifiers: true,
      errorText: true,
      errorFrames: true,
      thresholds: { boot: 'debug', app: 'debug', security: 'debug' },
      sink: (batch: readonly string[]) => {
        lines.push(...batch);
      },
    },
  });
  server.routes(oidcRoutes, part.handlers, { csrf: { mode: 'strict' } });
  server.routes(sessionRoutes, auth.handlers.session, { csrf: { mode: 'strict' } });
  server.routes(contract, {
    guarded: () => ({ status: 200, body: { ok: true } }),
    charged: async ({ clientAddress }) => {
      const verdict = await auth.limits.charge('charge', { clientAddress });
      return { status: 200, body: { kind: verdict.kind } };
    },
  });
  const { port } = await server.listen({ port: 0 });
  const base = `http://127.0.0.1:${port}`;
  const jar = new Map<string, string>();
  const cookie = (): string => [...jar].map(([name, value]) => `${name}=${value}`).join('; ');
  const hit = async (
    label: string,
    path: string,
    init: { method?: string; headers?: Record<string, string>; body?: string } = {},
  ): Promise<{ status: number; text: string; headers: Headers }> => {
    const res = await fetch(`${base}${path}`, {
      method: init.method ?? 'GET',
      redirect: 'manual',
      headers: { cookie: cookie(), ...(init.method === 'POST' ? { origin: ORIGIN } : {}), ...init.headers },
      ...(init.body === undefined ? {} : { body: init.body }),
    });
    const text = await res.text();
    const headerText = [...res.headers].map(([name, value]) => `${name}: ${value}`).join('\n');
    surfaces.push({ label: `response ${label} headers`, text: headerText }, { label: `response ${label} body`, text });
    for (const line of res.headers.getSetCookie()) {
      const pair = line.split(';')[0] ?? '';
      const eq = pair.indexOf('=');
      if (/max-age=0/i.test(line)) {
        jar.delete(pair.slice(0, eq));
      } else {
        jar.set(pair.slice(0, eq), pair.slice(eq + 1));
        plant(pair.slice(0, eq) === COOKIE ? 'session token' : 'attempt cookie', pair.slice(eq + 1));
      }
    }
    steps.push(`${label} -> ${res.status}`);
    return { status: res.status, text, headers: res.headers };
  };
  const trip = async (provider: Provider, name: string, extraQuery: Record<string, string> = {}): Promise<void> => {
    const start = await hit(`oidc start ${name}`, `/auth/oidc/${name}/start`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
    const url = typeof JSON.parse(start.text)?.url === 'string' ? String(JSON.parse(start.text).url) : '';
    if (url === '') {
      return;
    }
    for (const row of await rig.rows('SELECT verifier FROM oidc_attempts')) {
      plant('pkce verifier', String(row.verifier));
    }
    const issued = provider.authorize(url);
    plant('authorization code', issued.code);
    plant('state', issued.state);
    const query = new URLSearchParams({ code: issued.code, state: issued.state, ...extraQuery });
    await hit(`oidc callback ${name}`, `/auth/oidc/${name}/callback?${query.toString()}`);
  };
  const guardedWith = async (label: string, token: string): Promise<void> => {
    plant('presented bearer credential', token);
    await hit(`guarded ${label}`, '/guarded', { headers: { authorization: `Bearer ${token}` } });
  };
  try {
    await trip(pa, 'a');
    const status = await hit('session status', '/auth/session');
    const csrf = JSON.parse(status.text).csrfToken;
    plant('csrf token', typeof csrf === 'string' ? csrf : undefined);
    await hit('sign-out without token', '/auth/sign-out', { method: 'POST' });
    await hit('sign-out', '/auth/sign-out', { method: 'POST', headers: { 'x-csrf-token': String(csrf) } });
    await hit('session clear', '/auth/session/clear', { method: 'POST' });
    for (const p of [pa, pb, pc]) {
      for (const value of p.issued.idTokens) {
        plant('id token', value);
      }
      for (const value of p.issued.accessTokens) {
        plant('access token', value);
      }
    }
    resolver = () => {
      throw new Error(CALLBACK_CANARY);
    };
    await trip(pa, 'a');
    resolver = () => ({ kind: 'deny' });
    await trip(pa, 'a');
    resolver = () => ({ kind: 'user', userId: 'oidc-user' });
    await trip(pa, 'a');
    await trip(pa, 'a', { error: PARAM_CANARY });
    await hit(
      'callback with error only',
      `/auth/oidc/a/callback?${new URLSearchParams({ state: 'A'.repeat(43), error: PARAM_CANARY }).toString()}`,
    );
    await trip(pb, 'b');
    await trip(pc, 'c');
    pa.claims = (claims) => ({ ...claims, nonce: PROVIDER_CANARY });
    await trip(pa, 'a');
    pa.claims = (claims) => claims;
    for (const p of [pa, pb, pc]) {
      for (const value of p.issued.idTokens) {
        plant('id token', value);
      }
      for (const value of p.issued.codes) {
        plant('authorization code', value);
      }
    }
    for (let i = 0; i < 8; i++) {
      await hit(`address limit ${i}`, '/auth/oidc/a/start', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      });
    }
    const established = await auth.sessions.establish({
      rawCookies: { get: () => undefined, getAll: () => [] },
      userId: 'handoff-user',
      verify: () => true,
    });
    if (established.kind === 'established') {
      for (const item of established.cookies) {
        plant('session token', item.value);
      }
      plant('csrf token', established.session.csrfToken);
      const sessionCookie = established.cookies.find((item) => item.name === COOKIE);
      const own = await hit('session status (handoff)', '/auth/session', {
        headers: { cookie: `${COOKIE}=${sessionCookie?.value ?? ''}` },
      });
      steps.push(`handoff session status ${own.status}`);
      await hit('guarded with the session', '/guarded', {
        headers: { cookie: `${COOKIE}=${sessionCookie?.value ?? ''}` },
      });
      await auth.sessions.rotate({
        rawCookies: {
          get: (name) => (name === COOKIE ? sessionCookie?.value : undefined),
          getAll: (name) => (name === COOKIE && sessionCookie !== undefined ? [sessionCookie.value] : []),
        },
      });
    }
    await hit('guarded with a malformed cookie', '/guarded', {
      headers: { cookie: `${COOKIE}=CANARY-BAD-COOKIE-${tag}` },
    });
    plant('presented bearer credential', `CANARY-BAD-COOKIE-${tag}`);
    const off = await auth.subjects.disable('handoff-user');
    await auth.subjects.enable('handoff-user', off.kind === 'done' ? off.generation : 1);
    await auth.subjects.revokeSessions('handoff-user');
    const issued = await keys.issue({ userId: 'key-user', name: 'proof key', scopes: ['guard:go'] });
    if (issued.kind === 'issued') {
      const full = expose(issued.key);
      plant('api key', full);
      plant('api key secret', full.split('.')[2]);
      await guardedWith('with the api key', full);
      await guardedWith('with a wrong secret', `${full.slice(0, -43)}${'A'.repeat(43)}`);
      await keys.list({ userId: 'key-user' });
      await keys.revoke({ userId: 'key-user', keyId: issued.info.keyId });
      await guardedWith('with the revoked key', full);
    }
    const goodJwt = sign(
      { alg: 'RS256', kid: pj.key.kid },
      { iss: pj.issuer, aud: 'api', sub: 'alice', exp: nowSeconds() + 300 },
      pj.key,
    );
    await guardedWith('with a jwt', goodJwt);
    await guardedWith(
      'with a jwt of the wrong audience',
      sign(
        { alg: 'RS256', kid: pj.key.kid },
        { iss: pj.issuer, aud: 'other', sub: 'alice', exp: nowSeconds() + 300 },
        pj.key,
      ),
    );
    await guardedWith(
      'with an unsigned jwt',
      sign({ alg: 'none' }, { iss: pj.issuer, aud: 'api', sub: 'alice', exp: nowSeconds() + 300 }, null),
    );
    hooks.map = () => {
      throw new Error(CALLBACK_CANARY);
    };
    await guardedWith('with a jwt whose map throws', goodJwt);
    hooks.map = () => ({ kind: 'accept', userId: 'jwt-user' });
    const secondKey = await keys.issue({ userId: 'key-user-2', name: 'second', scopes: ['guard:go'] });
    if (secondKey.kind === 'issued') {
      const full = expose(secondKey.key);
      plant('api key', full);
      plant('api key secret', full.split('.')[2]);
      hooks.action = () => {
        throw new Error(CALLBACK_CANARY);
      };
      await guardedWith('with a policy action that throws', full);
      hooks.action = () => true;
      hooks.load = () => Promise.reject(new Error(CALLBACK_CANARY));
      await guardedWith('with a policy load that rejects', full);
      hooks.load = () => ({ id: 1 });
    }
    const failed = await auth.sessions.establish({
      rawCookies: { get: () => undefined, getAll: () => [] },
      userId: 'verify-user',
      verify: () => {
        throw new Error(CALLBACK_CANARY);
      },
    });
    surfaces.push({ label: 'result establish with a verify that throws', text: JSON.stringify(failed) });
    for (let i = 0; i < 4; i++) {
      await hit(`charge ${i}`, '/charged');
    }
    const hashed = await hashPassword(new Secret(PASSWORD));
    if (hashed.kind === 'hashed') {
      plant('password hash', hashed.hash);
      plant('password hash tag', hashed.hash.split('$')[5]);
      await verifyPassword(new Secret(PASSWORD), hashed.hash);
      await verifyPassword(new Secret(`${PASSWORD}-wrong`), hashed.hash);
      needsRehash(hashed.hash);
    }
    for (const run of [
      () => hashPassword(new Secret(PASSWORD), { cost: { memoryKiB: 1, passes: 1 } }),
      () => verifyPassword(new Secret(PASSWORD), 'x', { bogus: 1 } as never),
    ]) {
      try {
        await run();
      } catch (error) {
        surfaces.push({
          label: 'error thrown by a password helper',
          text: String(error instanceof Error ? `${error.name} ${error.message} ${error.stack}` : error),
        });
      }
    }
    for (const attempt of [
      () => auth.subjects.read('bad id with spaces'),
      () => keys.issue({ userId: 'key-user', name: 'x', scopes: [], bogus: 1 } as never),
    ]) {
      try {
        await attempt();
      } catch (error) {
        surfaces.push({
          label: 'error thrown by a server-side call',
          text: String(error instanceof Error ? `${error.name} ${error.message} ${error.stack}` : error),
        });
      }
    }
    await sleep(300);
    await settleLog(lines);
    surfaces.push({ label: 'every log record', text: lines.join('\n') });
  } finally {
    await server.close();
    await rig.dispose();
    await host.close();
    pki.dispose();
  }
  return { secrets, surfaces, steps };
}

if (process.env.SKELD_SC_CHILD !== undefined) {
  const kind: Kind = process.env.SKELD_SC_CHILD === 'postgres' ? 'postgres' : 'sqlite';
  const outcome = await battery(kind);
  writeFileSync(String(process.env.SKELD_SC_OUT), JSON.stringify(outcome));
} else {
  await parent();
}

// Does:  The parent: runs the child per store under the diag build, then searches every surface for every secret.
async function parent(): Promise<void> {
  const report = createReport(
    'v06',
    'secret-containment',
    'no secret auth handles, and no text a callback or a provider throws, appears in any response, log record, diag key or error across the retained methods, except where the contract returns a value once to its owner',
  );
  for (const kind of kinds) {
    await judge(report, kind);
  }
  report.finish();
}

interface Ran {
  readonly code: number | null;
  readonly outcome: Outcome | null;
  readonly diag: string;
  readonly stdout: string;
  readonly stderr: string;
}

async function runChild(kind: Kind): Promise<Ran> {
  const dir = mkdtempSync(join(tmpdir(), 'skeld-v-contain-'));
  const out = join(dir, 'outcome.json');
  const diagDir = join(dir, 'diag');
  const stderr: string[] = [];
  const stdout: string[] = [];
  const authority = makePki();
  const child = spawn(process.execPath, ['--conditions=skeld-source', '--conditions=skeld-diag', here], {
    env: {
      ...process.env,
      NODE_EXTRA_CA_CERTS: authority.caFile,
      SKELD_PKI_DIR: authority.dir,
      SKELD_SC_CHILD: kind,
      SKELD_SC_OUT: out,
      SKELD_DIAG_DIR: diagDir,
      SKELD_DIAG_STEP_N: '1',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (chunk: Buffer) => stdout.push(String(chunk)));
  child.stderr.on('data', (chunk: Buffer) => stderr.push(String(chunk)));
  const code = await new Promise<number | null>((resolve) => child.on('close', resolve));
  authority.dispose();
  let outcome: Outcome | null = null;
  let diag = '';
  if (code === 0) {
    outcome = JSON.parse(readFileSync(out, 'utf8'));
    for (const name of readdirSync(diagDir)) {
      diag += `${readFileSync(join(diagDir, name), 'utf8')}\n`;
    }
  }
  rmSync(dir, { recursive: true, force: true });
  return { code, outcome, diag, stdout: stdout.join(''), stderr: stderr.join('') };
}

// Does:  The only places the contract returns a secret: the owner's sign-in and status responses.
function allowed(secret: string, surface: string): boolean {
  if (secret === 'session token') {
    return /^response (oidc callback a|session status( \(handoff\))?) headers$/.test(surface);
  }
  // Why: The state is the one-time value the start response hands the browser inside the authorization URL.
  if (secret === 'state') {
    return /^response oidc start \w body$/.test(surface);
  }
  if (secret === 'attempt cookie') {
    return /^response (oidc start \w|address limit \d) headers$/.test(surface);
  }
  return secret === 'csrf token' && /^response session status( \(handoff\))? body$/.test(surface);
}

async function judge(report: Report, kind: Kind): Promise<void> {
  const label = `[${kind}]`;
  const ran = await runChild(kind);
  if (ran.code !== 0 || ran.outcome === null) {
    report.check(
      `${label} the battery ran to its end under the diag build`,
      false,
      `exit ${ran.code}: ${ran.stderr.slice(0, 600)}`,
    );
    return;
  }
  const outcome = ran.outcome;
  const all: Surface[] = [
    ...outcome.surfaces,
    { label: 'diag recorder files', text: ran.diag },
    { label: 'the process stdout', text: ran.stdout },
    { label: 'the process stderr', text: ran.stderr },
  ];
  const planted = Object.entries(outcome.secrets);
  let tests = 0;
  const leaks: string[] = [];
  const exposures: string[] = [];
  for (const [name, values] of planted) {
    for (const value of new Set(values)) {
      for (const surface of all) {
        tests++;
        if (surface.text.includes(value)) {
          (allowed(name, surface.label) ? exposures : leaks).push(`${name} in ${surface.label}`);
        }
      }
    }
  }
  const logText = all.find((surface) => surface.label === 'every log record')?.text ?? '';
  const required = [
    'session token',
    'csrf token',
    'api key',
    'authorization code',
    'id token',
    'access token',
    'password hash',
    'client secret',
    'callback exception text',
    'provider exception text',
    'pkce verifier',
  ];
  report.note(
    `${label} ${outcome.steps.length} requests; ${all.length} surfaces; ${tests} secret-by-surface searches over: ${planted.map(([name, values]) => `${name} x${new Set(values).size}`).join(', ')}`,
  );
  report.check(
    `${label} the search ran over real material: every secret kind was captured, with response, log and diag surfaces`,
    required.every((name) => (outcome.secrets[name]?.length ?? 0) > 0) &&
      logText.length > 1000 &&
      ran.diag.length > 100,
    `${planted.length} secret kinds; log ${logText.length} bytes; diag ${ran.diag.length} bytes`,
  );
  report.check(
    `${label} no secret appears in any response, log record, diag key, error text or process output outside the owner's own sign-in and status responses`,
    leaks.length === 0,
    leaks.length === 0 ? `${tests} searches, 0 leaks` : `${leaks.length} leaks: ${[...new Set(leaks)].join('; ')}`,
  );
  report.check(
    `${label} the contract's own exposures are present and nowhere else: session cookie in the sign-in Set-Cookie, attempt cookie in the start Set-Cookie, csrf token in the status body`,
    exposures.length > 0,
    [...new Set(exposures)].join('; '),
  );
  const records = logText.split('\n').filter((line) => line.includes('"auth.')).length;
  report.check(
    `${label} the log held auth security records to search (errorText, errorFrames and access on, every threshold at debug)`,
    records > 10,
    `${records} lines naming auth.* fields`,
  );
}
