// Does:  Proves the CORS policy: grants on actual responses, vary, preflights, scoping, boot refusals, reserved names.
// Holds: Responses are read as raw header lines, and a request that is not allowed gets no access-control header.

// biome-ignore-all lint/performance/noAwaitInLoops: Serial requests keep each case's wire bytes apart.

import { fileURLToPath } from 'node:url';
import { BootError } from '@skeld/core/boot-error';
import { defineContract } from '@skeld/core/contract';
import { HttpError } from '@skeld/core/http-error';
import * as t from '@skeld/core/schema';
import { createServer, type CorsPolicy, type RequestContext } from '@skeld/core/server';
import { check, conclude } from '../support/support.ts';
import { jsonOf, request, type Wire } from '../support/support-wire.ts';
import { startServerChild } from '../support/support-typesystem.ts';

const statement =
  'with no policy no access-control header appears and OPTIONS is 404; under a list policy an allowed origin gets its grant on a 200, a validation 400, a thrown 401, a thrown 500, a 503 timeout and the CSRF 403 and a disallowed origin or none gets no access-control header, vary holds Origin on every response of the route and keeps an author token; * sends * and no Origin in vary; credentials send true exactly; a group policy replaces the server policy whole, omitted inherits, false disables; an allowed preflight is 204 with the requested method, the route fixed header list, max-age and the security headers, whatever headers were requested; a disallowed origin is 403 CROSS_ORIGIN; an unknown path or method, a route without a policy and an OPTIONS that is not a preflight are not granted; no hook runs for a preflight; a policy of * with credentials is refused at boot; the six access-control names are a runtime refusal in any letter case with and without a policy';

const A = 'https://a.example';
const B = 'https://b.example';
const EVIL = 'https://evil.example';
const PUBLIC = 'https://api.example';
const fixed500 = '{"status":500,"code":"INTERNAL","message":"Internal Server Error"}';
const corsNames = [
  'access-control-allow-origin',
  'access-control-allow-credentials',
  'access-control-expose-headers',
  'access-control-allow-methods',
  'access-control-allow-headers',
  'access-control-max-age',
];
const securityNames = ['x-content-type-options', 'content-security-policy', 'x-frame-options', 'cache-control'];

const ok = t.object({ ok: t.boolean() });

function groupContract(prefix: string) {
  return defineContract({
    ok: { method: 'GET', path: `/${prefix}/ok`, responses: { 200: ok } },
    val: {
      method: 'GET',
      path: `/${prefix}/val`,
      query: t.object({ n: t.integer({ minimum: 0 }) }),
      responses: { 200: ok },
    },
    unauth: { method: 'GET', path: `/${prefix}/unauth`, responses: { 200: ok } },
    boom: { method: 'GET', path: `/${prefix}/boom`, responses: { 200: ok } },
    hang: { method: 'GET', path: `/${prefix}/hang`, responses: { 200: ok } },
    hookvary: { method: 'GET', path: `/${prefix}/hookvary`, responses: { 200: ok } },
    replyvary: { method: 'GET', path: `/${prefix}/replyvary`, responses: { 200: ok } },
    hdr: {
      method: 'GET',
      path: `/${prefix}/hdr`,
      headers: t.object({ 'x-token': t.string({ maxLength: 16 }), 'x-other': t.optional(t.string({ maxLength: 16 })) }),
      responses: { 200: ok },
    },
    post: {
      method: 'POST',
      path: `/${prefix}/post`,
      body: t.object({ a: t.string({ maxLength: 16 }) }),
      responses: { 200: ok },
    },
    put: { method: 'PUT', path: `/${prefix}/put`, responses: { 200: ok } },
    rhonrequest: { method: 'GET', path: `/${prefix}/rhonrequest`, responses: { 200: ok } },
    rhhooksend: { method: 'GET', path: `/${prefix}/rhhooksend`, responses: { 200: ok } },
    rhhandler: { method: 'GET', path: `/${prefix}/rhhandler`, responses: { 200: ok } },
  });
}

const countsContract = defineContract({
  counts: { method: 'GET', path: '/counts', responses: { 200: t.object({ report: t.string({ maxLength: 500 }) }) } },
});

function pastTypes(value: unknown): never {
  // biome-ignore lint/nursery/noUnsafeTypeAssertion: the probe passes values the declared types refuse, to see what the wire does
  return value as never;
}

function headerOf(headers: Record<string, string | readonly string[] | undefined>, name: string): string | null {
  const value = headers[name];
  return typeof value === 'string' ? value : null;
}

function probeHook(context: RequestContext): void {
  const name = headerOf(context.headers, 'x-probe');
  if (context.route.name === 'hookvary') {
    context.setHeader('vary', 'accept-encoding');
  } else if (name !== null && context.route.name === 'rhonrequest') {
    context.setHeader(pastTypes(name), 'zz-probe');
  } else if (name !== null && context.route.name === 'rhhooksend') {
    context.send({ status: 200, headers: pastTypes({ [name]: 'zz-probe' }), payload: '{"ok":true}' });
  }
}

function handlers() {
  const done = () => ({ status: 200 as const, body: { ok: true } });
  return {
    ok: done,
    val: done,
    unauth: () => {
      throw new HttpError(401, 'UNAUTH', 'no');
    },
    boom: () => {
      throw new Error('boom');
    },
    hang: () => new Promise<never>(() => undefined),
    hookvary: done,
    replyvary: () => ({ ...done(), headers: { vary: 'accept-language' } }),
    hdr: done,
    post: done,
    put: done,
    rhonrequest: done,
    rhhooksend: done,
    rhhandler: (call: { headers: unknown }) => {
      const name = headerOf(pastTypes(call.headers), 'x-probe');
      return name === null ? done() : { ...done(), headers: pastTypes({ [name]: 'zz-probe' }) };
    },
  };
}

function countHooks(server: ReturnType<typeof createServer>, counts: Map<string, number>): void {
  const bump = (name: string, route: string) => {
    if (route !== 'counts') {
      counts.set(name, (counts.get(name) ?? 0) + 1);
    }
  };
  server.addHook('onRequest', (context) => {
    bump('onRequest', context.route.name);
    probeHook(context);
  });
  server.addHook('preHandler', (context) => bump('preHandler', context.route.name));
  server.addHook('onSend', (context) => bump('onSend', context.route.name));
  server.addHook('onResponse', (context) => bump('onResponse', context.route.name));
  server.addHook('onError', (context) => bump('onError', context.route.name));
}

interface MutablePolicy {
  origins: string[];
  credentials?: boolean;
  allowedHeaders?: string[];
  exposedHeaders?: string[];
  maxAgeSeconds?: number;
}

async function serve(kind: string): Promise<void> {
  const counts = new Map<string, number>();
  if (kind === 'plain') {
    const server = createServer({ handlerTimeoutMs: 300 });
    countHooks(server, counts);
    server.routes(groupContract('n'), handlers());
    const { port } = await server.listen({ port: 0, host: '127.0.0.1' });
    process.on('SIGTERM', () => void server.close().then(() => process.exit(0)));
    process.stdout.write(`listening ${port}\n`);
    return;
  }
  const serverCors: MutablePolicy = { origins: [A], allowedHeaders: ['x-a-extra'] };
  const server = createServer({ handlerTimeoutMs: 300, publicOrigin: PUBLIC, cors: serverCors });
  countHooks(server, counts);
  server.routes(countsContract, {
    counts: () => ({
      status: 200,
      body: {
        report: JSON.stringify(
          Object.fromEntries(
            ['onRequest', 'preHandler', 'onSend', 'onResponse', 'onError'].map((name) => [name, counts.get(name) ?? 0]),
          ),
        ),
      },
    }),
  });
  const groupB: MutablePolicy = {
    origins: [B],
    credentials: true,
    allowedHeaders: ['x-b-extra'],
    exposedHeaders: ['x-b-expose'],
    maxAgeSeconds: 120,
  };
  const star: CorsPolicy = { origins: '*' };
  server.routes(groupContract('inherit'), handlers());
  server.routes(groupContract('own'), handlers(), { cors: groupB });
  server.routes(groupContract('off'), handlers(), { cors: false });
  server.routes(groupContract('star'), handlers(), { cors: star });
  const { port } = await server.listen({ port: 0, host: '127.0.0.1' });
  process.on('SIGTERM', () => void server.close().then(() => process.exit(0)));
  process.stdout.write(`listening ${port}\n`);
}

const corsLines = (wire: Wire) => wire.names().filter((name) => name.startsWith('access-control-'));
const set = (values: readonly string[]) => [...new Set(values)].sort().join(',');

interface Group {
  prefix: string;
  allowed: string[];
  disallowed: string[];
  credentials: boolean;
  expose: string | null;
}
const groups: Group[] = [
  { prefix: 'inherit', allowed: [A], disallowed: [B, EVIL], credentials: false, expose: null },
  { prefix: 'own', allowed: [B], disallowed: [A, EVIL], credentials: true, expose: 'x-b-expose' },
];
const routedCases: [string, string, string, number][] = [
  ['200', 'GET', '/ok', 200],
  ['validation 400', 'GET', '/val?n=abc', 400],
  ['thrown 401', 'GET', '/unauth', 401],
  ['thrown 500', 'GET', '/boom', 500],
  ['503 timeout', 'GET', '/hang', 503],
  ['CSRF 403', 'POST', '/post', 403],
];

function originLine(origin: string | null): string[] {
  return origin === null ? [] : [`origin: ${origin}`];
}

async function grants(problems: string[], port: number): Promise<number> {
  let n = 0;
  for (const group of groups) {
    const probes: [string, string | null][] = [
      ...group.allowed.map((origin): [string, string | null] => ['allowed', origin]),
      ...group.disallowed.map((origin): [string, string | null] => ['disallowed', origin]),
      ['none', null],
    ];
    for (const [what, origin] of probes) {
      for (const [name, method, path, status] of routedCases) {
        const wire = await request(port, method, `/${group.prefix}${path}`, originLine(origin));
        n++;
        const label = `${group.prefix} ${what} ${origin ?? 'no origin'} ${name}`;
        const unsafeWithoutOrigin = method === 'POST' && origin === null;
        check(
          problems,
          unsafeWithoutOrigin || wire.status === status,
          `${label}: status ${wire.status}, expected ${status}`,
        );
        check(
          problems,
          wire.tokens('vary').includes('origin'),
          `${label}: vary ${JSON.stringify(wire.all('vary'))} lacks Origin`,
        );
        if (what === 'allowed') {
          check(
            problems,
            set(wire.all('access-control-allow-origin')) === origin &&
              wire.all('access-control-allow-origin').length === 1,
            `${label}: allow-origin ${JSON.stringify(wire.all('access-control-allow-origin'))}`,
          );
          check(
            problems,
            JSON.stringify(wire.all('access-control-allow-credentials')) ===
              JSON.stringify(group.credentials ? ['true'] : []),
            `${label}: allow-credentials ${JSON.stringify(wire.all('access-control-allow-credentials'))}`,
          );
          check(
            problems,
            JSON.stringify(wire.all('access-control-expose-headers')) ===
              JSON.stringify(group.expose === null ? [] : [group.expose]),
            `${label}: expose-headers ${JSON.stringify(wire.all('access-control-expose-headers'))}`,
          );
        } else {
          check(problems, corsLines(wire).length === 0, `${label}: access-control lines ${corsLines(wire).join(',')}`);
        }
      }
    }
  }
  return n;
}

async function starAndOff(problems: string[], port: number): Promise<void> {
  for (const [name, method, path, status] of routedCases) {
    const wire = await request(port, method, `/star${path}`, originLine(EVIL));
    check(problems, wire.status === status, `star ${name}: status ${wire.status}, expected ${status}`);
    check(
      problems,
      JSON.stringify(wire.all('access-control-allow-origin')) === '["*"]',
      `star ${name}: allow-origin ${JSON.stringify(wire.all('access-control-allow-origin'))}`,
    );
    check(
      problems,
      !wire.tokens('vary').includes('origin'),
      `star ${name}: Origin in vary ${JSON.stringify(wire.all('vary'))}`,
    );
    check(problems, wire.all('access-control-allow-credentials').length === 0, `star ${name}: credentials sent`);
    const off = await request(port, method, `/off${path}`, originLine(A));
    check(problems, corsLines(off).length === 0, `off ${name}: access-control lines ${corsLines(off).join(',')}`);
  }
  for (const [route, token] of [
    ['hookvary', 'accept-encoding'],
    ['replyvary', 'accept-language'],
  ] as const) {
    const starWire = await request(port, 'GET', `/star/${route}`, originLine(EVIL));
    check(
      problems,
      starWire.tokens('vary').includes(token) && !starWire.tokens('vary').includes('origin'),
      `star ${route}: vary ${JSON.stringify(starWire.all('vary'))}`,
    );
    for (const origin of [A, EVIL, null]) {
      const wire = await request(port, 'GET', `/inherit/${route}`, originLine(origin));
      check(
        problems,
        wire.status === 200 && wire.tokens('vary').includes(token) && wire.tokens('vary').includes('origin'),
        `inherit ${route} ${origin}: vary ${JSON.stringify(wire.all('vary'))}`,
      );
    }
  }
  const starBare = await request(port, 'GET', '/star/ok');
  check(
    problems,
    starBare.status === 200 &&
      JSON.stringify(starBare.all('access-control-allow-origin')) === '["*"]' &&
      !starBare.tokens('vary').includes('origin'),
    `star without Origin: ${starBare.status} ${JSON.stringify(starBare.all('access-control-allow-origin'))} vary ${JSON.stringify(starBare.all('vary'))}`,
  );
  const unrouted = await request(port, 'GET', '/inherit/nope', originLine(A));
  check(
    problems,
    unrouted.status === 404 && corsLines(unrouted).length === 0,
    `unrouted 404 carried ${corsLines(unrouted).join(',')}`,
  );
}

interface HookCounts {
  [name: string]: number;
}

async function counted(port: number): Promise<string> {
  const wire = await request(port, 'GET', '/counts');
  const report = jsonOf(wire.body).report;
  return typeof report === 'string' ? report : '';
}

function preflight(
  port: number,
  path: string,
  origin: string | null,
  method: string | null,
  extra: readonly string[] = [],
) {
  const lines = [
    ...originLine(origin),
    ...(method === null ? [] : [`access-control-request-method: ${method}`]),
    ...extra,
  ];
  return request(port, 'OPTIONS', path, lines);
}

async function preflights(problems: string[], port: number): Promise<number> {
  let n = 0;
  const before = await counted(port);
  const asked = ['access-control-request-headers: x-evil-asked, authorization'];

  const hdr = await preflight(port, '/inherit/hdr', A, 'GET', asked);
  n++;
  check(problems, hdr.status === 204, `preflight inherit hdr: status ${hdr.status}`);
  check(
    problems,
    JSON.stringify(hdr.all('access-control-allow-origin')) === JSON.stringify([A]),
    `preflight allow-origin ${JSON.stringify(hdr.all('access-control-allow-origin'))}`,
  );
  check(
    problems,
    JSON.stringify(hdr.all('access-control-allow-methods')) === '["GET"]',
    `preflight allow-methods ${JSON.stringify(hdr.all('access-control-allow-methods'))}`,
  );
  check(
    problems,
    set(hdr.tokens('access-control-allow-headers')) === 'x-a-extra,x-other,x-token',
    `preflight allow-headers ${JSON.stringify(hdr.all('access-control-allow-headers'))}`,
  );
  check(
    problems,
    JSON.stringify(hdr.all('access-control-max-age')) === '["600"]',
    `preflight max-age ${JSON.stringify(hdr.all('access-control-max-age'))}`,
  );
  check(problems, hdr.tokens('vary').includes('origin'), `preflight vary ${JSON.stringify(hdr.all('vary'))}`);
  check(problems, hdr.all('access-control-allow-credentials').length === 0, 'preflight inherit sent credentials');
  for (const name of securityNames) {
    check(problems, hdr.all(name).length === 1, `preflight lacks ${name}`);
  }

  const post = await preflight(port, '/inherit/post', A, 'POST', asked);
  n++;
  check(
    problems,
    post.status === 204 && JSON.stringify(post.all('access-control-allow-methods')) === '["POST"]',
    `preflight post ${post.status} ${JSON.stringify(post.all('access-control-allow-methods'))}`,
  );
  check(
    problems,
    set(post.tokens('access-control-allow-headers')) === 'content-type,x-a-extra',
    `preflight post allow-headers ${JSON.stringify(post.all('access-control-allow-headers'))}`,
  );

  const plain = await preflight(port, '/inherit/ok', A, 'GET');
  n++;
  check(
    problems,
    plain.status === 204 && set(plain.tokens('access-control-allow-headers')) === 'x-a-extra',
    `preflight ok allow-headers ${JSON.stringify(plain.all('access-control-allow-headers'))}`,
  );

  const head = await preflight(port, '/inherit/ok', A, 'HEAD');
  n++;
  check(
    problems,
    head.status === 204 && JSON.stringify(head.all('access-control-allow-methods')) === '["HEAD"]',
    `preflight HEAD as GET: ${head.status} ${JSON.stringify(head.all('access-control-allow-methods'))}`,
  );

  const put = await preflight(port, '/inherit/put', A, 'PUT');
  n++;
  check(
    problems,
    put.status === 204 && JSON.stringify(put.all('access-control-allow-methods')) === '["PUT"]',
    `preflight PUT: ${put.status}`,
  );

  const own = await preflight(port, '/own/post', B, 'POST', asked);
  n++;
  check(problems, own.status === 204, `preflight own: status ${own.status}`);
  check(
    problems,
    JSON.stringify(own.all('access-control-max-age')) === '["120"]',
    `preflight own max-age ${JSON.stringify(own.all('access-control-max-age'))}`,
  );
  check(
    problems,
    set(own.tokens('access-control-allow-headers')) === 'content-type,x-b-extra',
    `preflight own allow-headers ${JSON.stringify(own.all('access-control-allow-headers'))}`,
  );
  check(
    problems,
    JSON.stringify(own.all('access-control-allow-credentials')) === '["true"]',
    `preflight own credentials ${JSON.stringify(own.all('access-control-allow-credentials'))}`,
  );
  const ownA = await preflight(port, '/own/post', A, 'POST');
  n++;
  check(
    problems,
    ownA.status === 403 && corsLines(ownA).length === 0,
    `preflight own with the server's origin: ${ownA.status} ${corsLines(ownA).join(',')}`,
  );

  const refusedBodies = new Set<string>();
  for (const [path, origin] of [
    ['/inherit/hdr', EVIL],
    ['/inherit/hdr', B],
    ['/own/hdr', A],
    ['/star/ok', null],
  ] as const) {
    const refused = await preflight(port, path, origin, 'GET');
    n++;
    if (origin === null) {
      check(problems, refused.status !== 204, `preflight without Origin on star answered ${refused.status}`);
      continue;
    }
    refusedBodies.add(refused.body);
    check(
      problems,
      refused.tokens('vary').includes('origin'),
      `preflight ${path} from ${origin}: 403 vary ${JSON.stringify(refused.all('vary'))} lacks Origin`,
    );
    check(
      problems,
      refused.status === 403 && jsonOf(refused.body).code === 'CROSS_ORIGIN',
      `preflight ${path} from ${origin}: ${refused.status} ${refused.body}`,
    );
    check(
      problems,
      corsLines(refused).length === 0,
      `preflight ${path} from ${origin}: grant headers ${corsLines(refused).join(',')}`,
    );
  }
  check(problems, refusedBodies.size === 1, `disallowed preflights answered ${refusedBodies.size} different bodies`);

  const star = await preflight(port, '/star/ok', EVIL, 'GET');
  n++;
  check(
    problems,
    star.status === 204 &&
      JSON.stringify(star.all('access-control-allow-origin')) === '["*"]' &&
      !star.tokens('vary').includes('origin'),
    `preflight star ${star.status} ${JSON.stringify(star.all('access-control-allow-origin'))} ${JSON.stringify(star.all('vary'))}`,
  );

  const notGranted: [string, Wire][] = [
    ['unknown path', await preflight(port, '/inherit/nope', A, 'GET')],
    ['unknown method for the path', await preflight(port, '/inherit/ok', A, 'DELETE')],
    ['unknown method for a body route', await preflight(port, '/inherit/post', A, 'GET')],
    ['route without a policy', await preflight(port, '/off/ok', A, 'GET')],
    ['no Access-Control-Request-Method', await preflight(port, '/inherit/ok', A, null)],
    ['no Origin', await preflight(port, '/inherit/ok', null, 'GET')],
  ];
  for (const [label, wire] of notGranted) {
    n++;
    check(
      problems,
      wire.status !== 204 && corsLines(wire).length === 0,
      `${label}: ${wire.status} with ${corsLines(wire).join(',')}`,
    );
    check(problems, wire.status === 404, `${label}: status ${wire.status}, expected 404`);
  }

  const after = await counted(port);
  check(problems, before === after, `hooks ran for a preflight: ${before} then ${after}`);
  const empty: HookCounts = JSON.parse(before);
  check(problems, Object.values(empty).length === 5, 'the hook counter route did not report five counts');
  return n;
}

async function plainServer(problems: string[], port: number): Promise<void> {
  for (const [method, path] of [
    ['GET', '/n/ok'],
    ['GET', '/n/val?n=abc'],
    ['GET', '/n/boom'],
    ['GET', '/n/unauth'],
  ] as const) {
    const wire = await request(port, method, path, originLine(A));
    check(
      problems,
      corsLines(wire).length === 0,
      `no policy ${path}: access-control lines ${corsLines(wire).join(',')}`,
    );
  }
  for (const path of ['/n/ok', '/n/hdr', '/n/post', '/n/nope']) {
    const wire = await preflight(port, path, A, path === '/n/post' ? 'POST' : 'GET');
    check(
      problems,
      wire.status === 404 && corsLines(wire).length === 0,
      `no policy preflight ${path}: ${wire.status} ${corsLines(wire).join(',')}`,
    );
  }
  const bare = await request(port, 'OPTIONS', '/n/ok');
  check(problems, bare.status === 404, `no policy OPTIONS answered ${bare.status}`);
}

function mixedCases(name: string): string[] {
  const upper = name.toUpperCase();
  const title = name
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('-');
  const alternating = [...name].map((letter, index) => (index % 2 === 0 ? letter : letter.toUpperCase())).join('');
  return [name, title, upper, alternating];
}

async function reservedRuntime(problems: string[], port: number, prefix: string): Promise<number> {
  let n = 0;
  for (const route of ['rhonrequest', 'rhhooksend', 'rhhandler']) {
    for (const lower of corsNames) {
      for (const name of mixedCases(lower)) {
        const wire = await request(port, 'GET', `/${prefix}/${route}`, [`x-probe: ${name}`, ...originLine(A)]);
        n++;
        check(
          problems,
          wire.status === 500 && wire.body === fixed500,
          `${prefix} ${route} ${name}: ${wire.status} ${wire.body}`,
        );
        check(
          problems,
          !wire.raw.includes('zz-probe'),
          `${prefix} ${route} ${name}: the application value reached the wire`,
        );
      }
    }
  }
  return n;
}

async function bootOutcome(
  options: () => { server: CorsPolicy | false | undefined; group?: CorsPolicy | false },
): Promise<string> {
  try {
    const { server: serverPolicy, group } = options();
    const server = createServer(serverPolicy === undefined ? {} : { cors: serverPolicy });
    server.routes(groupContract('x'), handlers(), group === undefined ? {} : { cors: group });
    await server.listen({ port: 0, host: '127.0.0.1' });
    await server.close();
    return 'accepted';
  } catch (error) {
    return error instanceof BootError ? error.code : `threw ${error instanceof Error ? error.name : 'unknown'}`;
  }
}

async function bootChecks(problems: string[]): Promise<number> {
  const bad: [string, CorsPolicy][] = [['* with credentials', { origins: '*', credentials: true }]];
  let n = 0;
  for (const [label, policy] of bad) {
    const onServer = await bootOutcome(() => ({ server: policy }));
    const onGroup = await bootOutcome(() => ({ server: undefined, group: policy }));
    n += 2;
    check(problems, onServer === 'INVALID_OPTION', `server policy ${label}: ${onServer}`);
    check(problems, onGroup === 'INVALID_OPTION', `group policy ${label}: ${onGroup}`);
  }
  const good: [string, CorsPolicy][] = [
    ['localhost with a port', { origins: ['http://localhost:3000'], credentials: true }],
  ];
  for (const [label, policy] of good) {
    const outcome = await bootOutcome(() => ({ server: policy }));
    n++;
    check(problems, outcome === 'accepted', `server policy ${label}: ${outcome}`);
  }
  return n;
}

async function prove(): Promise<void> {
  const problems: string[] = [];
  const summary: Record<string, number> = {};
  const child = await startServerChild(fileURLToPath(import.meta.url), 'policy');
  try {
    summary.grants = await grants(problems, child.port);
    await starAndOff(problems, child.port);
    summary.preflights = await preflights(problems, child.port);
    summary.reservedWithPolicy = await reservedRuntime(problems, child.port, 'inherit');
  } finally {
    await child.stop();
  }
  const plain = await startServerChild(fileURLToPath(import.meta.url), 'plain');
  try {
    await plainServer(problems, plain.port);
    summary.reservedWithoutPolicy = await reservedRuntime(problems, plain.port, 'n');
  } finally {
    await plain.stop();
  }
  summary.boot = await bootChecks(problems);
  process.stderr.write(`${JSON.stringify(summary)}\n`);
  conclude(statement, problems);
}

if (process.argv[2] === 'serve') {
  await serve(process.argv[3] ?? 'policy');
} else {
  await prove();
}
