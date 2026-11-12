// Does:  Proves every response carries the four security headers once, unless an author sets one or the option is off.
// Holds: Responses are read as raw header lines, so a duplicate line or a changed value cannot hide.

import net from 'node:net';
import { defineContract } from '@skeld/core/contract';
import * as t from '@skeld/core/schema';
import { createServer } from '@skeld/core/server';
import { check, conclude } from '../support/support.ts';

const statement =
  'a 200, 204, hook send, validation 400, thrown 500, unknown-path 404 and 503 timeout each carry x-content-type-options nosniff, content-security-policy frame-ancestors none, x-frame-options DENY and cache-control no-store once; an author cache-control from a reply or setHeader replaces only that line; an engine-written error after a hook set it public carries no-store; with securityHeaders false none of the four is on those responses';

const defaults: readonly (readonly [string, string])[] = [
  ['x-content-type-options', 'nosniff'],
  ['content-security-policy', "frame-ancestors 'none'"],
  ['x-frame-options', 'DENY'],
  ['cache-control', 'no-store'],
];
const publicCache = 'public, max-age=60';

const note = t.object({ ok: t.boolean() });
const contract = defineContract({
  ok: { method: 'GET', path: '/ok', responses: { 200: note } },
  empty: { method: 'GET', path: '/empty', responses: { 204: null } },
  hooksend: { method: 'GET', path: '/hooksend', responses: { 200: note } },
  val: { method: 'GET', path: '/val', query: t.object({ n: t.integer({ minimum: 0 }) }), responses: { 200: note } },
  boom: { method: 'GET', path: '/boom', responses: { 200: note } },
  hang: { method: 'GET', path: '/hang', responses: { 200: note } },
  cachey: { method: 'GET', path: '/cachey', responses: { 200: note } },
  hookcache: { method: 'GET', path: '/hookcache', responses: { 200: note } },
  hookcacheboom: { method: 'GET', path: '/hookcacheboom', responses: { 200: note } },
  hookcacheval: {
    method: 'GET',
    path: '/hookcacheval',
    query: t.object({ n: t.integer({ minimum: 0 }) }),
    responses: { 200: note },
  },
});

const plain = () => ({ status: 200 as const, body: { ok: true } });
const hookCacheRoutes = new Set(['hookcache', 'hookcacheboom', 'hookcacheval']);

async function start(securityHeaders: boolean | undefined) {
  const server = createServer({ handlerTimeoutMs: 300, ...(securityHeaders === undefined ? {} : { securityHeaders }) });
  server.addHook('onRequest', (context) => {
    if (context.route.name === 'hooksend') {
      context.send({ status: 200, payload: '{"ok":true}' });
    }
    if (hookCacheRoutes.has(context.route.name)) {
      context.setHeader('cache-control', publicCache);
    }
  });
  server.routes(contract, {
    ok: plain,
    empty: () => ({ status: 204 }),
    hooksend: plain,
    val: plain,
    boom: () => {
      throw new Error('probe-secret-detail');
    },
    hang: () => new Promise<never>(() => undefined),
    cachey: () => ({ ...plain(), headers: { 'cache-control': publicCache } }),
    hookcache: plain,
    hookcacheboom: () => {
      throw new Error('probe-secret-detail');
    },
    hookcacheval: plain,
  });
  const { port } = await server.listen({ port: 0, host: '127.0.0.1' });
  return { port, stop: () => server.close() };
}

interface Wire {
  status: number;
  lines: [string, string][];
}

function fetchWire(port: number, path: string): Promise<Wire> {
  return new Promise((resolve) => {
    const socket = net.connect(port, '127.0.0.1');
    const chunks: Buffer[] = [];
    const finish = () => {
      clearTimeout(timer);
      socket.destroy();
      const raw = Buffer.concat(chunks).toString('latin1');
      const head = raw.split('\r\n\r\n')[0] ?? '';
      const [statusLine = '', ...headerLines] = head.split('\r\n');
      const lines: [string, string][] = [];
      for (const line of headerLines) {
        const colon = line.indexOf(':');
        if (colon > 0) {
          lines.push([line.slice(0, colon).toLowerCase(), line.slice(colon + 1).trim()]);
        }
      }
      resolve({ status: Number(statusLine.split(' ')[1]), lines });
    };
    const timer = setTimeout(finish, 3000);
    socket.on('data', (data) => chunks.push(Buffer.from(data)));
    socket.on('close', finish);
    socket.on('error', () => undefined);
    socket.write(`GET ${path} HTTP/1.1\r\nhost: x\r\nconnection: close\r\n\r\n`, 'latin1');
  });
}

const problems: string[] = [];
const log: string[] = [];

function lineValues(wire: Wire, name: string): string[] {
  return wire.lines.filter(([lineName]) => lineName === name).map(([, value]) => value);
}

function expectDefaults(
  label: string,
  wire: Wire,
  status: number,
  overrides: ReadonlyMap<string, string> = new Map(),
): void {
  check(problems, wire.status === status, `${label}: status ${wire.status}, expected ${status}`);
  for (const [name, standard] of defaults) {
    const values = lineValues(wire, name);
    const expected = overrides.get(name) ?? standard;
    check(
      problems,
      values.length === 1 && values[0] === expected,
      `${label}: ${name} lines ${JSON.stringify(values)}, expected one ${expected}`,
    );
  }
  log.push(`${label}: ${wire.status} ${defaults.map(([name]) => lineValues(wire, name).join('|')).join(' / ')}`);
}

function expectNone(label: string, wire: Wire, status: number): void {
  check(problems, wire.status === status, `${label}: status ${wire.status}, expected ${status}`);
  for (const [name] of defaults) {
    const values = lineValues(wire, name);
    check(problems, values.length === 0, `${label}: ${name} lines ${JSON.stringify(values)}, expected none`);
  }
  log.push(`${label}: ${wire.status} no security header line`);
}

const matrix: readonly (readonly [string, string, number])[] = [
  ['200 JSON', '/ok', 200],
  ['204', '/empty', 204],
  ['hook send', '/hooksend', 200],
  ['validation 400', '/val', 400],
  ['thrown 500', '/boom', 500],
  ['unknown path 404', '/nope', 404],
  ['timeout 503', '/hang', 503],
];

const extras: readonly (readonly [string, string, number])[] = [
  ['reply sets cache-control public', '/cachey', 200],
  ['setHeader sets cache-control public', '/hookcache', 200],
  ['500 after a hook set cache-control public', '/hookcacheboom', 500],
  ['400 after a hook set cache-control public', '/hookcacheval', 400],
];

async function wires(port: number, rows: readonly (readonly [string, string, number])[]): Promise<Map<string, Wire>> {
  const fetched = await Promise.all(rows.map(async ([label, path]) => [label, await fetchWire(port, path)] as const));
  return new Map(fetched);
}

function wireOf(all: Map<string, Wire>, label: string): Wire {
  return all.get(label) ?? { status: 0, lines: [] };
}

const on = await start(undefined);
const off = await start(false);
try {
  const [onAll, extraAll, offAll] = await Promise.all([
    wires(on.port, matrix),
    wires(on.port, extras),
    wires(off.port, matrix),
  ]);
  for (const [label, , status] of matrix) {
    expectDefaults(label, wireOf(onAll, label), status);
    expectNone(`securityHeaders false, ${label}`, wireOf(offAll, label), status);
  }
  for (const [label, , status] of extras) {
    const owned = status === 200 ? new Map([['cache-control', publicCache]]) : undefined;
    expectDefaults(label, wireOf(extraAll, label), status, owned);
  }
} finally {
  await Promise.all([on.stop(), off.stop()]);
}

process.stdout.write(`${log.join('\n')}\n`);
conclude(statement, problems);
