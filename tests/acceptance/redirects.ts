// Does:  Proves a 3xx Location is sent only when it is a local path or a listed origin, and a refusal is the fixed 500.
// Holds: Responses are read as raw socket bytes, and checkRedirect is compared with the engine for every case.

import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { defineContract } from '@skeld/core/contract';
import { checkRedirect } from '@skeld/core/redirect';
import * as t from '@skeld/core/schema';
import { createServer, type RequestContext } from '@skeld/core/server';
import { check, conclude, type RawResponse, rawExchange } from './support.ts';
import { startDiagChild } from './support-diag.ts';
import { startServerChild } from './support-typesystem.ts';

const statement =
  'a local path in a 3xx Location is sent as written; //host, /\\host, /<tab>/host, /.//host, a control character, surrounding whitespace, javascript:, userinfo, an http URL when only its https origin is listed, another port and a subdomain each become the fixed 500 with no Location on the wire; any value starting // is refused whatever host follows; a hook send with a status that is not an integer from 200 to 599 throws and puts nothing of its reply on the wire; an absolute redirect to the publicOrigin is the fixed 500 unless that origin is in redirectOrigins, and a local path needs neither; a listed origin passes on its group only; a Location set by a hook setHeader, send or onSend is checked the same way; stderr and the diag record hold the route and a reason and never the target; checkRedirect gives the engine verdict for every case; a 201 Location is untouched';

const fixed500 = '{"status":500,"code":"INTERNAL","message":"Internal Server Error"}';
const defaultOrigin = 'https://default.example';
const idOrigin = 'https://id.example.com';
const publicOrigin = 'https://api.example';
const noOrigins: readonly string[] = [];
const groups = {
  A: { prefix: 'a', origins: [defaultOrigin] },
  B: { prefix: 'b', origins: [idOrigin] },
  C: { prefix: 'c', origins: noOrigins },
  D: { prefix: 'd', origins: [publicOrigin] },
} as const;
type GroupKey = keyof typeof groups;
const groupKeys: readonly GroupKey[] = ['A', 'B', 'C', 'D'];
const marker = `zq${randomBytes(6).toString('hex')}`;

function contractFor(prefix: string) {
  return defineContract({
    go: {
      method: 'GET',
      path: `/${prefix}/go`,
      query: t.object({ to: t.string({ maxLength: 300 }), status: t.integer({ minimum: 301, maximum: 308 }) }),
      responses: { 301: null, 302: null, 303: null, 307: null, 308: null },
    },
    hookset: { method: 'GET', path: `/${prefix}/hookset`, responses: { 302: null } },
    hooksend: { method: 'GET', path: `/${prefix}/hooksend`, responses: { 302: null } },
    badsend: { method: 'GET', path: `/${prefix}/badsend`, responses: { 200: null } },
    badsendcaught: { method: 'GET', path: `/${prefix}/badsendcaught`, responses: { 200: null } },
    onsend: { method: 'GET', path: `/${prefix}/onsend`, responses: { 302: t.object({ ok: t.boolean() }) } },
    created: { method: 'GET', path: `/${prefix}/created`, responses: { 201: null } },
    bare: { method: 'GET', path: `/${prefix}/bare`, responses: { 302: null } },
    list: { method: 'GET', path: `/${prefix}/list`, responses: { 302: null } },
    num: { method: 'GET', path: `/${prefix}/num`, responses: { 302: null } },
  });
}

function pastTypes(value: unknown): never {
  // biome-ignore lint/nursery/noUnsafeTypeAssertion: the probe returns a status and header value the declared types refuse, to see what the wire does
  return value as never;
}

function target(headers: Record<string, string | readonly string[] | undefined>): string {
  const value = headers['x-target'];
  return typeof value === 'string' ? value : '';
}

function statusOf(headers: Record<string, string | readonly string[] | undefined>): number {
  const value = headers['x-status'];
  return value === 'NaN' ? Number.NaN : Number(value);
}

function sendBadStatus(context: RequestContext): void {
  const reply = { status: pastTypes(statusOf(context.headers)), headers: { location: '//evil.example' } };
  if (context.route.name === 'badsend') {
    context.send(reply);
    return;
  }
  try {
    context.send(reply);
  } catch (error) {
    context.setHeader('x-threw', error instanceof Error ? error.name : 'unknown');
  }
}

async function serve(): Promise<void> {
  const server = createServer({ redirectOrigins: [defaultOrigin], publicOrigin });
  server.addHook('onRequest', (context) => {
    if (context.route.name === 'hookset') {
      context.setHeader('location', target(context.headers));
    } else if (context.route.name === 'hooksend') {
      context.send({ status: 302, headers: { location: target(context.headers) } });
    } else if (context.route.name === 'badsend' || context.route.name === 'badsendcaught') {
      sendBadStatus(context);
    }
  });
  server.addHook('onSend', (context) => {
    if (context.route.name === 'onsend') {
      context.setHeader('location', target(context.headers));
    }
  });
  for (const { prefix, origins } of Object.values(groups)) {
    const routeOptions = prefix === 'a' ? {} : { redirectOrigins: origins };
    server.routes(
      contractFor(prefix),
      {
        go: (call) => pastTypes({ status: call.query.status, headers: { location: call.query.to } }),
        hookset: () => ({ status: 302 }),
        hooksend: () => ({ status: 302 }),
        badsend: () => ({ status: 200 }),
        badsendcaught: () => ({ status: 200 }),
        onsend: () => ({ status: 302, body: { ok: true } }),
        created: () => pastTypes({ status: 201, headers: { location: '//created.untouched.example' } }),
        bare: () => ({ status: 302 }),
        list: () => pastTypes({ status: 302, headers: { location: ['/one', '/two'] } }),
        num: () => pastTypes({ status: 302, headers: { location: 7 } }),
      },
      routeOptions,
    );
  }
  const { port } = await server.listen({ port: 0, host: '127.0.0.1' });
  process.on('SIGTERM', () => {
    void server.close().then(() => process.exit(0));
  });
  process.stdout.write(`listening ${port}\n`);
}

interface Case {
  label: string;
  value: string;
  passesIn: readonly GroupKey[];
}

const everywhere: readonly GroupKey[] = ['A', 'B', 'C', 'D'];
const nowhere: readonly GroupKey[] = [];
const cases: Case[] = [
  { label: 'local path', value: '/home', passesIn: everywhere },
  { label: 'root', value: '/', passesIn: everywhere },
  { label: 'local with query and fragment', value: `/home?next=%2Fdash&x=${marker}#top`, passesIn: everywhere },
  { label: 'two slashes', value: `//h${marker}.example`, passesIn: nowhere },
  { label: 'two slashes only', value: '//', passesIn: nowhere },
  { label: 'two slashes, local.invalid', value: '//local.invalid', passesIn: nowhere },
  { label: 'two slashes, local.invalid and path', value: `//local.invalid/${marker}`, passesIn: nowhere },
  { label: 'two slashes, localhost', value: `//localhost/${marker}`, passesIn: nowhere },
  { label: 'two slashes, IPv4 literal', value: `//127.0.0.1/${marker}`, passesIn: nowhere },
  { label: 'two slashes, IPv6 literal', value: `//[::1]/${marker}`, passesIn: nowhere },
  { label: 'two slashes, listed host', value: `//id.example.com/${marker}`, passesIn: nowhere },
  { label: 'two slashes, default host', value: `//default.example/${marker}`, passesIn: nowhere },
  { label: 'three slashes', value: `///h${marker}.example`, passesIn: nowhere },
  { label: 'backslash', value: `/\\h${marker}.example`, passesIn: nowhere },
  { label: 'slash tab slash', value: `/\t/h${marker}.example`, passesIn: nowhere },
  { label: 'dot slash slash', value: `/.//h${marker}.example`, passesIn: nowhere },
  { label: 'NUL', value: `/a\u0000${marker}`, passesIn: nowhere },
  { label: 'LF', value: `/a\n${marker}`, passesIn: nowhere },
  { label: 'CR', value: `/a\r${marker}`, passesIn: nowhere },
  { label: 'DEL', value: `/a\u007f${marker}`, passesIn: nowhere },
  { label: 'unit separator', value: `/a\u001f${marker}`, passesIn: nowhere },
  { label: 'header injection', value: `/a\r\nx-injected: ${marker}`, passesIn: nowhere },
  { label: 'leading space', value: ` /${marker}`, passesIn: nowhere },
  { label: 'trailing space', value: `/${marker} `, passesIn: nowhere },
  { label: 'leading tab', value: `\t/${marker}`, passesIn: nowhere },
  { label: 'javascript scheme', value: `javascript:alert(${marker})`, passesIn: nowhere },
  { label: 'data scheme', value: `data:text/html,${marker}`, passesIn: nowhere },
  { label: 'userinfo', value: `${idOrigin.replace('//', `//user${marker}@`)}/cb`, passesIn: nowhere },
  { label: 'userinfo with password', value: `${idOrigin.replace('//', `//user:${marker}@`)}/cb`, passesIn: nowhere },
  { label: 'listed origin, path and query', value: `${idOrigin}/cb?x=1`, passesIn: ['B'] },
  { label: 'listed origin, no path', value: idOrigin, passesIn: ['B'] },
  { label: 'publicOrigin, not in redirectOrigins', value: `${publicOrigin}/cb`, passesIn: ['D'] },
  { label: 'publicOrigin, no path', value: publicOrigin, passesIn: ['D'] },
  { label: 'server default origin', value: `${defaultOrigin}/x`, passesIn: ['A'] },
  { label: 'http when https is listed', value: `http://id.example.com/${marker}`, passesIn: nowhere },
  { label: 'another port', value: `${idOrigin}:8443/${marker}`, passesIn: nowhere },
  { label: 'subdomain', value: `https://sub.id.example.com/${marker}`, passesIn: nowhere },
  { label: 'parent domain', value: `https://example.com/${marker}`, passesIn: nowhere },
  { label: 'suffix attack', value: `${idOrigin}.${marker}.example/`, passesIn: nowhere },
  { label: 'unlisted origin', value: `https://${marker}.example/`, passesIn: nowhere },
];

interface Probe {
  label: string;
  group: GroupKey;
  via: string;
  value: string;
  expectOk: boolean;
  route: string;
  response: RawResponse;
}

function rawGet(path: string, headers = ''): string {
  return `GET ${path} HTTP/1.1\r\nhost: x\r\nconnection: close\r\n${headers}\r\n`;
}

function expected(value: string, group: GroupKey): { ok: boolean; location: string } {
  const verdict = checkRedirect(value, groups[group].origins);
  return verdict.kind === 'ok' ? { ok: true, location: verdict.location } : { ok: false, location: '' };
}

function probeAll(port: number, refusedOnly: boolean): Promise<Probe[]> {
  const probes: Promise<Probe>[] = [];
  for (const group of groupKeys) {
    const { prefix } = groups[group];
    for (const item of cases) {
      const expectOk = item.passesIn.includes(group);
      if (refusedOnly && expectOk) {
        continue;
      }
      const path = `/${prefix}/go?to=${encodeURIComponent(item.value)}&status=302`;
      probes.push(
        rawExchange(port, rawGet(path)).then((response) => ({
          label: item.label,
          group,
          via: 'handler',
          value: item.value,
          expectOk,
          route: 'go',
          response,
        })),
      );
    }
  }
  return Promise.all(probes);
}

function probeHooks(port: number): Promise<Probe[]> {
  const hookCases: readonly Case[] = [
    { label: 'local path', value: '/home', passesIn: everywhere },
    { label: 'two slashes', value: `//h${marker}.example`, passesIn: nowhere },
    { label: 'backslash', value: `/\\h${marker}.example`, passesIn: nowhere },
    { label: 'javascript scheme', value: `javascript:alert(${marker})`, passesIn: nowhere },
    { label: 'listed origin', value: `${idOrigin}/cb`, passesIn: ['B'] },
    { label: 'unlisted origin', value: `https://${marker}.example/`, passesIn: nowhere },
  ];
  const probes: Promise<Probe>[] = [];
  for (const group of groupKeys) {
    for (const route of ['hookset', 'hooksend', 'onsend']) {
      for (const item of hookCases) {
        const path = `/${groups[group].prefix}/${route}`;
        probes.push(
          rawExchange(port, rawGet(path, `x-target: ${item.value}\r\n`)).then((response) => ({
            label: item.label,
            group,
            via: route,
            value: item.value,
            expectOk: item.passesIn.includes(group),
            route,
            response,
          })),
        );
      }
    }
  }
  return Promise.all(probes);
}

function describeProbe(probe: Probe): string {
  return `${probe.via} ${probe.label} in ${probe.group}`;
}

function judge(problems: string[], probe: Probe, summary: { sent: number; refused: number }): void {
  const label = describeProbe(probe);
  const { response } = probe;
  const wire = expected(probe.value, probe.group);
  check(
    problems,
    wire.ok === probe.expectOk,
    `${label}: checkRedirect verdict ok=${wire.ok}, the statement says ${probe.expectOk}`,
  );
  if (probe.expectOk) {
    summary.sent++;
    check(problems, response.status === 302, `${label}: status ${response.status}, expected 302`);
    check(
      problems,
      response.headers.get('location') === wire.location,
      `${label}: Location ${response.headers.get('location')}, expected ${wire.location}`,
    );
    check(
      problems,
      !probe.value.startsWith('/') || response.headers.get('location') === probe.value,
      `${label}: a local path was not sent as written: ${response.headers.get('location')}`,
    );
    return;
  }
  summary.refused++;
  check(problems, response.status === 500, `${label}: status ${response.status}, expected 500`);
  check(problems, response.body === fixed500, `${label}: body ${response.body}`);
  check(
    problems,
    !response.headers.has('location'),
    `${label}: Location on the wire: ${response.headers.get('location')}`,
  );
  check(problems, !response.headers.has('x-injected'), `${label}: an injected header reached the wire`);
  check(problems, !response.raw.includes(marker), `${label}: the target reached the wire`);
}

async function prove(): Promise<void> {
  const problems: string[] = [];
  const summary = { sent: 0, refused: 0 };
  let badStatuses = 0;
  const child = await startServerChild(fileURLToPath(import.meta.url));
  let probes: Probe[] = [];
  try {
    probes = [...(await probeAll(child.port, false)), ...(await probeHooks(child.port))];
    for (const probe of probes) {
      judge(problems, probe, summary);
    }
    for (const status of [301, 303, 307, 308]) {
      // biome-ignore lint/performance/noAwaitInLoops: Serial requests keep each status's wire bytes apart.
      const refused = await rawExchange(
        child.port,
        rawGet(`/b/go?to=${encodeURIComponent(`//h${marker}.example`)}&status=${status}`),
      );
      const sent = await rawExchange(child.port, rawGet(`/b/go?to=%2Fhome&status=${status}`));
      check(
        problems,
        refused.status === 500 && !refused.headers.has('location'),
        `${status} //host answered ${refused.status}`,
      );
      check(
        problems,
        sent.status === status && sent.headers.get('location') === '/home',
        `${status} /home answered ${sent.status} ${sent.headers.get('location')}`,
      );
    }
    const created = await rawExchange(child.port, rawGet('/c/created'));
    check(problems, created.status === 201, `201 answered ${created.status}`);
    check(
      problems,
      created.headers.get('location') === '//created.untouched.example',
      `201 Location was ${created.headers.get('location')}`,
    );
    const bare = await rawExchange(child.port, rawGet('/c/bare'));
    check(
      problems,
      bare.status === 302 && !bare.headers.has('location'),
      `302 without Location answered ${bare.status}`,
    );
    const list = await rawExchange(child.port, rawGet('/b/list'));
    check(
      problems,
      list.status === 500 && !list.headers.has('location') && list.body === fixed500,
      `array Location answered ${list.status}`,
    );
    const num = await rawExchange(child.port, rawGet('/b/num'));
    check(
      problems,
      num.status === 500 && !num.headers.has('location') && num.body === fixed500,
      `number Location answered ${num.status}`,
    );
    const statuses = ['4294967598', '-4294966994', '302.5', '199', '600', 'NaN'];
    for (const route of ['badsend', 'badsendcaught']) {
      for (const status of statuses) {
        // biome-ignore lint/performance/noAwaitInLoops: Serial requests keep each status's wire bytes apart.
        const wire = await rawExchange(child.port, rawGet(`/a/${route}`, `x-status: ${status}\r\n`));
        badStatuses++;
        const label = `${route} send status ${status}`;
        check(
          problems,
          !wire.headers.has('location'),
          `${label}: Location on the wire: ${wire.headers.get('location')}`,
        );
        check(problems, !wire.raw.includes('evil.example'), `${label}: the reply reached the wire`);
        if (route === 'badsend') {
          check(
            problems,
            wire.status === 500 && wire.body === fixed500,
            `${label}: answered ${wire.status} ${wire.body}`,
          );
        } else {
          check(
            problems,
            wire.status === 200 && wire.headers.get('x-threw') === 'Error',
            `${label}: send did not throw (${wire.status})`,
          );
        }
      }
    }
    const next = await rawExchange(child.port, rawGet(`/a/go?to=${encodeURIComponent('/home')}&status=302`));
    check(
      problems,
      next.status === 302 && next.headers.get('location') === '/home',
      `a request after the refusals answered ${next.status}`,
    );
    const missing = checkRedirect('https://id.example.com/x');
    check(
      problems,
      missing.kind === 'refused' && missing.reason === 'origin not allowed',
      'checkRedirect without origins sent an external target',
    );
    const nonString = checkRedirect(42);
    check(problems, nonString.kind === 'refused', 'checkRedirect accepted a number');
  } finally {
    await child.stop();
  }
  const stderr = child.stderr();
  check(problems, !stderr.includes(marker), 'a refused target (marker) appears in stderr');
  check(problems, !stderr.includes('example.com/cb'), 'a refused URL appears in stderr');
  const refusalLines = stderr.split('\n').filter((line) => line.includes('redirect refused at '));
  check(
    problems,
    refusalLines.length > 0 &&
      refusalLines.every((line) => /redirect refused at (go|hookset|hooksend|onsend|list|num): \S/.test(line)),
    `stderr refusal lines are not "redirect refused at <route>: <reason>": ${refusalLines.slice(0, 2).join(' | ')}`,
  );

  const diagChild = await startDiagChild(fileURLToPath(import.meta.url));
  const refusedProbes = await probeAll(diagChild.port, true);
  const diagRefusals = refusedProbes.filter((probe) => probe.response.status === 500).length;
  const diag = await diagChild.stopAndRead();
  check(problems, diagRefusals > 0, 'the diag child answered no refusal');
  check(
    problems,
    diag.names.includes('journal.jsonl') && diag.names.includes('snapshot.jsonl'),
    `diag files ${diag.names.join(',')}`,
  );
  check(problems, !diag.text.includes(marker), 'a refused target (marker) appears in the diag files');
  check(
    problems,
    !diag.text.includes('example.com/cb') && !diag.text.includes('untouched'),
    'a URL appears in the diag files',
  );
  check(problems, diag.text.includes('refuse.redirect'), 'the diag files hold no refuse.redirect event');
  check(problems, !diagChild.stderr().includes(marker), 'the target appears in the diag child stderr');

  process.stderr.write(`${JSON.stringify({ ...summary, badStatuses, probes: probes.length, diagRefusals })}\n`);
  conclude(statement, problems);
}

if (process.argv[2] === 'serve') {
  await serve();
} else {
  await prove();
}
