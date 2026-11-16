// Does:  Proves the cookie writer's defaults, lines, replacement, refusals and error-path rules on the wire.
// Holds: Set-Cookie lines are read as raw header lines, so a joined or duplicated line cannot hide.

import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { defineContract } from '@skeld/core/contract';
import { HttpError } from '@skeld/core/http-error';
import * as t from '@skeld/core/schema';
import { createServer, type OutgoingCookie, type RequestContext } from '@skeld/core/server';
import { check, conclude, rawExchange } from '../support/support.ts';
import { parseRecords } from '../support/support-log.ts';
import { startServerChild } from '../support/support-typesystem.ts';

const statement =
  'a cookie with only name and value goes out as one Set-Cookie line with Path=/, HttpOnly, Secure and SameSite=Lax; three cookies are three lines; a later cookie of the same name, path and domain replaces the earlier, also across a hook and the reply; maxAge 0 sends Max-Age=0; an invalid name, value, path, domain, prefix, sameSite, partitioned, maxAge and size each throws from setCookie and is the fixed 500 from a reply, with no cookie on the wire and the value in no stderr or stdout line; set-cookie in any letter case is a runtime throw or the fixed 500; a thrown plain error after setCookie sends no cookie; an HttpError naming cookies sends exactly those; the fixed 500 sends none';

const fixed500 = '{"status":500,"code":"INTERNAL","message":"Internal Server Error"}';
const marker = `zq${randomBytes(6).toString('hex')}`;
const ok = t.object({ ok: t.boolean() });
const reserved = ['set-cookie', 'Set-Cookie', 'SET-COOKIE', 'sEt-CoOkIe'];

const sites = ['rhonrequest', 'rhprehandler', 'rhonsend', 'rhhooksend', 'rhhandler'] as const;

const specQuery = t.object({ spec: t.string({ maxLength: 12_000 }) });
const contract = defineContract({
  reply: { method: 'GET', path: '/reply', query: specQuery, responses: { 200: ok } },
  hooked: { method: 'GET', path: '/hooked', responses: { 200: ok } },
  hookreply: { method: 'GET', path: '/hookreply', responses: { 200: ok } },
  onsendset: { method: 'GET', path: '/onsendset', responses: { 200: ok } },
  afterset: { method: 'GET', path: '/afterset', responses: { 200: ok } },
  httperr: { method: 'GET', path: '/httperr', query: specQuery, responses: { 200: ok } },
  httperrbare: { method: 'GET', path: '/httperrbare', responses: { 200: ok } },
  plain: { method: 'GET', path: '/plain', responses: { 200: ok } },
  rhcaught: { method: 'GET', path: '/rhcaught', responses: { 200: ok } },
  rhonrequest: { method: 'GET', path: '/rhonrequest', responses: { 200: ok } },
  rhprehandler: { method: 'GET', path: '/rhprehandler', responses: { 200: ok } },
  rhonsend: { method: 'GET', path: '/rhonsend', responses: { 200: ok } },
  rhhooksend: { method: 'GET', path: '/rhhooksend', responses: { 200: ok } },
  rhhandler: { method: 'GET', path: '/rhhandler', responses: { 200: ok } },
});

function pastTypes(value: unknown): never {
  // biome-ignore lint/nursery/noUnsafeTypeAssertion: the probe passes values the declared types refuse, to see what the wire does
  return value as never;
}

// Does:  Builds a plain dotted name of exactly the given byte length from 62-letter labels.
function domainOfLength(length: number): string {
  const labels = Math.floor(length / 63);
  return `${'a'.repeat(62)}.`.repeat(labels) + 'a'.repeat(length - labels * 63);
}

function expand(spec: string): OutgoingCookie[] {
  const parsed: unknown = JSON.parse(spec);
  if (!Array.isArray(parsed)) {
    return [];
  }
  return parsed.map((entry: unknown): OutgoingCookie => {
    const copy: Record<string, unknown> = typeof entry === 'object' && entry !== null ? { ...entry } : {};
    const value = copy.value;
    if (typeof value === 'string' && value.startsWith('@rep:')) {
      copy.value = 'x'.repeat(Number(value.slice(5)));
    }
    if (typeof copy.path === 'string' && copy.path.startsWith('@len:')) {
      copy.path = `/${'a'.repeat(Number(copy.path.slice(5)) - 1)}`;
    }
    if (typeof copy.domain === 'string' && copy.domain.startsWith('@len:')) {
      copy.domain = domainOfLength(Number(copy.domain.slice(5)));
    }
    return pastTypes(copy);
  });
}

function headerOf(headers: Record<string, string | readonly string[] | undefined>, name: string): string | null {
  const value = headers[name];
  return typeof value === 'string' ? value : null;
}

function setCookiesFor(context: RequestContext): void {
  const route = context.route.name;
  if (route === 'hooked') {
    try {
      for (const cookie of expand(decodeURIComponent(headerOf(context.headers, 'x-spec') ?? '[]'))) {
        context.setCookie(cookie);
      }
    } catch (error) {
      context.setHeader('x-threw', error instanceof Error ? error.name : 'unknown');
      context.setHeader('x-threw-msg', encodeURIComponent(error instanceof Error ? error.message : ''));
    }
  } else if (route === 'hookreply') {
    context.setCookie({ name: 'h', value: 'hook' });
    context.setCookie({ name: 'other', value: 'o' });
  } else if (route === 'afterset' || route === 'httperr' || route === 'httperrbare') {
    context.setCookie({ name: 'pending', value: 'dropped' });
  }
}

async function serve(): Promise<void> {
  const server = createServer();
  server.addHook('onRequest', (context) => {
    setCookiesFor(context);
    const probe = headerOf(context.headers, 'x-probe');
    if (probe === null) {
      return;
    }
    if (context.route.name === 'rhonrequest') {
      context.setHeader(pastTypes(probe), 'a=1');
    } else if (context.route.name === 'rhcaught') {
      try {
        context.setHeader(pastTypes(probe), 'a=1');
      } catch (error) {
        context.setHeader('x-threw', error instanceof Error ? error.name : 'unknown');
      }
    } else if (context.route.name === 'rhhooksend') {
      context.send({ status: 200, headers: pastTypes({ [probe]: 'a=1' }), payload: '{"ok":true}' });
    }
  });
  server.addHook('preHandler', (context) => {
    const probe = headerOf(context.headers, 'x-probe');
    if (probe !== null && context.route.name === 'rhprehandler') {
      context.setHeader(pastTypes(probe), 'a=1');
    }
  });
  server.addHook('onSend', (context) => {
    const probe = headerOf(context.headers, 'x-probe');
    if (context.route.name === 'onsendset') {
      context.setCookie({ name: 's', value: 'sent' });
    }
    if (probe !== null && context.route.name === 'rhonsend') {
      context.setHeader(pastTypes(probe), 'a=1');
    }
  });
  const okReply = () => ({ status: 200 as const, body: { ok: true } });
  server.routes(contract, {
    reply: ({ query }) => ({ ...okReply(), cookies: expand(query.spec) }),
    hooked: okReply,
    hookreply: () => ({ ...okReply(), cookies: [{ name: 'h', value: 'reply' }] }),
    onsendset: okReply,
    afterset: () => {
      throw new Error('after setCookie');
    },
    httperr: ({ query }) => {
      throw new HttpError(401, 'NOPE', 'no', { cookies: expand(query.spec) });
    },
    httperrbare: () => {
      throw new HttpError(401, 'NOPE', 'no');
    },
    plain: okReply,
    rhonrequest: okReply,
    rhcaught: okReply,
    rhprehandler: okReply,
    rhonsend: okReply,
    rhhooksend: okReply,
    rhhandler: (request) => {
      const probe = headerOf(request.headers, 'x-probe');
      return probe === null ? okReply() : { ...okReply(), headers: pastTypes({ [probe]: 'a=1' }) };
    },
  });
  const { port } = await server.listen({ port: 0, host: '127.0.0.1' });
  process.on('SIGTERM', () => {
    void server.close().then(() => process.exit(0));
  });
  process.stdout.write(`listening ${port}\n`);
}

interface Wire {
  status: number;
  cookies: string[];
  headers: Map<string, string>;
  body: string;
  raw: string;
}

async function fetchWire(port: number, path: string, headers: readonly string[] = []): Promise<Wire> {
  const text = await rawExchange(
    port,
    `GET ${path} HTTP/1.1\r\nhost: x\r\nconnection: close\r\n${headers.map((line) => `${line}\r\n`).join('')}\r\n`,
  );
  const head = text.raw.split('\r\n\r\n')[0] ?? '';
  const cookies = head
    .split('\r\n')
    .filter((line) => line.toLowerCase().startsWith('set-cookie:'))
    .map((line) => line.slice(line.indexOf(':') + 1).trim());
  return { status: text.status, cookies, headers: text.headers, body: text.body, raw: text.raw };
}

function viaReply(port: number, cookies: readonly unknown[]): Promise<Wire> {
  return fetchWire(port, `/reply?spec=${encodeURIComponent(JSON.stringify(cookies))}`);
}

function viaHook(port: number, cookies: readonly unknown[]): Promise<Wire> {
  return fetchWire(port, '/hooked', [`x-spec: ${encodeURIComponent(JSON.stringify(cookies))}`]);
}

interface Parsed {
  pair: string;
  attrs: Map<string, string>;
}

function parseLine(line: string): Parsed {
  const [pair = '', ...rest] = line.split('; ');
  const attrs = new Map<string, string>();
  for (const part of rest) {
    const equals = part.indexOf('=');
    attrs.set(
      (equals === -1 ? part : part.slice(0, equals)).toLowerCase(),
      equals === -1 ? '' : part.slice(equals + 1),
    );
  }
  return { pair, attrs };
}

function onlyLine(problems: string[], label: string, wire: Wire): Parsed {
  check(problems, wire.status === 200, `${label}: status ${wire.status}`);
  check(
    problems,
    wire.cookies.length === 1,
    `${label}: ${wire.cookies.length} Set-Cookie lines, expected 1: ${wire.cookies.join(' | ')}`,
  );
  return parseLine(wire.cookies[0] ?? '');
}

type Spec = Record<string, unknown>;
const badValues = [`v\r\nSet-Cookie: x=${marker}`];
const invalid: [string, Spec][] = [
  ...['a;b'].map((name): [string, Spec] => [`name ${JSON.stringify(name)}`, { name, value: marker }]),
  ...badValues.map((value): [string, Spec] => [
    `value ${JSON.stringify(value.replace(marker, 'M'))}`,
    { name: 'a', value },
  ]),
  ...[`/a\r\nx-injected: ${marker}`].map((path): [string, Spec] => [
    `path ${JSON.stringify(path.replace(marker, 'M'))}`,
    { name: 'a', value: marker, path },
  ]),
  ...[`a.com\r\nx: ${marker}`].map((domain): [string, Spec] => [
    `domain ${JSON.stringify(domain.replace(marker, 'M'))}`,
    { name: 'a', value: marker, domain },
  ]),
  ['__Host- without secure', { name: '__Host-x', value: marker, secure: false }],
  ['sameSite Bogus', { name: 'a', value: marker, sameSite: 'Bogus' }],
  ['partitioned without secure', { name: 'a', value: marker, partitioned: true, secure: false }],
  ['maxAge negative', { name: 'a', value: marker, maxAge: -1 }],
  ['name and value over 4096', { name: 'a', value: '@rep:4096' }],
];

function expectNone(problems: string[], label: string, wire: Wire): void {
  check(problems, wire.cookies.length === 0, `${label}: Set-Cookie on the wire: ${wire.cookies.join(' | ')}`);
}

async function refusals(problems: string[], port: number): Promise<number> {
  let cases = 0;
  for (const [label, bad] of invalid) {
    cases++;
    // biome-ignore lint/performance/noAwaitInLoops: Serial requests keep each case's wire bytes apart.
    const reply = await viaReply(port, [{ name: 'sibling', value: 'fine' }, bad]);
    check(problems, reply.status === 500, `reply ${label}: status ${reply.status}, expected 500`);
    check(problems, reply.body === fixed500, `reply ${label}: body ${reply.body}`);
    expectNone(problems, `reply ${label}`, reply);
    check(problems, !reply.raw.includes(marker), `reply ${label}: the value reached the wire`);
    check(problems, !reply.headers.has('x-injected'), `reply ${label}: an injected header reached the wire`);
    const hooked = await viaHook(port, [bad]);
    check(problems, hooked.status === 200, `hook ${label}: status ${hooked.status}, expected the handler's 200`);
    check(
      problems,
      hooked.headers.get('x-threw') === 'Error',
      `hook ${label}: setCookie did not throw (${hooked.headers.get('x-threw')})`,
    );
    expectNone(problems, `hook ${label}`, hooked);
    check(problems, !hooked.raw.includes(marker), `hook ${label}: the value reached the wire or the thrown message`);
    const named = await fetchWire(port, `/httperr?spec=${encodeURIComponent(JSON.stringify([bad]))}`);
    check(
      problems,
      named.status === 500 && named.body === fixed500,
      `HttpError ${label}: ${named.status} ${named.body}`,
    );
    expectNone(problems, `HttpError ${label}`, named);
    check(problems, !named.raw.includes(marker), `HttpError ${label}: the value reached the wire`);
  }
  return cases;
}

async function prove(): Promise<void> {
  const problems: string[] = [];
  const summary = { refused: 0, valid: 0, reservedSites: 0 };
  const child = await startServerChild(fileURLToPath(import.meta.url));
  try {
    const { port } = child;
    const defaults = onlyLine(problems, 'defaults', await viaReply(port, [{ name: 'sid', value: 'abc' }]));
    summary.valid++;
    check(problems, defaults.pair === 'sid=abc', `defaults: pair ${defaults.pair}`);
    check(problems, defaults.attrs.get('path') === '/', `defaults: Path ${defaults.attrs.get('path')}`);
    check(problems, defaults.attrs.has('httponly'), 'defaults: no HttpOnly');
    check(problems, defaults.attrs.has('secure'), 'defaults: no Secure');
    check(problems, defaults.attrs.get('samesite') === 'Lax', `defaults: SameSite ${defaults.attrs.get('samesite')}`);
    check(
      problems,
      !defaults.attrs.has('domain') && !defaults.attrs.has('max-age'),
      'defaults: Domain or Max-Age present',
    );

    const cleared = onlyLine(problems, 'maxAge 0', await viaReply(port, [{ name: 'sid', value: 'gone', maxAge: 0 }]));
    summary.valid++;
    check(problems, cleared.attrs.get('max-age') === '0', `maxAge 0: Max-Age ${cleared.attrs.get('max-age')}`);

    const explicit = onlyLine(
      problems,
      'explicit',
      await viaReply(port, [
        {
          name: 'e',
          value: 'v',
          maxAge: 3600,
          domain: 'example.com',
          path: '/app',
          sameSite: 'Strict',
          httpOnly: false,
          secure: false,
        },
      ]),
    );
    summary.valid++;
    check(problems, explicit.attrs.get('path') === '/app', `explicit: Path ${explicit.attrs.get('path')}`);
    check(problems, explicit.attrs.get('domain') === 'example.com', `explicit: Domain ${explicit.attrs.get('domain')}`);
    check(problems, explicit.attrs.get('max-age') === '3600', `explicit: Max-Age ${explicit.attrs.get('max-age')}`);
    check(
      problems,
      explicit.attrs.get('samesite') === 'Strict',
      `explicit: SameSite ${explicit.attrs.get('samesite')}`,
    );
    check(
      problems,
      !explicit.attrs.has('httponly') && !explicit.attrs.has('secure'),
      'explicit: HttpOnly or Secure present though turned off',
    );

    const accepted: [string, Spec, (parsed: Parsed) => boolean][] = [
      [
        '__Host- complete',
        { name: '__Host-sid', value: 'v' },
        (p) => p.attrs.get('path') === '/' && p.attrs.has('secure') && !p.attrs.has('domain'),
      ],
      ['path 1024 bytes', { name: 'a', value: 'v', path: '@len:1024' }, (p) => p.attrs.get('path')?.length === 1024],
      [
        'domain 1024 bytes',
        { name: 'a', value: 'v', domain: '@len:1024' },
        (p) => p.attrs.get('domain')?.length === 1024,
      ],
      ['__Secure-', { name: '__Secure-x', value: 'v' }, (p) => p.attrs.has('secure')],
      [
        'SameSite None with Secure',
        { name: 'n', value: 'v', sameSite: 'None' },
        (p) => p.attrs.get('samesite') === 'None' && p.attrs.has('secure'),
      ],
      [
        'Partitioned with Secure',
        { name: 'p', value: 'v', partitioned: true },
        (p) => p.attrs.has('partitioned') && p.attrs.has('secure'),
      ],
      ['maxAge 400 days', { name: 'm', value: 'v', maxAge: 34_560_000 }, (p) => p.attrs.get('max-age') === '34560000'],
      ['name and value exactly 4096', { name: 'a', value: '@rep:4095' }, (p) => p.pair.length === 4097],
      [
        'value of cookie-octets',
        { name: 'o', value: "!#$%&'()*+-./:<=>?@[]^_`{|}~" },
        (p) => p.pair === "o=!#$%&'()*+-./:<=>?@[]^_`{|}~",
      ],
    ];
    for (const [label, spec, ok1] of accepted) {
      // biome-ignore lint/performance/noAwaitInLoops: Serial requests keep each case's wire bytes apart.
      const parsed = onlyLine(problems, label, await viaReply(port, [spec]));
      summary.valid++;
      check(problems, ok1(parsed), `${label}: line ${JSON.stringify([...parsed.attrs])} ${parsed.pair.slice(0, 40)}`);
    }

    const three = await viaReply(port, [
      { name: 'a', value: '1' },
      { name: 'b', value: '2' },
      { name: 'c', value: '3' },
    ]);
    summary.valid++;
    check(problems, three.status === 200 && three.cookies.length === 3, `three cookies: ${three.cookies.length} lines`);
    check(
      problems,
      three.cookies.map((line) => line.split(';')[0]).join(',') === 'a=1,b=2,c=3',
      `three cookies: ${three.cookies.join(' | ')}`,
    );
    const replaced = await viaReply(port, [
      { name: 'a', value: '1' },
      { name: 'b', value: '2' },
      { name: 'a', value: '3' },
    ]);
    summary.valid++;
    check(
      problems,
      replaced.cookies.length === 2 &&
        replaced.cookies.some((line) => line.startsWith('a=3;')) &&
        replaced.cookies.some((line) => line.startsWith('b=2;')) &&
        !replaced.cookies.some((line) => line.startsWith('a=1;')),
      `later write: ${replaced.cookies.join(' | ')}`,
    );
    const lines = async (cookies: readonly unknown[]) =>
      (await viaReply(port, cookies)).cookies.map((line) => line.split(';')[0]);
    check(
      problems,
      (
        await lines([
          { name: 'a', value: '1', path: '/x' },
          { name: 'a', value: '2', path: '/y' },
        ])
      ).join(',') === 'a=1,a=2',
      'different paths were merged',
    );
    check(
      problems,
      (
        await lines([
          { name: 'a', value: '1', domain: 'example.com' },
          { name: 'a', value: '2' },
        ])
      ).join(',') === 'a=1,a=2',
      'different domains were merged',
    );
    check(
      problems,
      (
        await lines([
          { name: 'a', value: '1', domain: 'example.com' },
          { name: 'a', value: '2', domain: 'example.com' },
        ])
      ).join(',') === 'a=2',
      'same domain was not replaced',
    );
    check(
      problems,
      (
        await lines([
          { name: 'a', value: '1' },
          { name: 'A', value: '2' },
        ])
      ).join(',') === 'a=1,A=2',
      'names of different case were merged',
    );
    summary.valid += 4;

    const mixed = await fetchWire(port, '/hookreply');
    summary.valid++;
    const hLines = mixed.cookies.filter((line) => line.startsWith('h='));
    check(
      problems,
      mixed.status === 200 && hLines.length === 1 && hLines[0]?.startsWith('h=reply;') === true,
      `hook then reply: ${mixed.cookies.join(' | ')}`,
    );
    check(
      problems,
      mixed.cookies.some((line) => line.startsWith('other=o;')),
      `hook then reply lost the hook's other cookie: ${mixed.cookies.join(' | ')}`,
    );
    const sentLater = await fetchWire(port, '/onsendset');
    check(
      problems,
      sentLater.cookies.length === 1 && sentLater.cookies[0]?.startsWith('s=sent;') === true,
      `onSend setCookie: ${sentLater.cookies.join(' | ')}`,
    );
    const hookedValid = await viaHook(port, [
      { name: 'k', value: 'v' },
      { name: 'k', value: 'w' },
    ]);
    check(
      problems,
      hookedValid.cookies.length === 1 && hookedValid.cookies[0]?.startsWith('k=w;') === true,
      `two setCookie of one name: ${hookedValid.cookies.join(' | ')}`,
    );

    summary.refused = await refusals(problems, port);

    const afterSet = await fetchWire(port, '/afterset');
    check(
      problems,
      afterSet.status === 500 && afterSet.body === fixed500,
      `plain throw after setCookie: ${afterSet.status} ${afterSet.body}`,
    );
    expectNone(problems, 'plain throw after setCookie', afterSet);
    const named = await fetchWire(
      port,
      `/httperr?spec=${encodeURIComponent(
        JSON.stringify([
          { name: 'e', value: '1' },
          { name: 'f', value: '2' },
        ]),
      )}`,
    );
    check(problems, named.status === 401, `HttpError with cookies answered ${named.status}`);
    check(
      problems,
      named.cookies.map((line) => line.split(';')[0]).join(',') === 'e=1,f=2',
      `HttpError cookies: ${named.cookies.join(' | ')}`,
    );
    check(
      problems,
      !named.cookies.some((line) => line.startsWith('pending=')),
      'the hook cookie reached an HttpError that named its own',
    );
    const bare = await fetchWire(port, '/httperrbare');
    check(problems, bare.status === 401, `HttpError without cookies answered ${bare.status}`);
    expectNone(problems, 'HttpError without cookies after setCookie', bare);
    const plain = await fetchWire(port, '/plain');
    check(problems, plain.status === 200 && plain.cookies.length === 0, 'a plain route carried a cookie');

    for (const site of sites) {
      for (const name of reserved) {
        summary.reservedSites++;
        // biome-ignore lint/performance/noAwaitInLoops: Serial requests keep each case's wire bytes apart.
        const wire = await fetchWire(child.port, `/${site}`, [`x-probe: ${name}`]);
        check(problems, wire.status === 500 && wire.body === fixed500, `${site} ${name}: ${wire.status} ${wire.body}`);
        expectNone(problems, `${site} ${name}`, wire);
        check(problems, !wire.raw.includes('a=1'), `${site} ${name}: the application value reached the wire`);
      }
    }
    for (const name of reserved) {
      // biome-ignore lint/performance/noAwaitInLoops: Serial requests keep each case's wire bytes apart.
      const caught = await fetchWire(port, '/rhcaught', [`x-probe: ${name}`]);
      check(
        problems,
        caught.status === 200 && caught.headers.get('x-threw') === 'Error',
        `setHeader ${name} did not throw`,
      );
      expectNone(problems, `caught setHeader ${name}`, caught);
    }
    const control = await fetchWire(port, '/rhonrequest');
    check(problems, control.status === 200, `reserved-name control answered ${control.status}`);
  } finally {
    await child.stop();
  }
  const stderr = child.stderr();
  check(problems, !stderr.includes(marker), 'a refused cookie value appears in stderr');
  const stdout = child.stdout();
  check(problems, !stdout.includes(marker), 'a refused cookie value appears in stdout');
  check(
    problems,
    parseRecords(stdout).some(
      (record) =>
        record?.event_name === 'skeld.request.error' &&
        record['skeld.reason'] === 'invalid_cookie' &&
        record['http.route'] === '/reply' &&
        record['http.response.status_code'] === 500,
    ),
    'stdout held no invalid_cookie record for the refused cookies, so its value check proves nothing',
  );

  process.stderr.write(`${JSON.stringify(summary)}\n`);
  conclude(statement, problems);
}

if (process.argv[2] === 'serve') {
  await serve();
} else {
  await prove();
}
