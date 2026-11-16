// Does:  Proves the typed client's one credential kind, where it sends it, its grammar checks and its CSRF header.
// Holds: Requests are judged where they land: a capture server for the wire, a real gated server for the answers.

import { createServer as createHttpServer, type IncomingMessage } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createClient } from '@skeld/core/client';
import { defineContract } from '@skeld/core/contract';
import { HttpError } from '@skeld/core/http-error';
import { object, string } from '@skeld/core/schema';
import { expose } from '@skeld/core/secret';
import { appRoutes, observe, series, startApp } from './rig/v1-app.ts';
import { createReport } from './rig/v1-report.ts';
import { compileProbes } from '../support/support-compile.ts';
import { cleanAll, makeRig, type Kind, rigKinds } from './support-store.ts';
import { sessionRoutes } from '@skeld/auth/routes';

const statement =
  'the typed client sends its one credential only to non-public routes of its own origin (a bearer as authorization with credentials omitted, a session cookie with credentials included and its CSRF token on unsafe methods), refuses a token outside its grammar before any request, and refuses at creation a route that declares the credential headers';
const report = createReport('v01', statement);

const ok = { 200: object({ ok: string({ maxLength: 8 }) }) };
const contract = defineContract({
  pub: { method: 'GET', path: '/pub', access: 'public', responses: ok },
  pubPost: {
    method: 'POST',
    path: '/pub-post',
    access: 'public',
    body: object({ x: string({ maxLength: 4 }) }),
    responses: ok,
  },
  opt: { method: 'GET', path: '/opt', access: 'optional', responses: ok },
  priv: { method: 'GET', path: '/priv', access: { policy: 'p', action: 'a' }, responses: ok },
  bare: { method: 'GET', path: '/bare', responses: ok },
  mk: {
    method: 'POST',
    path: '/mk',
    access: { policy: 'p', action: 'a' },
    body: object({ x: string({ maxLength: 4 }) }),
    responses: ok,
  },
  put: {
    method: 'PUT',
    path: '/put',
    access: { policy: 'p', action: 'a' },
    body: object({ x: string({ maxLength: 4 }) }),
    responses: ok,
  },
  patch: {
    method: 'PATCH',
    path: '/patch',
    access: { policy: 'p', action: 'a' },
    body: object({ x: string({ maxLength: 4 }) }),
    responses: ok,
  },
  del: { method: 'DELETE', path: '/del', access: { policy: 'p', action: 'a' }, responses: ok },
  deny: { method: 'GET', path: '/deny', access: { policy: 'p', action: 'a' }, responses: ok },
  redir: { method: 'GET', path: '/redir', access: { policy: 'p', action: 'a' }, responses: ok },
});

interface Seen {
  readonly method: string;
  readonly path: string;
  readonly authorization: string | undefined;
  readonly csrf: string | undefined;
  readonly cookie: string | undefined;
}

interface Capture {
  readonly port: number;
  readonly seen: Seen[];
  readonly close: () => Promise<void>;
}

async function capture(redirectTo?: number): Promise<Capture> {
  const seen: Seen[] = [];
  const header = (req: IncomingMessage, name: string): string | undefined => {
    const value = req.headers[name];
    return typeof value === 'string' ? value : undefined;
  };
  const server = createHttpServer((req, res) => {
    seen.push({
      method: req.method ?? '',
      path: req.url ?? '',
      authorization: header(req, 'authorization'),
      csrf: header(req, 'x-csrf-token'),
      cookie: header(req, 'cookie'),
    });
    req.resume();
    if (req.url === '/redir' && redirectTo !== undefined) {
      res.writeHead(302, { location: `http://127.0.0.1:${redirectTo}/priv` }).end();
      return;
    }
    if (req.url === '/deny') {
      res
        .writeHead(401, { 'content-type': 'application/json' })
        .end('{"status":401,"code":"CREDENTIAL_INVALID","message":"x"}');
      return;
    }
    res.writeHead(200, { 'content-type': 'application/json' }).end('{"ok":"y"}');
  });
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('no address');
  }
  const port = (address satisfies AddressInfo).port;
  return {
    port,
    seen,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

interface InitSeen {
  credentials: string | undefined;
}

function spyFetch(log: InitSeen[]): typeof globalThis.fetch {
  return (input, init) => {
    log.push({ credentials: init?.credentials });
    return globalThis.fetch(input, init);
  };
}

async function failure(call: () => Promise<unknown>): Promise<unknown> {
  try {
    await call();
    return null;
  } catch (error) {
    return error;
  }
}

function isUnavailable(error: unknown, cause?: unknown): boolean {
  return (
    error instanceof HttpError &&
    error.code === 'CREDENTIAL_UNAVAILABLE' &&
    error.status === null &&
    error.message === 'Credential unavailable' &&
    (cause === undefined || error.cause === cause)
  );
}

async function bearerCases(): Promise<void> {
  const target = await capture();
  const inits: InitSeen[] = [];
  const token = 'tok-en.1_2~3+4/5==';
  try {
    const client = createClient(contract, {
      baseUrl: `http://127.0.0.1:${target.port}`,
      fetch: spyFetch(inits),
      credential: { kind: 'bearer', token: () => token },
    });
    await series(
      [
        ['priv', () => client.priv()],
        ['opt', () => client.opt()],
        ['bare', () => client.bare()],
        ['mk', () => client.mk({ body: { x: 'a' } })],
        ['put', () => client.put({ body: { x: 'a' } })],
        ['patch', () => client.patch({ body: { x: 'a' } })],
        ['del', () => client.del()],
      ] as const,
      async ([name, call]) => {
        const before = target.seen.length;
        await call();
        const last = target.seen[before];
        report.check(
          `[bearer] ${name}: authorization: Bearer <token> and no x-csrf-token or cookie`,
          last?.authorization === `Bearer ${token}` && last.csrf === undefined && last.cookie === undefined,
          JSON.stringify(last),
        );
      },
    );
    await series(
      [
        ['pub', () => client.pub()],
        ['pubPost', () => client.pubPost({ body: { x: 'a' } })],
      ] as const,
      async ([name, call]) => {
        const before = target.seen.length;
        await call();
        const last = target.seen[before];
        report.check(
          `[bearer] ${name} (public): no authorization header and no cookie`,
          last !== undefined && last.authorization === undefined && last.cookie === undefined,
          JSON.stringify(last),
        );
      },
    );
    report.check(
      '[bearer] every call, public or not, is fetched with credentials omit',
      inits.length === 9 && inits.every((entry) => entry.credentials === 'omit'),
      `${inits.map((entry) => entry.credentials).join(',')}`,
    );
  } finally {
    await target.close();
  }

  const other = await capture();
  const origin = await capture(other.port);
  try {
    const client = createClient(contract, {
      baseUrl: `http://127.0.0.1:${origin.port}`,
      credential: { kind: 'bearer', token: () => token },
    });
    const redirected = await failure(() => client.redir());
    report.check(
      '[bearer] a redirect to another origin is not followed: the call rejects and the other origin sees no request',
      redirected instanceof HttpError &&
        other.seen.length === 0 &&
        origin.seen.length === 1 &&
        origin.seen[0]?.authorization === `Bearer ${token}`,
      `${redirected instanceof HttpError ? redirected.code : String(redirected)}; first origin ${origin.seen.length} request(s); other origin ${other.seen.length}`,
    );
  } finally {
    await other.close();
    await origin.close();
  }

  const grammar = await capture();
  try {
    const grammarClient = (tokenFn: () => string | Promise<string>) =>
      createClient(contract, {
        baseUrl: `http://127.0.0.1:${grammar.port}`,
        credential: { kind: 'bearer', token: tokenFn },
      });
    const invalid: [string, () => string | Promise<string>][] = [
      ['an empty token', () => ''],
      ['a token of 4,097 characters', () => 'a'.repeat(4097)],
      ['a token with a space', () => 'a b'],
      ['a token with a line break', () => 'ab\r\ncd'],
      ['a token with a brace', () => '{ab}'],
      ['a token with a non-ASCII character', () => 'abé'],
      ['a number', () => JSON.parse('5')],
      ['undefined', () => JSON.parse('null')],
      ['a promise of an empty token', () => Promise.resolve('')],
    ];
    await series(invalid, async ([name, tokenFn]) => {
      const before = grammar.seen.length;
      const error = await failure(() => grammarClient(tokenFn).priv());
      report.check(
        `[bearer] ${name}: CREDENTIAL_UNAVAILABLE, status null, no request sent`,
        isUnavailable(error) && grammar.seen.length === before,
        error instanceof Error ? `${error.name} ${error.message}` : String(error),
      );
    });
    const boom = new Error('token source down');
    const throwing = await failure(() =>
      grammarClient(() => {
        throw boom;
      }).priv(),
    );
    report.check(
      '[bearer] a token function that throws: CREDENTIAL_UNAVAILABLE with the cause kept',
      isUnavailable(throwing, boom),
      String(throwing),
    );
    const rejecting = await failure(() => grammarClient(() => Promise.reject(boom)).priv());
    report.check(
      '[bearer] a token function that rejects: CREDENTIAL_UNAVAILABLE with the cause kept',
      isUnavailable(rejecting, boom),
      String(rejecting),
    );
    report.check(
      '[bearer] the thrown text is in no message',
      !(throwing instanceof Error && throwing.message.includes('source down')),
    );
    await series(
      [
        ['one character', 'a'],
        ['4,096 characters', 'a'.repeat(4096)],
        ['every b64token character and padding', 'AZaz09-._~+/=='],
      ] as const,
      async ([name, value]) => {
        const before = grammar.seen.length;
        const result = await failure(() => grammarClient(() => value).priv());
        report.check(
          `[bearer] ${name}: accepted and sent`,
          result === null && grammar.seen[before]?.authorization === `Bearer ${value}`,
          String(result),
        );
      },
    );
    const publicWithBadToken = await failure(() => grammarClient(() => '').pub());
    report.note(
      `[bearer] observation: a public call with a failing token function resolves: ${publicWithBadToken === null}`,
    );
    const denied = await grammarClient(() => 'abc').deny();
    const calls = grammar.seen.filter((entry) => entry.path === '/deny').length;
    report.check(
      '[bearer] a 401 resolves like any status and is not retried',
      denied.status === 401 && calls === 1,
      `${denied.status}; requests ${calls}`,
    );
  } finally {
    await grammar.close();
  }
}

async function sessionCases(): Promise<void> {
  const target = await capture();
  const inits: InitSeen[] = [];
  let csrf: string | null = 'Csrf-Token_1';
  let tokenCalls = 0;
  try {
    const client = createClient(contract, {
      baseUrl: `http://127.0.0.1:${target.port}`,
      fetch: spyFetch(inits),
      credential: {
        kind: 'session',
        csrfToken: () => {
          tokenCalls++;
          return csrf;
        },
      },
    });
    await series(
      [
        ['mk (POST)', () => client.mk({ body: { x: 'a' } })],
        ['put (PUT)', () => client.put({ body: { x: 'a' } })],
        ['patch (PATCH)', () => client.patch({ body: { x: 'a' } })],
        ['del (DELETE)', () => client.del()],
      ] as const,
      async ([name, call]) => {
        const before = target.seen.length;
        await call();
        const last = target.seen[before];
        report.check(
          `[session] ${name} to a non-public route carries x-csrf-token and no authorization`,
          last?.csrf === 'Csrf-Token_1' && last.authorization === undefined,
          JSON.stringify(last),
        );
      },
    );
    await series(
      [
        ['priv (GET)', () => client.priv()],
        ['opt (GET)', () => client.opt()],
        ['pubPost (POST, public)', () => client.pubPost({ body: { x: 'a' } })],
        ['pub (GET, public)', () => client.pub()],
      ] as const,
      async ([name, call]) => {
        const before = target.seen.length;
        await call();
        const last = target.seen[before];
        report.check(
          `[session] ${name} carries no x-csrf-token and no authorization`,
          last !== undefined && last.csrf === undefined && last.authorization === undefined,
          JSON.stringify(last),
        );
      },
    );
    report.check(
      '[session] every call, public or not, is fetched with credentials include',
      inits.length === 8 && inits.every((entry) => entry.credentials === 'include'),
      inits.map((entry) => entry.credentials).join(','),
    );
    csrf = null;
    const before = target.seen.length;
    await client.mk({ body: { x: 'a' } });
    report.check(
      '[session] a null token sends no header and the call still goes out',
      target.seen[before]?.csrf === undefined,
      JSON.stringify(target.seen[before]),
    );
    csrf = 'Csrf-Token_1';
    const denied = await client.deny();
    report.check(
      '[session] a 401 resolves like any status; the token function is not called again for a retry',
      denied.status === 401 && target.seen.filter((entry) => entry.path === '/deny').length === 1 && tokenCalls <= 9,
      `${denied.status}`,
    );

    const gate = await capture();
    try {
      const bad: [string, () => string | null | Promise<string | null>][] = [
        ['an empty token', () => ''],
        ['a token of 257 characters', () => 'a'.repeat(257)],
        ['a token with a dot', () => 'ab.cd'],
        ['a token with a space', () => 'ab cd'],
        ['a token with a plus', () => 'ab+cd'],
        ['a number', () => JSON.parse('7')],
        ['a promise of an invalid token', () => Promise.resolve('a=')],
      ];
      await series(bad, async ([name, tokenFn]) => {
        const sessionClient = createClient(contract, {
          baseUrl: `http://127.0.0.1:${gate.port}`,
          credential: { kind: 'session', csrfToken: tokenFn },
        });
        const seenBefore = gate.seen.length;
        const error = await failure(() => sessionClient.mk({ body: { x: 'a' } }));
        report.check(
          `[session] ${name}: CREDENTIAL_UNAVAILABLE, no request sent`,
          isUnavailable(error) && gate.seen.length === seenBefore,
          String(error),
        );
      });
      const boom = new Error('csrf source down');
      const thrown = await failure(() =>
        createClient(contract, {
          baseUrl: `http://127.0.0.1:${gate.port}`,
          credential: {
            kind: 'session',
            csrfToken: () => {
              throw boom;
            },
          },
        }).mk({ body: { x: 'a' } }),
      );
      report.check(
        '[session] a token function that throws: CREDENTIAL_UNAVAILABLE with the cause kept',
        isUnavailable(thrown, boom),
        String(thrown),
      );
      const edge = createClient(contract, {
        baseUrl: `http://127.0.0.1:${gate.port}`,
        credential: { kind: 'session', csrfToken: () => 'a'.repeat(256) },
      });
      const edgeBefore = gate.seen.length;
      await edge.mk({ body: { x: 'a' } });
      report.check(
        '[session] a token of 256 characters is accepted and sent',
        gate.seen[edgeBefore]?.csrf === 'a'.repeat(256),
      );
    } finally {
      await gate.close();
    }
  } finally {
    await target.close();
  }
}

function creationCases(): void {
  const headerRoute = (access: 'public' | 'optional' | { policy: string; action: string } | undefined, name: string) =>
    defineContract({
      r: {
        method: 'GET',
        path: '/r',
        responses: ok,
        headers: object({ [name]: string({ maxLength: 8 }) }),
        ...(access === undefined ? {} : { access }),
      },
    });
  const create = (routes: ReturnType<typeof headerRoute>, kind: 'bearer' | 'session' | 'none'): string => {
    try {
      createClient(routes, {
        baseUrl: 'http://127.0.0.1:1',
        ...(kind === 'bearer' ? { credential: { kind: 'bearer', token: () => 'a' } } : {}),
        ...(kind === 'session' ? { credential: { kind: 'session', csrfToken: () => null } } : {}),
      });
      return 'created';
    } catch (error) {
      return error instanceof TypeError ? 'TypeError' : String(error);
    }
  };
  const policy = { policy: 'p', action: 'a' };
  const cases: [string, ReturnType<typeof headerRoute>, 'bearer' | 'session' | 'none', string][] = [
    [
      'a bearer client, a policy route declaring authorization',
      headerRoute(policy, 'authorization'),
      'bearer',
      'TypeError',
    ],
    [
      'a bearer client, a policy route declaring x-csrf-token (either name under either kind)',
      headerRoute(policy, 'x-csrf-token'),
      'bearer',
      'TypeError',
    ],
    [
      'a session client, a policy route declaring authorization',
      headerRoute(policy, 'authorization'),
      'session',
      'TypeError',
    ],
    [
      'a session client, a policy route declaring x-csrf-token',
      headerRoute(policy, 'x-csrf-token'),
      'session',
      'TypeError',
    ],
    [
      'a bearer client, an optional route declaring authorization',
      headerRoute('optional', 'authorization'),
      'bearer',
      'TypeError',
    ],
    [
      'a bearer client, a route with no access declaring authorization (counts as not public)',
      headerRoute(undefined, 'authorization'),
      'bearer',
      'TypeError',
    ],
    [
      'a session client, a route with no access declaring x-csrf-token',
      headerRoute(undefined, 'x-csrf-token'),
      'session',
      'TypeError',
    ],
    [
      'a bearer client, a public route declaring authorization',
      headerRoute('public', 'authorization'),
      'bearer',
      'created',
    ],
    [
      'a session client, a public route declaring x-csrf-token',
      headerRoute('public', 'x-csrf-token'),
      'session',
      'created',
    ],
    [
      'a client with no credential, a policy route declaring authorization',
      headerRoute(policy, 'authorization'),
      'none',
      'created',
    ],
    [
      'a client with no credential, a policy route declaring x-csrf-token',
      headerRoute(policy, 'x-csrf-token'),
      'none',
      'created',
    ],
    ['a bearer client, a policy route declaring another header', headerRoute(policy, 'x-trace'), 'bearer', 'created'],
  ];
  for (const [name, routes, kind, expected] of cases) {
    const result = create(routes, kind);
    report.check(`[creation] ${name}: ${expected}`, result === expected, result);
  }
}

function typeCases(): void {
  const header = `import { createClient } from '@skeld/core/client';\nimport { defineContract } from '@skeld/core/contract';\nimport { object, string } from '@skeld/core/schema';\nconst routes = defineContract({ r: { method: 'GET', path: '/r', responses: { 200: object({ ok: string({ maxLength: 2 }) }) } } });\n`;
  const probes = [
    `${header}createClient(routes, { baseUrl: 'http://127.0.0.1:1', credential: { kind: 'bearer', token: () => 'a' } });\n`,
    `${header}createClient(routes, { baseUrl: 'http://127.0.0.1:1', credential: { kind: 'session', csrfToken: () => null } });\n`,
    `${header}createClient(routes, { baseUrl: 'http://127.0.0.1:1', credential: { kind: 'bearer', token: () => 'a', csrfToken: () => null } }); // BAD\n`,
    `${header}createClient(routes, { baseUrl: 'http://127.0.0.1:1', credential: { kind: 'session', token: () => 'a' } }); // BAD\n`,
    `${header}createClient(routes, { baseUrl: 'http://127.0.0.1:1', credential: [{ kind: 'bearer', token: () => 'a' }, { kind: 'session', csrfToken: () => null }] }); // BAD\n`,
  ];
  const results = compileProbes(probes);
  report.check(
    '[type] a bearer credential and a session credential each compile',
    results[0]?.status === 0 && results[1]?.status === 0,
    `${results[0]?.errors.join(' ')} ${results[1]?.errors.join(' ')}`,
  );
  const bad = [2, 3, 4].map((index) => results[index]);
  report.check(
    '[type] one client takes one credential kind: a bearer with a csrfToken, a session with a token and a list of two are each a compile error',
    bad.every(
      (result) =>
        result !== undefined &&
        result.status !== 0 &&
        result.diagnostics.length > 0 &&
        result.diagnostics.every((d) => d.file === 'probe.ts'),
    ),
    bad.map((result) => result?.diagnostics.map((d) => `TS${d.code}@${d.line}`).join(',')).join(' | '),
  );
}

async function liveCases(kind: Kind): Promise<void> {
  const label = `[${kind}]`;
  const rig = await makeRig(kind, { attach: false });
  const observed = observe(rig.store);
  const app = await startApp({ store: observed.store });
  try {
    const issued = await app.keys.issue({ userId: 'alice', name: 'client key', scopes: ['docs:read'] });
    if (issued.kind !== 'issued') {
      throw new Error('issue failed');
    }
    const key = expose(issued.key);
    const bearer = createClient(appRoutes, { baseUrl: app.url, credential: { kind: 'bearer', token: () => key } });
    const docs = await bearer.docs();
    report.check(
      `${label} a bearer client with a live API key: the policy route answers 200 for api_key:alice`,
      docs.status === 200 && JSON.stringify(docs.body) === '{"who":"api_key:alice"}',
      `${docs.status} ${JSON.stringify(docs.body)}`,
    );
    const ping = await bearer.ping();
    report.check(`${label} a bearer client calling a public route: 200`, ping.status === 200, `${ping.status}`);
    const wrong = createClient(appRoutes, {
      baseUrl: app.url,
      credential: { kind: 'bearer', token: () => 'not-a-key' },
    });
    const refused = await wrong.docs();
    report.check(
      `${label} a bearer client with an unknown token: 401 resolves, www-authenticate Bearer`,
      refused.status === 401 && refused.headers.get('www-authenticate') === 'Bearer',
      `${refused.status}`,
    );
    const anonymous = createClient(appRoutes, { baseUrl: app.url });
    const missing = await anonymous.docs();
    report.check(`${label} a client with no credential: 401 resolves`, missing.status === 401, `${missing.status}`);

    const signed = await app.signIn('alice');
    if (signed.token === null) {
      throw new Error('sign-in failed');
    }
    let sessionCsrf: string | null = signed.csrf;
    const jar: typeof globalThis.fetch = (input, init) => {
      const headers = new Headers(init?.headers);
      if (init?.credentials === 'include') {
        headers.set('cookie', `__Host-skeld=${signed.token}`);
        headers.set('origin', 'http://127.0.0.1');
      }
      return globalThis.fetch(input, { ...init, headers });
    };
    const session = createClient(sessionRoutes, {
      baseUrl: app.url,
      fetch: jar,
      credential: { kind: 'session', csrfToken: () => sessionCsrf },
    });
    const state = await session.authSession();
    report.check(
      `${label} a session client reads its own state through the cookie`,
      state.status === 200 && JSON.stringify(state.body).includes('"userId":"alice"'),
      `${state.status}`,
    );
    sessionCsrf = null;
    const noToken = await session.authSignOut();
    report.check(
      `${label} sign-out with a null token sends no header: 403 CSRF_TOKEN_INVALID resolves and the session lives`,
      noToken.status === 403 &&
        JSON.stringify(noToken.body).includes('CSRF_TOKEN_INVALID') &&
        (await session.authSession()).status === 200,
      `${noToken.status}`,
    );
    sessionCsrf = signed.csrf;
    const signedOut = await session.authSignOut();
    const after = await session.authSession();
    report.check(
      `${label} sign-out with the session's token: 204 and the session is gone`,
      signedOut.status === 204 && after.status === 401,
      `${signedOut.status} then ${after.status}`,
    );
  } finally {
    await app.close();
    await rig.dispose();
  }
}

try {
  await report.run('[bearer] bearer client', bearerCases);
  await report.run('[session] session client', sessionCases);
  await report.run('[creation] creation checks', () => Promise.resolve(creationCases()));
  await report.run('[type] one credential kind per client', () => Promise.resolve(typeCases()));
  await series(rigKinds, async (kind) => {
    await report.run(`[${kind}] live gated server`, () => liveCases(kind));
  });
} finally {
  await cleanAll();
}
report.finish();
