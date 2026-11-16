// Does:  Gives the V01 to V04 proofs a real createAuth on a real core server, a counting store and raw HTTP exchanges.
// Holds: Every app binds 127.0.0.1 port 0 and closes through the server's own close; no connection string is kept.

import { generateKeyPairSync, sign } from 'node:crypto';
import net from 'node:net';
import { setTimeout as sleep } from 'node:timers/promises';
import { type ApiKeys, apiKeys } from '@skeld/auth/api-key';
import { jwt } from '@skeld/auth/jwt';
import { oidc } from '@skeld/auth/oidc';
import { definePolicy } from '@skeld/auth/policy';
import { oidcRoutes, sessionRoutes } from '@skeld/auth/routes';
import { type Limits, createAuth, type SessionOptions, type Sessions, type Subjects } from '@skeld/auth/server';
import { type AuthStore, type StoreOperations, StoreFailure } from '@skeld/auth/store';
import { defineContract, errorBodySchema } from '@skeld/core/contract';
import { HttpError } from '@skeld/core/http-error';
import { integer, object, string } from '@skeld/core/schema';
import { Secret } from '@skeld/core/secret';
import { createServer, type RawCookies } from '@skeld/core/server';
import { hashPassword } from '@skeld/auth/password';
import { createPostgresStore } from '@skeld/auth/postgres';
import { createSqliteStore } from '@skeld/auth/sqlite';
import type { Pool } from 'pg';
import type { Rig } from '../support-store.ts';
import { rawExchange } from '../../support/support.ts';

export const ORIGIN = 'http://127.0.0.1';

export type Json = Record<string, unknown>;

function isRecord(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// Does:  One HTTP reply read from the wire: status, every header line in order, the body text.
export interface Reply {
  readonly status: number;
  readonly lines: readonly (readonly [string, string])[];
  readonly body: string;
  readonly raw: string;
  all: (name: string) => string[];
  first: (name: string) => string | null;
  json: () => Json;
}

export interface Spec {
  readonly method: string;
  readonly path: string;
  readonly headers?: readonly string[];
  readonly body?: string;
  readonly origin?: boolean;
  readonly waitMs?: number;
}

function replyOf(raw: string, status: number, body: string): Reply {
  const head = raw.split('\r\n\r\n')[0] ?? '';
  const lines: (readonly [string, string])[] = [];
  for (const line of head.split('\r\n').slice(1)) {
    const colon = line.indexOf(':');
    if (colon > 0) {
      lines.push([line.slice(0, colon).toLowerCase(), line.slice(colon + 1).trim()]);
    }
  }
  const all = (name: string): string[] => lines.filter(([lineName]) => lineName === name).map(([, value]) => value);
  return {
    status,
    lines,
    body,
    raw,
    all,
    first: (name) => all(name)[0] ?? null,
    json: () => {
      try {
        const parsed: unknown = JSON.parse(body);
        return isRecord(parsed) ? parsed : {};
      } catch {
        return {};
      }
    },
  };
}

// Does:  Sends one request as raw bytes on its own connection; an unsafe method carries the allowed Origin.
export async function send(port: number, spec: Spec): Promise<Reply> {
  const unsafe = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(spec.method);
  const headers = [...(spec.headers ?? [])];
  const has = (name: string): boolean => headers.some((line) => line.toLowerCase().startsWith(`${name}:`));
  if (unsafe && spec.origin !== false && !has('origin')) {
    headers.push(`origin: ${ORIGIN}`);
  }
  if (spec.body !== undefined && !has('content-type')) {
    headers.push('content-type: application/json');
  }
  if (spec.body !== undefined && !has('content-length')) {
    headers.push(`content-length: ${Buffer.byteLength(spec.body)}`);
  }
  const text = `${spec.method} ${spec.path} HTTP/1.1\r\nhost: x\r\nconnection: close\r\n${headers.map((line) => `${line}\r\n`).join('')}\r\n${spec.body ?? ''}`;
  const response = await rawExchange(port, text, spec.waitMs ?? 8000);
  return replyOf(response.raw, response.status, response.body);
}

export const get = (port: number, path: string, headers: readonly string[] = []): Promise<Reply> =>
  send(port, { method: 'GET', path, headers });

export function cookieHeader(name: string, value: string): string {
  return `cookie: ${name}=${value}`;
}

// Does:  Reads the session token out of a reply's Set-Cookie line, or null when the reply sets none.
function tokenOf(reply: Reply, name = '__Host-skeld'): string | null {
  for (const line of reply.all('set-cookie')) {
    if (line.startsWith(`${name}=`)) {
      const value = line.slice(name.length + 1).split(';')[0] ?? '';
      return value === '' ? null : value;
    }
  }
  return null;
}

export interface LogRecord {
  readonly event: string;
  readonly severity: string;
  readonly fields: Json;
  readonly all: Json;
}

export interface Logs {
  readonly sink: (lines: readonly string[]) => void;
  records: () => LogRecord[];
  named: (event: string) => LogRecord[];
  text: () => string;
  // Does:  Waits until the queued records have reached the sink: the count stays the same for 150 ms.
  settle: () => Promise<void>;
}

export function createLogs(): Logs {
  const lines: string[] = [];
  const records = (): LogRecord[] =>
    lines.flatMap((line) => {
      try {
        const parsed: unknown = JSON.parse(line);
        if (!isRecord(parsed)) {
          return [];
        }
        const fields = isRecord(parsed.fields) ? parsed.fields : {};
        return [
          {
            event: String(parsed.event_name),
            severity: String(parsed.severity_text),
            fields,
            all: parsed,
          },
        ];
      } catch {
        return [];
      }
    });
  return {
    sink: (batch) => {
      lines.push(...batch);
    },
    records,
    named: (event) => records().filter((record) => record.event === event),
    text: () => lines.join('\n'),
    settle: async () => {
      let last = -1;
      while (last !== lines.length) {
        last = lines.length;
        // biome-ignore lint/performance/noAwaitInLoops: a settle is a wait
        await sleep(150);
      }
    },
  };
}

export const OPERATIONS = [
  'subjectEnsure',
  'subjectRead',
  'subjectDisable',
  'subjectEnable',
  'subjectInvalidate',
  'sessionIssue',
  'sessionRead',
  'sessionRenew',
  'sessionRotate',
  'sessionRevoke',
  'apiKeyIssue',
  'apiKeyRead',
  'apiKeyList',
  'apiKeyRevoke',
  'limitCharge',
  'attemptCreate',
  'attemptConsume',
  'expiredRemove',
] as const;
export type Operation = (typeof OPERATIONS)[number];

export interface Observed {
  readonly store: AuthStore;
  calls: (operation?: Operation) => number;
  reset: () => void;
  // Does:  Makes every later call reject StoreFailure unavailable with the given outcome, or stops doing so on null.
  failWith: (applied: 'no' | 'unknown' | null, only?: Operation) => void;
  // Does:  Runs the hook before one operation reaches the real store; the hook may hold the call open.
  before: (operation: Operation, hook: (() => Promise<void>) | null) => void;
  // Does:  Runs the hook after one operation's real answer and before the caller gets it.
  after: (operation: Operation, hook: (() => Promise<void>) | null) => void;
}

// Does:  Wraps a store so each operation is counted, can be held and can be made to fail.
export function observe(inner: AuthStore): Observed {
  const counts = new Map<Operation, number>();
  const pre = new Map<Operation, () => Promise<void>>();
  const post = new Map<Operation, () => Promise<void>>();
  let failing: 'no' | 'unknown' | null = null;
  let failingOnly: Operation | null = null;
  const run = async <T>(operation: Operation, call: () => Promise<T>): Promise<T> => {
    counts.set(operation, (counts.get(operation) ?? 0) + 1);
    await pre.get(operation)?.();
    if (failing !== null && (failingOnly === null || failingOnly === operation)) {
      throw new StoreFailure(operation, 'unavailable', failing, null);
    }
    const answer = await call();
    await post.get(operation)?.();
    return answer;
  };
  const ops: StoreOperations = {
    subjectEnsure: (input, signal) => run('subjectEnsure', () => inner.ops.subjectEnsure(input, signal)),
    subjectRead: (input, signal) => run('subjectRead', () => inner.ops.subjectRead(input, signal)),
    subjectDisable: (input, signal) => run('subjectDisable', () => inner.ops.subjectDisable(input, signal)),
    subjectEnable: (input, signal) => run('subjectEnable', () => inner.ops.subjectEnable(input, signal)),
    subjectInvalidate: (input, signal) => run('subjectInvalidate', () => inner.ops.subjectInvalidate(input, signal)),
    sessionIssue: (input, signal) => run('sessionIssue', () => inner.ops.sessionIssue(input, signal)),
    sessionRead: (input, signal) => run('sessionRead', () => inner.ops.sessionRead(input, signal)),
    sessionRenew: (input, signal) => run('sessionRenew', () => inner.ops.sessionRenew(input, signal)),
    sessionRotate: (input, signal) => run('sessionRotate', () => inner.ops.sessionRotate(input, signal)),
    sessionRevoke: (input, signal) => run('sessionRevoke', () => inner.ops.sessionRevoke(input, signal)),
    apiKeyIssue: (input, signal) => run('apiKeyIssue', () => inner.ops.apiKeyIssue(input, signal)),
    apiKeyRead: (input, signal) => run('apiKeyRead', () => inner.ops.apiKeyRead(input, signal)),
    apiKeyList: (input, signal) => run('apiKeyList', () => inner.ops.apiKeyList(input, signal)),
    apiKeyRevoke: (input, signal) => run('apiKeyRevoke', () => inner.ops.apiKeyRevoke(input, signal)),
    limitCharge: (input, signal) => run('limitCharge', () => inner.ops.limitCharge(input, signal)),
    attemptCreate: (input, signal) => run('attemptCreate', () => inner.ops.attemptCreate(input, signal)),
    attemptConsume: (input, signal) => run('attemptConsume', () => inner.ops.attemptConsume(input, signal)),
    expiredRemove: (input, signal) => run('expiredRemove', () => inner.ops.expiredRemove(input, signal)),
  };
  const store: AuthStore = {
    install: () => inner.install(),
    attach: (config) => inner.attach(config),
    close: () => inner.close(),
    ops,
  };
  return {
    store,
    calls: (operation) =>
      operation === undefined ? [...counts.values()].reduce((sum, n) => sum + n, 0) : (counts.get(operation) ?? 0),
    reset: () => counts.clear(),
    failWith: (applied, only) => {
      failing = applied;
      failingOnly = only ?? null;
    },
    before: (operation, hook) => {
      if (hook === null) {
        pre.delete(operation);
      } else {
        pre.set(operation, hook);
      }
    },
    after: (operation, hook) => {
      if (hook === null) {
        post.delete(operation);
      } else {
        post.set(operation, hook);
      }
    },
  };
}

export interface AppOptions {
  readonly store: AuthStore;
  readonly session?: SessionOptions;
  readonly maxPerUser?: number;
  readonly addressLimit?: { readonly max: number; readonly windowSeconds: number };
  readonly handlerTimeoutMs?: number;
  readonly verify?: (userId: string, signal: AbortSignal) => boolean | Promise<boolean>;
  readonly docsRead?: () => boolean | Promise<boolean>;
  readonly exempt?: readonly ('keysOnly' | 'docs')[];
  readonly slow?: () => Promise<void>;
  readonly cors?: { readonly origins: readonly string[] };
  readonly jwksUrl?: string;
  readonly oidcIssuers?: readonly string[];
  readonly identifyCalls?: { count: number };
}

export interface App {
  readonly port: number;
  readonly url: string;
  readonly logs: Logs;
  readonly hits: Map<string, number>;
  readonly order: string[];
  readonly sessions: Sessions;
  readonly subjects: Subjects;
  readonly limits: Limits<'login' | 'burst' | 'tiny'>;
  readonly keys: ApiKeys;
  readonly actionCalls: Map<string, number>;
  hit: (route: string) => number;
  // Does:  Signs the user in through the app's own sign-in route and returns the cookie token and CSRF token.
  signIn: (
    userId: string,
    token?: string,
  ) => Promise<{ reply: Reply; token: string | null; csrf: string; result: string }>;
  close: () => Promise<void>;
}

const text = (maxLength: number) => string({ maxLength });

export const appRoutes = defineContract({
  ping: { method: 'GET', path: '/ping', access: 'public', responses: { 200: object({ ok: text(8) }) } },
  whoami: { method: 'GET', path: '/whoami', access: 'optional', responses: { 200: object({ who: text(200) }) } },
  docs: {
    method: 'GET',
    path: '/docs',
    access: { policy: 'docs', action: 'read' },
    responses: { 200: object({ who: text(200) }) },
  },
  save: {
    method: 'POST',
    path: '/docs',
    access: { policy: 'docs', action: 'write' },
    body: object({ name: string({ maxLength: 16 }) }),
    responses: { 200: object({ saved: text(16) }) },
  },
  putDoc: {
    method: 'PUT',
    path: '/docs',
    access: { policy: 'docs', action: 'write' },
    responses: { 200: object({ who: text(200) }) },
  },
  patchDoc: {
    method: 'PATCH',
    path: '/docs',
    access: { policy: 'docs', action: 'write' },
    responses: { 200: object({ who: text(200) }) },
  },
  delDoc: {
    method: 'DELETE',
    path: '/docs',
    access: { policy: 'docs', action: 'write' },
    responses: { 200: object({ who: text(200) }) },
  },
  keysOnly: {
    method: 'POST',
    path: '/keys-only',
    access: { policy: 'keysonly', action: 'use' },
    responses: { 200: object({ who: text(200) }) },
  },
  jwtDocs: {
    method: 'GET',
    path: '/jwt-docs',
    access: { policy: 'jwtdocs', action: 'use' },
    responses: { 200: object({ who: text(200) }) },
  },
  jwtLimited: {
    method: 'GET',
    path: '/jwt-limited',
    access: { policy: 'jwtlimited', action: 'use' },
    responses: { 200: object({ who: text(200) }) },
  },
  limited: {
    method: 'GET',
    path: '/limited',
    access: { policy: 'limited', action: 'use' },
    responses: { 200: object({ who: text(200) }) },
  },
  slow: {
    method: 'GET',
    path: '/slow',
    access: { policy: 'docs', action: 'read' },
    responses: { 200: object({ who: text(200) }) },
  },
  sessionOnly: {
    method: 'GET',
    path: '/session-only',
    access: { policy: 'private', action: 'read' },
    responses: { 200: object({ who: text(200) }) },
  },
  signIn: {
    method: 'POST',
    path: '/sign-in',
    access: 'public',
    body: object({ userId: string({ maxLength: 200 }) }),
    responses: { 200: object({ result: text(32), csrf: text(64), expiresAt: integer() }) },
  },
  rotate: {
    method: 'POST',
    path: '/rotate',
    access: 'public',
    responses: { 200: object({ result: text(32), csrf: text(64) }) },
  },
  login: {
    method: 'POST',
    path: '/login',
    access: 'public',
    body: object({ userId: string({ maxLength: 128 }), password: string({ maxLength: 64 }) }),
    responses: { 200: object({ result: text(16) }), 429: errorBodySchema },
  },
});

function who(principal: { readonly kind: string; readonly userId?: string | null; readonly subject?: string }): string {
  return `${principal.kind}:${principal.userId ?? principal.subject ?? ''}`;
}

const JWT_ISSUER = 'https://issuer.test';
const JWT_AUDIENCE = 'skeld-test';
const jwtPair = generateKeyPairSync('ec', { namedCurve: 'P-256' });
const jwkPublic = jwtPair.publicKey.export({ format: 'jwk' });

// Does:  Signs an ES256 token for the app's JWT part: issuer, audience, subject and a five minute expiry.
export function signJwt(subject: string, claims: Record<string, unknown> = {}): string {
  const encode = (value: unknown): string => Buffer.from(JSON.stringify(value)).toString('base64url');
  const body = `${encode({ alg: 'ES256', kid: 'test-key', typ: 'JWT' })}.${encode({ iss: JWT_ISSUER, aud: JWT_AUDIENCE, sub: subject, exp: Math.floor(Date.now() / 1000) + 300, ...claims })}`;
  const signature = sign('sha256', Buffer.from(body), { key: jwtPair.privateKey, dsaEncoding: 'ieee-p1363' });
  return `${body}.${signature.toString('base64url')}`;
}

// Does:  Boots a real createAuth on a real core server over the given store, with sessions, API keys and four policies.
export async function startApp(options: AppOptions): Promise<App> {
  const hits = new Map<string, number>();
  const actionCalls = new Map<string, number>();
  const order: string[] = [];
  const logs = createLogs();
  const bump = (map: Map<string, number>, name: string): void => {
    map.set(name, (map.get(name) ?? 0) + 1);
  };
  const docs = definePolicy('docs', {
    credentials: ['session', 'api_key'],
    actions: {
      read: async () => {
        bump(actionCalls, 'docs.read');
        return options.docsRead === undefined ? true : await options.docsRead();
      },
      write: () => {
        bump(actionCalls, 'docs.write');
        return true;
      },
    },
  });
  const limited = definePolicy('limited', {
    credentials: ['session', 'api_key'],
    limit: { max: 2, windowSeconds: 60 },
    actions: { use: () => true },
  });
  const jwtDocs = definePolicy('jwtdocs', { credentials: ['jwt'], actions: { use: () => true } });
  const jwtLimited = definePolicy('jwtlimited', {
    credentials: ['jwt'],
    limit: { max: 100, windowSeconds: 60 },
    actions: { use: () => true },
  });
  const jwtPart = jwt({
    issuer: JWT_ISSUER,
    audience: JWT_AUDIENCE,
    algorithms: ['ES256'],
    ...(options.jwksUrl === undefined
      ? { keys: [{ kty: 'EC', crv: 'P-256', x: jwkPublic.x, y: jwkPublic.y, kid: 'test-key', alg: 'ES256' }] }
      : { jwksUrl: options.jwksUrl }),
    map: ({ subject }) => {
      bump(hits, 'jwtMap');
      return { kind: 'accept', userId: subject.slice(0, 128) };
    },
  });
  const oidcPart =
    options.oidcIssuers === undefined
      ? undefined
      : oidc({
          providers: Object.fromEntries(
            options.oidcIssuers.map((issuer, n) => [
              `p${n + 1}`,
              { issuer, clientId: 'client', clientSecret: new Secret('secret') },
            ]),
          ),
          failurePath: '/failed',
          resolveUser: () => ({ kind: 'deny' }),
        });
  const keysOnly = definePolicy('keysonly', { credentials: ['api_key'], actions: { use: () => true } });
  const priv = definePolicy('private', { credentials: ['session'], actions: { read: () => true } });
  const keys = apiKeys(options.maxPerUser === undefined ? undefined : { maxPerUser: options.maxPerUser });
  const auth = createAuth({
    store: options.store,
    origin: ORIGIN,
    policies: [docs, limited, priv, keysOnly, jwtDocs, jwtLimited],
    jwt: jwtPart,
    ...(oidcPart === undefined ? {} : { oidc: oidcPart }),
    apiKeys: keys,
    limits: {
      login: { max: 3, windowSeconds: 60 },
      burst: { max: 1000, windowSeconds: 60 },
      tiny: { max: 1, windowSeconds: 1 },
    },
    ...(options.session === undefined ? {} : { session: options.session }),
    ...(options.addressLimit === undefined ? {} : { addressLimit: options.addressLimit }),
  });
  const counted = options.identifyCalls;
  const gate: typeof auth.gate =
    counted === undefined
      ? auth.gate
      : {
          boot: (context) => auth.gate.boot(context),
          bind: (route) => {
            const bound = auth.gate.bind(route);
            if (bound === null || 'finding' in bound) {
              return bound;
            }
            return {
              ...bound,
              identify: (request) => {
                counted.count++;
                return bound.identify(request);
              },
            };
          },
        };
  const server = createServer({
    gate,
    publicOrigin: ORIGIN,
    csrf: { mode: 'strict' },
    ...(options.cors === undefined ? {} : { cors: options.cors }),
    log: { thresholds: { security: 'info', app: 'info' }, sink: logs.sink },
    ...(options.handlerTimeoutMs === undefined ? {} : { handlerTimeoutMs: options.handlerTimeoutMs }),
  });
  const mark = (route: string): void => bump(hits, route);
  server.routes(sessionRoutes, auth.handlers.session, { csrf: { mode: 'strict' } });
  if (oidcPart !== undefined) {
    server.routes(oidcRoutes, oidcPart.handlers, { csrf: { mode: 'strict' } });
  }
  server.routes(
    appRoutes,
    {
      ping: () => {
        mark('ping');
        return { status: 200, body: { ok: 'y' } };
      },
      whoami: (request) => {
        mark('whoami');
        return { status: 200, body: { who: request.principal === null ? 'anonymous' : who(request.principal) } };
      },
      docs: (request) => {
        mark('docs');
        return { status: 200, body: { who: who(request.principal) } };
      },
      save: (request) => {
        mark('save');
        return { status: 200, body: { saved: request.body.name } };
      },
      limited: (request) => {
        mark('limited');
        return { status: 200, body: { who: who(request.principal) } };
      },
      putDoc: (request) => {
        mark('putDoc');
        return { status: 200, body: { who: who(request.principal) } };
      },
      patchDoc: (request) => {
        mark('patchDoc');
        return { status: 200, body: { who: who(request.principal) } };
      },
      delDoc: (request) => {
        mark('delDoc');
        return { status: 200, body: { who: who(request.principal) } };
      },
      keysOnly: (request) => {
        mark('keysOnly');
        return { status: 200, body: { who: who(request.principal) } };
      },
      jwtDocs: (request) => {
        mark('jwtDocs');
        return { status: 200, body: { who: who(request.principal) } };
      },
      jwtLimited: (request) => {
        mark('jwtLimited');
        return { status: 200, body: { who: who(request.principal) } };
      },
      slow: async (request) => {
        mark('slow');
        await options.slow?.();
        return { status: 200, body: { who: who(request.principal) } };
      },
      sessionOnly: (request) => {
        mark('sessionOnly');
        return { status: 200, body: { who: who(request.principal) } };
      },
      signIn: async (request) => {
        mark('signIn');
        const userId = request.body.userId;
        const established = await auth.sessions.establish({
          rawCookies: request.rawCookies,
          userId,
          verify: (signal) => options.verify?.(userId, signal) ?? true,
        });
        if (established.kind !== 'established') {
          return {
            status: 200,
            body: {
              result:
                established.kind === 'refused' ? `refused:${established.reason}` : `unavailable:${established.outcome}`,
              csrf: '',
              expiresAt: 0,
            },
          };
        }
        return {
          status: 200,
          body: {
            result: 'established',
            csrf: established.session.csrfToken,
            expiresAt: established.session.expiresAt,
          },
          cookies: established.cookies,
        };
      },
      rotate: async (request) => {
        mark('rotate');
        const rotated = await auth.sessions.rotate({ rawCookies: request.rawCookies });
        if (rotated.kind !== 'rotated') {
          return {
            status: 200,
            body: {
              result: rotated.kind === 'refused' ? `refused:${rotated.reason}` : `unavailable:${rotated.outcome}`,
              csrf: '',
            },
          };
        }
        return { status: 200, body: { result: 'rotated', csrf: rotated.session.csrfToken }, cookies: rotated.cookies };
      },
      login: async (request) => {
        mark('login');
        const verdict = await auth.limits.charge('login', request.body.userId, request.signal);
        order.push('charge');
        if (verdict.kind === 'limited') {
          throw new HttpError(429, 'RATE_LIMITED', 'Too many requests');
        }
        if (verdict.kind === 'unavailable') {
          throw new HttpError(503, 'AUTH_UNAVAILABLE', 'Service unavailable');
        }
        order.push('hash');
        const hashed = await hashPassword(new Secret(request.body.password), { signal: request.signal });
        return { status: 200, body: { result: hashed.kind } };
      },
    },
    { csrf: { mode: 'strict' }, ...(options.exempt === undefined ? {} : { csrfExempt: options.exempt }) },
  );
  const address = await server.listen({ host: '127.0.0.1', port: 0 });
  const port = address.port;
  const app: App = {
    port,
    url: `http://127.0.0.1:${port}`,
    logs,
    hits,
    order,
    sessions: auth.sessions,
    subjects: auth.subjects,
    limits: auth.limits,
    keys,
    actionCalls,
    hit: (route) => hits.get(route) ?? 0,
    signIn: async (userId, token) => {
      const headers = token === undefined ? [] : [cookieHeader('__Host-skeld', token)];
      const reply = await send(port, { method: 'POST', path: '/sign-in', headers, body: JSON.stringify({ userId }) });
      const body = reply.json();
      return {
        reply,
        token: tokenOf(reply),
        csrf: typeof body.csrf === 'string' ? body.csrf : '',
        result: String(body.result),
      };
    },
    close: async () => {
      await server.close();
    },
  };
  return app;
}

export const sleepMs = sleep;

// Does:  Runs the steps one after another, so a proof that needs an order says so without an await in a loop.
export function series<T>(items: readonly T[], step: (item: T, index: number) => Promise<void>): Promise<void> {
  return items.reduce((previous, item, index) => previous.then(() => step(item, index)), Promise.resolve());
}

export interface Socket {
  readonly write: (data: string) => void;
  // Does:  Waits up to ms for the text to appear in what was read; null when it did not.
  readonly until: (pattern: string, ms: number) => Promise<string | null>;
  // Does:  Waits up to ms for the peer to end the connection; false when it stayed open.
  readonly closed: (ms: number) => Promise<boolean>;
  readonly destroy: () => void;
}

export async function openSocket(port: number): Promise<Socket> {
  const socket = net.connect(port, '127.0.0.1');
  let seen = '';
  let ended = false;
  socket.setEncoding('latin1');
  socket.on('data', (chunk: string) => {
    seen += chunk;
  });
  socket.on('close', () => {
    ended = true;
  });
  socket.on('error', () => undefined);
  await new Promise<void>((resolve) => {
    socket.once('connect', resolve);
  });
  const poll = async (done: () => boolean, ms: number): Promise<boolean> => {
    const deadline = performance.now() + ms;
    while (performance.now() < deadline && !done()) {
      // biome-ignore lint/performance/noAwaitInLoops: a poll is a wait
      await sleep(10);
    }
    return done();
  };
  return {
    write: (data) => {
      socket.write(data, 'latin1');
    },
    until: async (pattern, ms) => ((await poll(() => seen.includes(pattern), ms)) ? seen : null),
    closed: (ms) => poll(() => ended, ms),
    destroy: () => {
      socket.destroy();
    },
  };
}

// Does:  Makes another store over the rig's database or file, for a second server; its pools are added to pools.
export function spareStore(rig: Rig, pools: Pool[]): AuthStore {
  if (rig.database === null) {
    return createSqliteStore({ path: rig.path, cleanupIntervalSeconds: 3600 });
  }
  const pool = rig.database.pool({ max: 4, application: 'proof-second' });
  pools.push(pool);
  return createPostgresStore({ pool, cleanupIntervalSeconds: 3600 });
}

const noCookies: RawCookies = { get: () => undefined, getAll: () => [] };

// Does:  Establishes a session for a user through the trusted call, as application code would, and returns its tokens.
export async function establishFor(sessions: Sessions, userId: string): Promise<{ token: string; csrf: string }> {
  const established = await sessions.establish({ rawCookies: noCookies, userId, verify: () => true });
  if (established.kind !== 'established') {
    throw new Error(`establish answered ${established.kind}`);
  }
  const value = established.cookies[0]?.value;
  if (value === undefined) {
    throw new Error('establish set no cookie');
  }
  return { token: value, csrf: established.session.csrfToken };
}

// Does:  Gives the request cookies of one cookie name and token, as the engine hands them to a handler.
export function cookiesOf(name: string, ...values: string[]): RawCookies {
  return {
    get: (key) => (key === name && values.length === 1 ? values[0] : undefined),
    getAll: (key) => (key === name ? values : []),
  };
}

// Does:  Disables a subject and returns the generation the disable answered, the one its own enable must name.
export async function disableUser(subjects: Subjects, userId: string): Promise<number> {
  const changed = await subjects.disable(userId);
  if (changed.kind !== 'done') {
    throw new Error(`disable answered ${changed.kind}`);
  }
  return changed.generation;
}
