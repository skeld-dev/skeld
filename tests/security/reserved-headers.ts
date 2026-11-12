// Does:  Proves the sixteen engine-owned response headers are refused at four author sites and ordinary headers pass.
// Holds: Responses are read as raw socket bytes, so a duplicate or an application framing header cannot hide.

import { compileProbes, rejectsAt } from '../support/support-compile.ts';
import { defineContract } from '@skeld/core/contract';
import * as t from '@skeld/core/schema';
import { createServer } from '@skeld/core/server';
import { check, conclude, rawExchange } from '../support/support.ts';

const statement =
  'each of the sixteen engine-owned headers, lower or mixed case, set at an onRequest, preHandler or onSend hook, a hook send or a handler reply answers the fixed 500 INTERNAL with no application header and no application value on the wire, ordinary headers pass at the same four sites, a reserved name fails to compile at setHeader, a reply and a send while ordinary names compile, and the next connection is answered';

const reserved: Record<string, string> = {
  'transfer-encoding': 'chunked',
  'content-length': '5',
  connection: 'upgrade',
  'keep-alive': 'timeout=999',
  'proxy-connection': 'keep-alive',
  te: 'trailers',
  trailer: 'x-trailer-probe',
  upgrade: 'websocket',
  'set-cookie': 'sid=abc; Path=/; HttpOnly',
  'access-control-allow-origin': 'https://evil.example',
  'access-control-allow-credentials': 'true',
  'access-control-expose-headers': 'x-probe-expose',
  'access-control-allow-methods': 'PURGE',
  'access-control-allow-headers': 'x-probe-allow',
  'access-control-max-age': '99999',
  'x-request-id': 'req-7f3a',
};
const ordinary: Record<string, string> = {
  'x-app-ref': 'req-7f3a',
  'cache-control': 'no-store',
};
const sites = ['onrequest', 'prehandler', 'onsend', 'hooksend', 'handler'] as const;
const okBody = '{"ok":true}';

const note = t.object({ ok: t.boolean() });
const contract = defineContract({
  onrequest: { method: 'GET', path: '/onrequest', responses: { 200: note } },
  prehandler: { method: 'GET', path: '/prehandler', responses: { 200: note } },
  onsend: { method: 'GET', path: '/onsend', responses: { 200: note } },
  hooksend: { method: 'GET', path: '/hooksend', responses: { 200: note } },
  handler: { method: 'GET', path: '/handler', responses: { 200: note } },
  plain: { method: 'GET', path: '/plain', responses: { 200: note } },
  boom: { method: 'GET', path: '/boom', responses: { 200: note } },
});

function pastTypes(value: unknown): never {
  // biome-ignore lint/nursery/noUnsafeTypeAssertion: the probe forces a header name the declared type refuses, to see what the wire does
  return value as never;
}

interface Probe {
  name: string;
  value: string;
}

function readProbe(headers: Record<string, string | readonly string[] | undefined>): Probe | null {
  const name = headers['x-probe-name'];
  const value = headers['x-probe-value'];
  return typeof name === 'string' && typeof value === 'string' ? { name, value } : null;
}

const server = createServer();
server.addHook('onRequest', (context) => {
  const probe = readProbe(context.headers);
  const site = context.route.name;
  if (probe === null) {
    return;
  }
  if (site === 'onrequest') {
    context.setHeader('x-before', 'before');
    context.setHeader(pastTypes(probe.name), probe.value);
  } else if (site === 'hooksend') {
    context.setHeader('x-before', 'before');
    context.send({ status: 200, headers: pastTypes({ [probe.name]: probe.value }), payload: okBody });
  }
});
server.addHook('preHandler', (context) => {
  const probe = readProbe(context.headers);
  if (probe !== null && context.route.name === 'prehandler') {
    context.setHeader('x-before', 'before');
    context.setHeader(pastTypes(probe.name), probe.value);
  }
});
server.addHook('onSend', (context) => {
  const probe = readProbe(context.headers);
  if (probe !== null && context.route.name === 'onsend') {
    context.setHeader('x-before', 'before');
    context.setHeader(pastTypes(probe.name), probe.value);
  }
});
const plainReply = () => ({ status: 200 as const, body: { ok: true } });
server.routes(contract, {
  onrequest: plainReply,
  prehandler: plainReply,
  onsend: plainReply,
  hooksend: plainReply,
  plain: plainReply,
  handler: (request) => {
    const probe = readProbe(request.headers);
    return probe === null
      ? plainReply()
      : { ...plainReply(), headers: pastTypes({ 'x-before': 'before', [probe.name]: probe.value }) };
  },
  boom: () => {
    throw new Error('probe-secret-detail');
  },
});

interface Wire {
  status: number;
  lines: [string, string][];
  body: string;
  head: string;
}

function toWire(raw: string): Wire {
  const split = raw.indexOf('\r\n\r\n');
  const head = split === -1 ? raw : raw.slice(0, split);
  const body = split === -1 ? '' : raw.slice(split + 4);
  const [statusLine = '', ...headerLines] = head.split('\r\n');
  const lines: [string, string][] = [];
  for (const line of headerLines) {
    const colon = line.indexOf(':');
    if (colon > 0) {
      lines.push([line.slice(0, colon).toLowerCase(), line.slice(colon + 1).trim()]);
    }
  }
  return { status: Number(statusLine.split(' ')[1]), lines, body, head };
}

function values(wire: Wire, name: string): string[] {
  return wire.lines.filter(([lineName]) => lineName === name).map(([, value]) => value);
}

async function fetchWire(at: number, site: string, probe: Probe | null): Promise<Wire> {
  const probeLines = probe === null ? '' : `X-Probe-Name: ${probe.name}\r\nX-Probe-Value: ${probe.value}\r\n`;
  const response = await rawExchange(at, `GET /${site} HTTP/1.1\r\nHost: x\r\nConnection: close\r\n${probeLines}\r\n`);
  return toWire(response.raw);
}

function mixedCase(name: string): string {
  return name
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('-');
}

const hookHeader = "import { createServer } from '@skeld/core/server';\nconst server = createServer();\n";
const replyHeader = `import { defineContract } from '@skeld/core/contract';
import * as t from '@skeld/core/schema';
import { createServer } from '@skeld/core/server';
const contract = defineContract({ item: { method: 'GET', path: '/item', responses: { 200: t.object({ ok: t.boolean() }) } } });
const server = createServer();
`;
function reply(headers: string): string {
  return `${replyHeader}server.routes(contract, { item: () => ({ status: 200, body: { ok: true }, headers: ${headers} }) });\n`;
}
const corsNames = Object.keys(reserved).filter((name) => name.startsWith('access-control-'));
const probes: { name: string; source: string; compiles: boolean }[] = [
  ...corsNames.flatMap((name) => [
    {
      name: `setHeader ${name}`,
      source: `${hookHeader}server.addHook('onRequest', (context) => { context.setHeader('${name}', 'x'); });\n`,
      compiles: false,
    },
    { name: `reply headers ${name}`, source: reply(`{ '${name}': 'x' }`), compiles: false },
    {
      name: `send headers ${name}`,
      source: `${hookHeader}server.addHook('onRequest', (context) => { context.send({ status: 200, headers: { '${name}': 'x' } }); });\n`,
      compiles: false,
    },
  ]),
  {
    name: 'setHeader transfer-encoding',
    source: `${hookHeader}server.addHook('onRequest', (context) => { context.setHeader('transfer-encoding', 'chunked'); });\n`,
    compiles: false,
  },
  {
    name: 'setHeader Transfer-Encoding',
    source: `${hookHeader}server.addHook('onRequest', (context) => { context.setHeader('Transfer-Encoding', 'chunked'); });\n`,
    compiles: false,
  },
  { name: 'reply headers transfer-encoding', source: reply("{ 'transfer-encoding': 'chunked' }"), compiles: false },
  {
    name: 'send headers connection',
    source: `${hookHeader}server.addHook('onRequest', (context) => { context.send({ status: 200, headers: { connection: 'close' } }); });\n`,
    compiles: false,
  },
  {
    name: 'setHeader set-cookie',
    source: `${hookHeader}server.addHook('onRequest', (context) => { context.setHeader('set-cookie', 'a=1'); });\n`,
    compiles: false,
  },
  { name: 'reply headers set-cookie', source: reply("{ 'set-cookie': 'a=1' }"), compiles: false },
  {
    name: 'send headers set-cookie',
    source: `${hookHeader}server.addHook('onRequest', (context) => { context.send({ status: 200, headers: { 'set-cookie': 'a=1' } }); });\n`,
    compiles: false,
  },
  {
    name: 'setHeader x-request-id',
    source: `${hookHeader}server.addHook('onRequest', (context) => { context.setHeader('x-request-id', 'a'); });\n`,
    compiles: false,
  },
  { name: 'reply headers x-request-id', source: reply("{ 'x-request-id': 'a' }"), compiles: false },
  {
    name: 'send headers x-request-id',
    source: `${hookHeader}server.addHook('onRequest', (context) => { context.send({ status: 200, headers: { 'x-request-id': 'a' } }); });\n`,
    compiles: false,
  },
  {
    name: 'setHeader x-app-ref',
    source: `${hookHeader}server.addHook('onRequest', (context) => { context.setHeader('x-app-ref', 'a'); });\n`,
    compiles: true,
  },
  { name: 'reply headers cache-control', source: reply("{ 'cache-control': 'no-store' }"), compiles: true },
  {
    name: 'send headers cache-control',
    source: `${hookHeader}server.addHook('onRequest', (context) => { context.send({ status: 200, headers: { 'cache-control': 'no-store' } }); });\n`,
    compiles: true,
  },
];

const problems: string[] = [];
const { port } = await server.listen({ port: 0, host: '127.0.0.1' });
const summary = { refused: 0, passed: 0, compileFail: 0, compileClean: 0 };

async function refusedCase(site: string, lower: string, name: string, baselineBody: string): Promise<void> {
  const appValue = reserved[lower] ?? '';
  const label = `${site} ${name}`;
  const wire = await fetchWire(port, site, { name, value: appValue });
  summary.refused++;
  check(problems, wire.status === 500, `${label}: status ${wire.status}, expected 500`);
  check(problems, wire.body === baselineBody, `${label}: body ${wire.body}, expected ${baselineBody}`);
  check(problems, values(wire, 'x-before').length === 0, `${label}: x-before reached the wire`);
  const onWire = values(wire, lower)
    .flatMap((value) => value.split(','))
    .map((token) => token.trim().toLowerCase());
  check(
    problems,
    !onWire.includes(appValue.toLowerCase()),
    `${label}: the application value ${appValue} is on the wire`,
  );
  if (lower === 'transfer-encoding') {
    check(problems, onWire.length === 0, `${label}: transfer-encoding on the wire: ${onWire.join(' | ')}`);
  }
  const lengths = values(wire, 'content-length');
  check(
    problems,
    lengths.length === 1 && lengths[0] === String(Buffer.byteLength(wire.body, 'latin1')),
    `${label}: content-length lines ${JSON.stringify(lengths)} for a ${Buffer.byteLength(wire.body, 'latin1')} byte body`,
  );
  check(problems, values(wire, 'connection').length <= 1, `${label}: more than one connection line`);
  const next = await fetchWire(port, 'plain', null);
  check(
    problems,
    next.status === 200 && next.body === okBody,
    `${label}: next connection got ${next.status} ${next.body}`,
  );
}

async function ordinaryCase(site: string, name: string, appValue: string): Promise<void> {
  const label = `${site} ${name}`;
  const wire = await fetchWire(port, site, { name, value: appValue });
  summary.passed++;
  check(problems, wire.status === 200, `${label}: status ${wire.status}, expected 200`);
  check(problems, wire.body === okBody, `${label}: body ${wire.body}`);
  check(
    problems,
    values(wire, name).length === 1 && values(wire, name)[0] === appValue,
    `${label}: wire carried ${JSON.stringify(values(wire, name))}, expected ${appValue}`,
  );
}

try {
  const baseline = await fetchWire(port, 'boom', null);
  check(problems, baseline.status === 500, `baseline 500: status ${baseline.status}`);
  check(problems, baseline.body.includes('"INTERNAL"'), `baseline 500 body lacks INTERNAL: ${baseline.body}`);
  check(problems, !baseline.body.includes('probe-secret-detail'), 'baseline 500 body leaks the thrown message');

  await Promise.all(
    sites.map(async (site) => {
      const base = await fetchWire(port, site, null);
      check(problems, base.status === 200 && base.body === okBody, `${site} control: ${base.status} ${base.body}`);
    }),
  );

  await Promise.all(
    sites.flatMap((site) =>
      Object.keys(reserved).flatMap((lower) =>
        [lower, mixedCase(lower)].map((name) => refusedCase(site, lower, name, baseline.body)),
      ),
    ),
  );
  await Promise.all(
    sites.flatMap((site) => Object.entries(ordinary).map(([name, appValue]) => ordinaryCase(site, name, appValue))),
  );
} finally {
  await server.close();
}

const sources = probes.map((probe) => (probe.compiles ? probe.source : `${probe.source.trimEnd()} // BAD\n`));
const results = compileProbes(sources);
for (const [index, probe] of probes.entries()) {
  const result = results[index];
  if (probe.compiles) {
    summary.compileClean++;
    check(problems, result?.status === 0, `${probe.name}: ${result?.errors.join(' | ')}`);
  } else {
    summary.compileFail++;
    const code = probe.name.startsWith('setHeader ') ? 2345 : 2322;
    check(problems, rejectsAt(result, sources[index] ?? '', code), `${probe.name}: ${result?.errors.join(' | ')}`);
  }
}

process.stderr.write(`${JSON.stringify(summary)}\n`);
conclude(statement, problems);
