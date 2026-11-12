// Does:  Proves the cross-site check on POST, PUT, PATCH and DELETE: the Origin and Sec-Fetch-Site table and its effects.
// Holds: A refused request reaches no hook, error handler or handler, and no refused origin is in stderr or a diag file.
// biome-ignore-all lint/performance/noAwaitInLoops: Serial requests keep each case's wire bytes apart.

import { randomBytes } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { BootError } from '@skeld/core/boot-error';
import { defineContract } from '@skeld/core/contract';
import { HttpError } from '@skeld/core/http-error';
import * as t from '@skeld/core/schema';
import { createServer, type CsrfPolicy, type RoutesOptions, type ServerOptions } from '@skeld/core/server';
import { check, conclude } from './support.ts';
import { startDiagChild } from './support-diag.ts';
import { jsonOf, request, type Wire } from './support-wire.ts';
import { startServerChild } from './support-typesystem.ts';

const statement =
  'for POST, PUT, PATCH and DELETE an Origin in publicOrigin or the route trustedOrigins passes whatever Sec-Fetch-Site says; any other Origin, null or garbage, another scheme or port, passes only with same-origin; no Origin passes with same-origin or none and is refused with any other value; neither header passes in baseline and is refused in strict; Origin equal to Host with no publicOrigin is refused and one stderr line says so once; an origin listed only in cors is refused and group trustedOrigins replace the server list; a refusal is 403 CROSS_ORIGIN with one body, connection close, reaches no hook (onResponse included), error handler or handler while an accepted request runs onRequest, preHandler, onSend and onResponse, and the next connection is served; GET and HEAD are never refused; csrfExempt routes pass every row; a group or server csrf mode that is null, a number, an unknown string or (under strict) undefined, and a null trustedOrigins or credentials, are refused; a route whose method accessor changes between reads is either refused or registered and served under GET, and a LOCK to it is never 2xx and never reaches the handler; routes named constructor and __proto__ are served; a route method other than GET, POST, PUT, PATCH or DELETE is refused when declared and a cross-site LOCK is never answered 200; under a strict server a group csrf object must state its mode, a baseline or strict group behaves as stated and one without csrf inherits; strict without publicOrigin, an unknown exempt name and a malformed origin are refused at boot; no refused origin is in stderr or a diag file';

const PUBLIC = 'https://api.example';
const TRUSTED = 'https://trusted.example';
const GROUP_TRUSTED = 'https://group.example';
const CORS_ONLY = 'https://cors-only.example';
const marker = randomBytes(6).toString('hex');
const OTHER = `https://other-${marker}.example`;
const GARBAGE = `garbage-${marker}`;
const ok = t.object({ ok: t.boolean() });
const methods = ['POST', 'PUT', 'PATCH', 'DELETE'] as const;

function groupContract(prefix: string) {
  return defineContract({
    ok: { method: 'GET', path: `/${prefix}/ok`, responses: { 200: ok } },
    post: { method: 'POST', path: `/${prefix}/post`, responses: { 200: ok } },
    put: { method: 'PUT', path: `/${prefix}/put`, responses: { 200: ok } },
    patch: { method: 'PATCH', path: `/${prefix}/patch`, responses: { 200: ok } },
    del: { method: 'DELETE', path: `/${prefix}/del`, responses: { 200: ok } },
  });
}
const countsContract = defineContract({
  counts: { method: 'GET', path: '/counts', responses: { 200: t.object({ report: t.string({ maxLength: 500 }) }) } },
});

const hookNames = ['onRequest', 'preHandler', 'onSend', 'onResponse', 'onError', 'errorHandler', 'handler'] as const;

async function serve(kind: string): Promise<void> {
  const counts = new Map<string, number>();
  const bump = (name: string, route: string) => {
    if (route !== 'counts') {
      counts.set(name, (counts.get(name) ?? 0) + 1);
    }
  };
  if (kind === 'noorigin') {
    const server = createServer();
    server.routes(groupContract('p'), {
      ok: () => ({ status: 200, body: { ok: true } }),
      post: () => ({ status: 200, body: { ok: true } }),
      put: () => ({ status: 200, body: { ok: true } }),
      patch: () => ({ status: 200, body: { ok: true } }),
      del: () => ({ status: 200, body: { ok: true } }),
    });
    const { port } = await server.listen({ port: 0, host: '127.0.0.1' });
    process.on('SIGTERM', () => void server.close().then(() => process.exit(0)));
    process.stdout.write(`listening ${port}\n`);
    return;
  }
  const server = createServer({
    publicOrigin: PUBLIC,
    cors: { origins: [CORS_ONLY] },
    csrf: { trustedOrigins: [TRUSTED] },
  });
  server.addHook('onRequest', (context) => bump('onRequest', context.route.name));
  server.addHook('preHandler', (context) => bump('preHandler', context.route.name));
  server.addHook('onSend', (context) => bump('onSend', context.route.name));
  server.addHook('onResponse', (context) => bump('onResponse', context.route.name));
  server.addHook('onError', (context) => bump('onError', context.route.name));
  server.setErrorHandler((error, context) => {
    bump('errorHandler', context.route.name);
    return error instanceof HttpError ? error : new HttpError(500, 'INTERNAL', 'Internal Server Error');
  });
  const handlerFor = (name: string) => () => {
    bump('handler', name);
    return { status: 200 as const, body: { ok: true } };
  };
  const handlers = {
    ok: handlerFor('ok'),
    post: handlerFor('post'),
    put: handlerFor('put'),
    patch: handlerFor('patch'),
    del: handlerFor('del'),
  };
  server.routes(countsContract, {
    counts: () => ({
      status: 200,
      body: { report: JSON.stringify(Object.fromEntries(hookNames.map((name) => [name, counts.get(name) ?? 0]))) },
    }),
  });
  server.routes(groupContract('g0'), handlers);
  server.routes(groupContract('g1'), handlers, { csrf: { trustedOrigins: [GROUP_TRUSTED] } });
  server.routes(groupContract('g2'), handlers, { csrf: { mode: 'strict' } });
  server.routes(groupContract('g3'), handlers, { csrfExempt: ['post', 'put', 'patch', 'del'] });
  const { port } = await server.listen({ port: 0, host: '127.0.0.1' });
  process.on('SIGTERM', () => void server.close().then(() => process.exit(0)));
  process.stdout.write(`listening ${port}\n`);
}

interface Group {
  prefix: string;
  trusted: readonly string[];
  strict: boolean;
  exempt: boolean;
  methods: readonly string[];
}
const groups: Group[] = [
  { prefix: 'g0', trusted: [PUBLIC, TRUSTED], strict: false, exempt: false, methods },
  { prefix: 'g1', trusted: [PUBLIC, GROUP_TRUSTED], strict: false, exempt: false, methods: ['POST'] },
  { prefix: 'g2', trusted: [PUBLIC], strict: true, exempt: false, methods: ['POST', 'DELETE'] },
  { prefix: 'g3', trusted: [PUBLIC], strict: false, exempt: true, methods: ['POST', 'PUT', 'PATCH', 'DELETE'] },
];
const origins: (string | null)[] = [
  PUBLIC,
  TRUSTED,
  GROUP_TRUSTED,
  CORS_ONLY,
  OTHER,
  'null',
  GARBAGE,
  'https://api.example:8443',
  'http://api.example',
  null,
];
const sites: (string | null)[] = ['same-origin', 'none', 'same-site', 'cross-site', 'bogus', null];
const pathOf: Record<string, string> = { POST: 'post', PUT: 'put', PATCH: 'patch', DELETE: 'del' };

function passes(group: Group, origin: string | null, site: string | null): boolean {
  if (group.exempt) {
    return true;
  }
  if (origin !== null) {
    return group.trusted.includes(origin) || site === 'same-origin';
  }
  if (site !== null) {
    return site === 'same-origin' || site === 'none';
  }
  return !group.strict;
}

function headersOf(origin: string | null, site: string | null): string[] {
  return [...(origin === null ? [] : [`origin: ${origin}`]), ...(site === null ? [] : [`sec-fetch-site: ${site}`])];
}

interface Tally {
  passed: number;
  refused: number;
  followUps: number;
}

function judgeRefusal(problems: string[], label: string, wire: Wire, bodies: Set<string>): void {
  const body = jsonOf(wire.body);
  check(problems, wire.status === 403, `${label}: status ${wire.status}, expected 403`);
  check(problems, body.code === 'CROSS_ORIGIN' && body.status === 403, `${label}: body ${wire.body}`);
  check(
    problems,
    wire
      .all('connection')
      .map((value) => value.toLowerCase())
      .includes('close'),
    `${label}: no connection: close`,
  );
  check(problems, !wire.raw.toLowerCase().includes(marker), `${label}: the origin is in the response`);
  bodies.add(wire.body);
}

async function matrix(problems: string[], port: number, bodies: Set<string>): Promise<Tally> {
  const tally: Tally = { passed: 0, refused: 0, followUps: 0 };
  for (const group of groups) {
    for (const method of group.methods) {
      for (const origin of origins) {
        for (const site of sites) {
          const label = `${group.prefix} ${method} origin ${origin === null ? '-' : origin.replace(marker, 'M')} site ${site ?? '-'}`;
          const wire = await request(port, method, `/${group.prefix}/${pathOf[method]}`, [
            ...headersOf(origin, site),
            'content-length: 0',
          ]);
          if (passes(group, origin, site)) {
            tally.passed++;
            check(
              problems,
              wire.status === 200 && jsonOf(wire.body).ok === true,
              `${label}: status ${wire.status}, expected 200 ${wire.body}`,
            );
            continue;
          }
          tally.refused++;
          judgeRefusal(problems, label, wire, bodies);
          const next = await request(port, 'GET', '/g0/ok');
          tally.followUps++;
          check(problems, next.status === 200, `${label}: the next request answered ${next.status}`);
        }
      }
    }
  }
  return tally;
}

async function counted(port: number): Promise<Record<string, unknown>> {
  const wire = await request(port, 'GET', '/counts');
  const report = jsonOf(wire.body).report;
  return typeof report === 'string' ? jsonOf(report) : {};
}

async function hookDelta(port: number, send: () => Promise<Wire>): Promise<[Record<string, unknown>, Wire]> {
  const before = await counted(port);
  const wire = await send();
  await delay(300);
  const after = await counted(port);
  const delta = Object.fromEntries(hookNames.map((name) => [name, Number(after[name]) - Number(before[name])]));
  return [delta, wire];
}

async function singleRequests(problems: string[], port: number): Promise<void> {
  const [accepted, passWire] = await hookDelta(port, () =>
    request(port, 'POST', '/g0/post', [`origin: ${PUBLIC}`, 'content-length: 0']),
  );
  check(problems, passWire.status === 200, `the accepted POST answered ${passWire.status}`);
  for (const name of ['onRequest', 'preHandler', 'onSend', 'onResponse', 'handler']) {
    check(problems, accepted[name] === 1, `an accepted POST ran ${name} ${accepted[name]} times, expected 1`);
  }
  for (const name of ['onError', 'errorHandler']) {
    check(problems, accepted[name] === 0, `an accepted POST ran ${name}`);
  }
  const [refused, failWire] = await hookDelta(port, () =>
    request(port, 'POST', '/g0/post', [`origin: ${OTHER}`, 'content-length: 0']),
  );
  check(problems, failWire.status === 403, `the refused POST answered ${failWire.status}`);
  for (const name of hookNames) {
    check(problems, refused[name] === 0, `a refused POST ran ${name} ${refused[name]} times, expected 0`);
  }
}

async function safeMethods(problems: string[], port: number): Promise<void> {
  for (const prefix of ['g0', 'g2']) {
    for (const method of ['GET', 'HEAD']) {
      for (const site of ['cross-site', 'same-site', 'bogus']) {
        const wire = await request(port, method, `/${prefix}/ok`, [`origin: ${OTHER}`, `sec-fetch-site: ${site}`]);
        check(problems, wire.status === 200, `${method} /${prefix}/ok with ${site}: status ${wire.status}`);
      }
      const bare = await request(port, method, `/${prefix}/ok`, ['origin: null']);
      check(problems, bare.status === 200, `${method} /${prefix}/ok with Origin null: status ${bare.status}`);
    }
  }
}

async function bootOutcome(make: () => Promise<void>): Promise<string> {
  try {
    await make();
    return 'accepted';
  } catch (error) {
    return error instanceof BootError ? error.code : `threw ${error instanceof Error ? error.name : 'unknown'}`;
  }
}

type GroupOptions = RoutesOptions<ReturnType<typeof groupContract>>;

function pastTypes(value: unknown): never {
  // biome-ignore lint/nursery/noUnsafeTypeAssertion: the probe names a route the contract lacks, to see the boot refusal
  return value as never;
}

async function boots(options: ServerOptions, group: GroupOptions = {}): Promise<void> {
  const server = createServer(options);
  const done = () => ({ status: 200 as const, body: { ok: true } });
  server.routes(groupContract('x'), { ok: done, post: done, put: done, patch: done, del: done }, group);
  await server.listen({ port: 0, host: '127.0.0.1' });
  await server.close();
}

const noMethodRoute = { ok: () => ({ status: 200 as const, body: { ok: true } }) };

async function declaredMethod(method: unknown): Promise<string> {
  try {
    const contract = defineContract({ r: { method: pastTypes(method), path: '/r', responses: { 200: ok } } });
    const server = createServer();
    server.routes(contract, { r: noMethodRoute.ok });
    const { port } = await server.listen({ port: 0, host: '127.0.0.1' });
    const wire = await request(port, String(method), '/r', [
      'origin: https://evil.example',
      'sec-fetch-site: cross-site',
    ]);
    await server.close();
    return `served, a cross-site ${String(method)} /r answered ${wire.status}`;
  } catch (error) {
    return error instanceof Error ? 'refused' : 'threw a non-error';
  }
}

async function methodChecks(problems: string[]): Promise<number> {
  const bad: unknown[] = ['LOCK', 'OPTIONS', 'HEAD', 'get', '', 42];
  for (const method of bad) {
    const outcome = await declaredMethod(method);
    check(problems, outcome === 'refused', `route method ${JSON.stringify(method)}: ${outcome}`);
  }
  const server = createServer({ publicOrigin: PUBLIC });
  const contract = defineContract({
    get: { method: 'GET', path: '/r', responses: { 200: ok } },
    post: { method: 'POST', path: '/r', responses: { 200: ok } },
    put: { method: 'PUT', path: '/r', responses: { 200: ok } },
    patch: { method: 'PATCH', path: '/r', responses: { 200: ok } },
    del: { method: 'DELETE', path: '/r', responses: { 200: ok } },
  });
  server.routes(contract, {
    get: noMethodRoute.ok,
    post: noMethodRoute.ok,
    put: noMethodRoute.ok,
    patch: noMethodRoute.ok,
    del: noMethodRoute.ok,
  });
  const { port } = await server.listen({ port: 0, host: '127.0.0.1' });
  try {
    for (const method of ['LOCK', 'PROPFIND', 'MKCOL']) {
      const wire = await request(port, method, '/r', ['origin: https://evil.example', 'sec-fetch-site: cross-site']);
      check(problems, wire.status !== 200, `a cross-site ${method} /r answered ${wire.status}`);
    }
  } finally {
    await server.close();
  }
  return bad.length + 3;
}

type Behaviour = 'INVALID_OPTION' | 'baseline' | 'strict' | string;

async function groupBehaviour(options: ServerOptions, group: GroupOptions): Promise<Behaviour> {
  let server: ReturnType<typeof createServer> | null = null;
  try {
    server = createServer(options);
    const done = () => ({ status: 200 as const, body: { ok: true } });
    server.routes(groupContract('x'), { ok: done, post: done, put: done, patch: done, del: done }, group);
    const { port } = await server.listen({ port: 0, host: '127.0.0.1' });
    const wire = await request(port, 'POST', '/x/post', ['content-length: 0']);
    await server.close();
    server = null;
    return wire.status === 200 ? 'baseline' : wire.status === 403 ? 'strict' : `status ${wire.status}`;
  } catch (error) {
    await server?.close().catch(() => undefined);
    return error instanceof BootError ? error.code : `threw ${error instanceof Error ? error.name : 'unknown'}`;
  }
}

async function groupModeChecks(problems: string[]): Promise<number> {
  const strictServer: ServerOptions = { publicOrigin: PUBLIC, csrf: { mode: 'strict' } };
  const baselineServer: ServerOptions = { publicOrigin: PUBLIC };
  const rows: [string, ServerOptions, GroupOptions, Behaviour][] = [
    ['strict server, group csrf without mode', strictServer, { csrf: {} }, 'INVALID_OPTION'],
    [
      'strict server, group trustedOrigins without mode',
      strictServer,
      { csrf: { trustedOrigins: [TRUSTED] } },
      'INVALID_OPTION',
    ],
    ['strict server, group mode baseline', strictServer, { csrf: { mode: 'baseline' } }, 'baseline'],
    ['strict server, group mode strict', strictServer, { csrf: { mode: 'strict' } }, 'strict'],
    ['strict server, group without csrf', strictServer, {}, 'strict'],
    ['baseline server, group csrf without mode', baselineServer, { csrf: {} }, 'baseline'],
    [
      'baseline server, group trustedOrigins without mode',
      baselineServer,
      { csrf: { trustedOrigins: [TRUSTED] } },
      'baseline',
    ],
    ['baseline server, group mode strict', baselineServer, { csrf: { mode: 'strict' } }, 'strict'],
    ['baseline server, group without csrf', baselineServer, {}, 'baseline'],
    [
      'explicit baseline server, group csrf without mode',
      { publicOrigin: PUBLIC, csrf: { mode: 'baseline' } },
      { csrf: {} },
      'baseline',
    ],
  ];
  for (const [label, options, group, expected] of rows) {
    const outcome = await groupBehaviour(options, group);
    check(problems, outcome === expected, `${label}: ${outcome}, expected ${expected}`);
  }
  return rows.length;
}

async function unstatedValueChecks(problems: string[]): Promise<number> {
  const strictServer: ServerOptions = { publicOrigin: PUBLIC, csrf: { mode: 'strict' } };
  const baselineServer: ServerOptions = { publicOrigin: PUBLIC };
  const refused: [string, ServerOptions, GroupOptions][] = [
    ['strict server, group mode null', strictServer, { csrf: pastTypes({ mode: null }) }],
    ['strict server, group mode undefined', strictServer, { csrf: pastTypes({ mode: undefined }) }],
    ['strict server, group csrf {}', strictServer, { csrf: {} }],
    ['group mode null', baselineServer, { csrf: pastTypes({ mode: null }) }],
    ['group mode a number', baselineServer, { csrf: pastTypes({ mode: 1 }) }],
    ['group mode an unknown string', baselineServer, { csrf: pastTypes({ mode: 'loose' }) }],
    ['server mode null', { publicOrigin: PUBLIC, csrf: pastTypes({ mode: null }) }, {}],
    ['server mode a number', { publicOrigin: PUBLIC, csrf: pastTypes({ mode: 0 }) }, {}],
    ['server mode an unknown string', { publicOrigin: PUBLIC, csrf: pastTypes({ mode: 'Strict' }) }, {}],
    ['group trustedOrigins null', baselineServer, { csrf: pastTypes({ trustedOrigins: null }) }],
    ['server trustedOrigins null', { publicOrigin: PUBLIC, csrf: pastTypes({ trustedOrigins: null }) }, {}],
    ['group cors credentials null', baselineServer, { cors: pastTypes({ origins: [PUBLIC], credentials: null }) }],
    ['server cors credentials null', { cors: pastTypes({ origins: [PUBLIC], credentials: null }) }, {}],
  ];
  for (const [label, options, group] of refused) {
    const outcome = await groupBehaviour(options, group);
    check(problems, outcome === 'INVALID_OPTION', `${label}: ${outcome}, expected INVALID_OPTION`);
  }
  return refused.length;
}

async function accessorEntry(problems: string[], entry: 'plain' | 'defined'): Promise<string> {
  let reads = 0;
  let handled = 0;
  const route = {
    path: '/acc',
    responses: { 200: ok },
    get method() {
      reads++;
      return reads === 1 ? 'GET' : 'LOCK';
    },
  };
  const server = createServer();
  let outcome = 'refused';
  try {
    const contract = entry === 'defined' ? defineContract({ acc: pastTypes(route) }) : pastTypes({ acc: route });
    server.routes(contract, {
      acc: () => {
        handled++;
        return { status: 200 as const, body: { ok: true } };
      },
    });
    const { port } = await server.listen({ port: 0, host: '127.0.0.1' });
    outcome = 'registered';
    const got = await request(port, 'GET', '/acc');
    check(
      problems,
      got.status === 200 && handled === 1,
      `${entry}: a registered accessor route answered GET ${got.status}`,
    );
    const lock = await request(port, 'LOCK', '/acc', ['origin: https://evil.example', 'sec-fetch-site: cross-site']);
    check(problems, lock.status < 200 || lock.status >= 300, `${entry}: LOCK /acc answered ${lock.status}`);
    check(problems, handled === 1, `${entry}: the handler ran ${handled} times after a GET and a LOCK`);
  } catch (error) {
    check(problems, error instanceof Error && outcome === 'refused', `${entry}: unexpected ${String(error)}`);
  } finally {
    await server.close();
  }
  process.stderr.write(`accessor ${entry}: ${outcome} after ${reads} reads\n`);
  return outcome;
}

async function accessorMethod(problems: string[]): Promise<number> {
  await accessorEntry(problems, 'plain');
  await accessorEntry(problems, 'defined');
  return 2;
}

async function prototypeNames(problems: string[]): Promise<number> {
  const names = ['constructor', 'toString', 'hasOwnProperty', '__proto__'];
  const routes = Object.fromEntries(
    names.map((name, index) => [name, { method: 'GET', path: `/proto${index}`, responses: { 200: ok } }]),
  );
  const handlers = Object.fromEntries(names.map((name) => [name, noMethodRoute.ok]));
  const server = createServer();
  try {
    server.routes(defineContract(pastTypes(routes)), pastTypes(handlers));
    const { port } = await server.listen({ port: 0, host: '127.0.0.1' });
    for (const [index, name] of names.entries()) {
      const wire = await request(port, 'GET', `/proto${index}`);
      check(problems, wire.status === 200, `route named ${name}: GET answered ${wire.status}`);
    }
  } catch (error) {
    check(problems, false, `a contract with prototype-like route names was refused: ${String(error)}`);
  } finally {
    await server.close();
  }
  return names.length;
}

async function bootChecks(problems: string[]): Promise<number> {
  const strict: CsrfPolicy = { mode: 'strict' };
  const refused: [string, () => Promise<void>][] = [
    ['strict on the server without publicOrigin', () => boots({ csrf: strict })],
    ['strict on a group without publicOrigin', () => boots({}, { csrf: strict })],
    ['unknown exempt name', () => boots({}, { csrfExempt: pastTypes(['nope']) })],
    ['publicOrigin with a path', () => boots({ publicOrigin: 'https://api.example/app' })],
    ['publicOrigin with a trailing slash', () => boots({ publicOrigin: 'https://api.example/' })],
    ['publicOrigin without a scheme', () => boots({ publicOrigin: 'api.example' })],
    ['publicOrigin list with one bad entry', () => boots({ publicOrigin: [PUBLIC, 'ftp://api.example'] })],
    ['trustedOrigins with a path', () => boots({ csrf: { trustedOrigins: ['https://t.example/x'] } })],
    ['group trustedOrigins malformed', () => boots({}, { csrf: { trustedOrigins: ['null'] } })],
  ];
  const accepted: [string, () => Promise<void>][] = [
    ['strict with publicOrigin', () => boots({ publicOrigin: PUBLIC, csrf: strict })],
    ['strict group with publicOrigin', () => boots({ publicOrigin: PUBLIC }, { csrf: strict })],
    ['publicOrigin list', () => boots({ publicOrigin: [PUBLIC, 'https://www.api.example'] })],
    ['a known exempt name', () => boots({}, { csrfExempt: ['post'] })],
  ];
  for (const [label, make] of refused) {
    const outcome = await bootOutcome(make);
    check(problems, outcome === 'INVALID_OPTION', `${label}: ${outcome}`);
  }
  for (const [label, make] of accepted) {
    const outcome = await bootOutcome(make);
    check(problems, outcome === 'accepted', `${label}: ${outcome}`);
  }
  return refused.length + accepted.length;
}

async function noOrigin(problems: string[]): Promise<void> {
  const child = await startServerChild(fileURLToPath(import.meta.url), 'noorigin');
  try {
    const own = await request(child.port, 'POST', '/p/post', [
      `host: 127.0.0.1:${child.port}`,
      `origin: http://127.0.0.1:${child.port}`,
      'content-length: 0',
    ]);
    check(
      problems,
      own.status === 403 && jsonOf(own.body).code === 'CROSS_ORIGIN',
      `Origin equal to Host without publicOrigin: ${own.status} ${own.body}`,
    );
    const foreign = await request(child.port, 'PUT', '/p/put', [
      `origin: http://csrf-${marker}.example`,
      'content-length: 0',
    ]);
    check(problems, foreign.status === 403, `a foreign Origin without publicOrigin: ${foreign.status}`);
    const again = await request(child.port, 'DELETE', '/p/del', [
      `origin: http://csrf-${marker}.example`,
      'content-length: 0',
    ]);
    check(problems, again.status === 403, `a second foreign Origin: ${again.status}`);
    const attested = await request(child.port, 'POST', '/p/post', [
      `origin: http://csrf-${marker}.example`,
      'sec-fetch-site: same-origin',
      'content-length: 0',
    ]);
    check(problems, attested.status === 200, `same-origin attestation without publicOrigin: ${attested.status}`);
    const bare = await request(child.port, 'POST', '/p/post', ['content-length: 0']);
    check(problems, bare.status === 200, `neither header without publicOrigin in baseline: ${bare.status}`);
  } finally {
    await child.stop();
  }
  const lines = child
    .stderr()
    .split('\n')
    .filter((line) => line.includes('publicOrigin'));
  check(
    problems,
    lines.length === 1,
    `${lines.length} stderr lines mention publicOrigin, expected exactly 1: ${lines.join(' | ')}`,
  );
  check(
    problems,
    lines[0]?.includes('post') === true || lines[0]?.includes('put') === true,
    `the stderr hint does not name the route: ${lines[0]}`,
  );
  check(
    problems,
    !child.stderr().includes(marker) && !child.stderr().includes('127.0.0.1:'),
    'an origin appears in stderr',
  );
}

async function prove(): Promise<void> {
  const problems: string[] = [];
  const bodies = new Set<string>();
  const child = await startServerChild(fileURLToPath(import.meta.url), 'main');
  let tally: Tally = { passed: 0, refused: 0, followUps: 0 };
  try {
    tally = await matrix(problems, child.port, bodies);
    await delay(300);
    const counts = await counted(child.port);
    check(
      problems,
      counts.onRequest === tally.passed + tally.followUps,
      `onRequest ran ${counts.onRequest} times for ${tally.passed + tally.followUps} requests that may run it`,
    );
    check(
      problems,
      counts.preHandler === tally.passed + tally.followUps,
      `preHandler ran ${counts.preHandler} times, expected ${tally.passed + tally.followUps}`,
    );
    check(
      problems,
      counts.handler === tally.passed + tally.followUps,
      `the handlers ran ${counts.handler} times, expected ${tally.passed + tally.followUps}`,
    );
    for (const name of ['onSend', 'onResponse']) {
      check(
        problems,
        counts[name] === tally.passed + tally.followUps,
        `${name} ran ${counts[name]} times, expected ${tally.passed + tally.followUps}`,
      );
    }
    await singleRequests(problems, child.port);
    check(
      problems,
      counts.onError === 0 && counts.errorHandler === 0,
      `onError ${counts.onError} and the error handler ${counts.errorHandler} ran for refusals`,
    );
    await safeMethods(problems, child.port);
  } finally {
    await child.stop();
  }
  check(
    problems,
    bodies.size === 1,
    `refusals answered ${bodies.size} different bodies: ${[...bodies].join(' | ').slice(0, 300)}`,
  );
  check(problems, !child.stderr().includes(marker), 'a refused origin appears in stderr');

  const diagChild = await startDiagChild(fileURLToPath(import.meta.url));
  const diagTally = await matrix([], diagChild.port, new Set());
  const files = await diagChild.stopAndRead();
  check(problems, diagTally.refused > 0, 'the diag child refused nothing');
  check(problems, !files.text.includes(marker), 'a refused origin appears in a diag file');
  check(problems, !diagChild.stderr().includes(marker), 'a refused origin appears in the diag child stderr');
  check(problems, files.text.includes('refuse.csrf'), 'the diag files hold no refuse.csrf event');

  await noOrigin(problems);
  const boot =
    (await bootChecks(problems)) +
    (await methodChecks(problems)) +
    (await groupModeChecks(problems)) +
    (await unstatedValueChecks(problems)) +
    (await accessorMethod(problems)) +
    (await prototypeNames(problems));
  process.stderr.write(`${JSON.stringify({ ...tally, bodies: bodies.size, boot, diagRefused: diagTally.refused })}\n`);
  conclude(statement, problems);
}

if (process.argv[2] === 'serve') {
  await serve(process.argv[3] ?? 'main');
} else {
  await prove();
}
