// Does:  Proves clientAddress is the socket peer, or the right X-Forwarded-For entry only when the peer is trusted.
// Holds: Requests are raw bytes with exact header lines, and one request reads the same value at all five sites.

import net from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { BootError } from '@darkstart/core/boot-error';
import { defineContract } from '@darkstart/core/contract';
import * as t from '@darkstart/core/schema';
import { createServer } from '@darkstart/core/server';
import { check, conclude, parseRaw } from './support.ts';

const statement =
  'without trustProxy clientAddress is the socket peer whatever X-Forwarded-For says; with 127.0.0.1 and 10.0.0.0/8 trusted the rightmost untrusted entry wins over a spoofed leftmost, two header lines are one list, a malformed entry stops the walk at the last address read, an all-trusted list gives the leftmost, IPv6 entries and ranges match, a peer off the list is used as it is, a malformed trustProxy is refused at boot, and one request reads one value at five sites';

const site = ['onRequest', 'preHandler', 'handler', 'onSend', 'onResponse'] as const;
const contract = defineContract({
  who: {
    method: 'GET',
    path: '/who/:id',
    params: t.object({ id: t.string({ maxLength: 32 }) }),
    responses: { 200: t.object({ address: t.string({ maxLength: 64 }) }) },
  },
});

interface Running {
  port: number;
  seen: Map<string, Map<string, string>>;
  stop: () => Promise<void>;
}

async function start(host: string, trustProxy?: string[]): Promise<Running> {
  const seen = new Map<string, Map<string, string>>();
  const record = (path: string, name: string, address: string) => {
    const row = seen.get(path) ?? new Map<string, string>();
    seen.set(path, row);
    row.set(name, address);
  };
  const server = createServer(trustProxy === undefined ? {} : { trustProxy });
  server.addHook('onRequest', (context) => record(context.path, 'onRequest', context.clientAddress));
  server.addHook('preHandler', (context) => record(context.path, 'preHandler', context.clientAddress));
  server.addHook('onSend', (context) => record(context.path, 'onSend', context.clientAddress));
  server.addHook('onResponse', (context) => record(context.path, 'onResponse', context.clientAddress));
  server.routes(contract, {
    who: (request) => {
      record(`/who/${request.params.id}`, 'handler', request.clientAddress);
      return { status: 200, body: { address: request.clientAddress } };
    },
  });
  const { port } = await server.listen({ port: 0, host });
  return { port, seen, stop: () => server.close() };
}

function exchange(host: string, port: number, request: string): Promise<string> {
  return new Promise((resolve) => {
    const socket = net.connect(port, host);
    const chunks: Buffer[] = [];
    const finish = () => {
      clearTimeout(timer);
      socket.destroy();
      resolve(Buffer.concat(chunks).toString('latin1'));
    };
    const timer = setTimeout(finish, 3000);
    socket.on('data', (data) => chunks.push(Buffer.from(data)));
    socket.on('close', finish);
    socket.on('error', () => undefined);
    socket.write(request, 'latin1');
  });
}

const problems: string[] = [];
const log: string[] = [];
let counter = 0;

async function ask(
  running: Running,
  label: string,
  forwarded: readonly string[],
  expected: string | ((address: string) => boolean),
  host = '127.0.0.1',
): Promise<void> {
  counter++;
  const id = `r${counter}`;
  const lines = forwarded.map((value) => `X-Forwarded-For: ${value}\r\n`).join('');
  const raw = await exchange(
    host,
    running.port,
    `GET /who/${id} HTTP/1.1\r\nhost: x\r\nconnection: close\r\n${lines}\r\n`,
  );
  const response = parseRaw(raw);
  let address = '';
  try {
    const parsed: unknown = JSON.parse(response.body);
    const field = typeof parsed === 'object' && parsed !== null ? Reflect.get(parsed, 'address') : undefined;
    address = typeof field === 'string' ? field : '';
  } catch {
    address = `unparsable ${response.body}`;
  }
  await delay(60);
  const row = running.seen.get(`/who/${id}`) ?? new Map<string, string>();
  const matches = typeof expected === 'string' ? address === expected : expected(address);
  check(
    problems,
    response.status === 200 && matches,
    `${label}: status ${response.status}, clientAddress ${address}, expected ${typeof expected === 'string' ? expected : 'a socket address'}`,
  );
  const values = site.map((name) => row.get(name));
  check(
    problems,
    values.every((value) => value === address),
    `${label}: sites read ${JSON.stringify(Object.fromEntries(row))}, body ${address}`,
  );
  log.push(`${label}: ${address}`);
}

const trusted = ['127.0.0.1', '10.0.0.0/8'];

const open = await start('127.0.0.1');
const proxied = await start('127.0.0.1', trusted);
const offList = await start('127.0.0.1', ['10.0.0.0/8']);
const sixOne = await start('127.0.0.1', [...trusted, 'fd00::/8', '2001:db8::1']);

try {
  await ask(open, 'no trustProxy, spoofed header', ['6.6.6.6'], '127.0.0.1');
  await ask(open, 'no trustProxy, two spoofed lines', ['6.6.6.6', '203.0.113.9'], '127.0.0.1');

  await ask(proxied, 'spoofed leftmost', ['6.6.6.6, 203.0.113.9, 10.1.1.1, 10.0.0.2'], '203.0.113.9');
  await ask(proxied, 'two lines, the second holds the client', ['6.6.6.6', '203.0.113.9, 10.0.0.2'], '203.0.113.9');
  await ask(proxied, 'two lines, the first holds the client', ['203.0.113.9, 10.1.1.1', '10.0.0.2'], '203.0.113.9');
  await ask(proxied, 'two lines, the last one is the client', ['6.6.6.6, 10.0.0.2', '198.51.100.4'], '198.51.100.4');
  await ask(proxied, 'malformed entry after trusted ones', ['6.6.6.6, 203.0.113.9, garbage, 10.0.0.2'], '10.0.0.2');
  await ask(proxied, 'malformed rightmost entry', ['203.0.113.9, garbage'], '127.0.0.1');
  await ask(proxied, 'out of range octet rightmost', ['203.0.113.9, 300.1.1.1'], '127.0.0.1');
  await ask(proxied, 'all entries trusted', ['10.0.0.9, 10.1.1.1, 10.0.0.2'], '10.0.0.9');
  await ask(proxied, 'no header', [], '127.0.0.1');

  await ask(offList, 'peer not trusted, header ignored', ['203.0.113.9'], '127.0.0.1');
  await ask(offList, 'peer not trusted, trusted-looking header', ['10.0.0.2'], '127.0.0.1');

  await ask(sixOne, 'IPv6 entry and IPv6 range trusted', ['198.51.100.7, fd00::5, 2001:db8::1'], '198.51.100.7');
  await ask(sixOne, 'IPv6 range does not cover fe80::5', ['198.51.100.7, fe80::5, 10.0.0.2'], 'fe80::5');
} finally {
  await Promise.all([open.stop(), proxied.stop(), offList.stop(), sixOne.stop()]);
}

const badEntries = [
  'not-an-ip',
  '10.0.0.0/33',
  '10.0.0.0/',
  '1.2.3',
  '',
  '::/129',
  '10.0.0.0/8/8',
  '999.0.0.1',
  '10.0.0.0/-1',
];
for (const entry of badEntries) {
  try {
    createServer({ trustProxy: [entry] });
    problems.push(`trustProxy ${JSON.stringify(entry)} was accepted`);
  } catch (error) {
    check(
      problems,
      error instanceof BootError && error.code === 'INVALID_OPTION',
      `trustProxy ${JSON.stringify(entry)} threw ${error instanceof BootError ? error.code : String(error)}`,
    );
  }
}
try {
  createServer({ trustProxy: ['127.0.0.1', '10.0.0.0/8', 'fd00::/8', '2001:db8::1', '::1'] });
} catch (error) {
  problems.push(`a well-formed trustProxy was refused: ${String(error)}`);
}
log.push(`${badEntries.length} malformed trustProxy entries refused with INVALID_OPTION, a well-formed list accepted`);

async function ipv6(): Promise<void> {
  const mapped = await start('::', ['127.0.0.1']).catch((error: unknown) => {
    log.push(`unverified: could not listen on :: (${String(error)})`);
    return null;
  });
  if (mapped !== null) {
    const unlisted = await start('::', ['10.0.0.0/8']);
    const none = await start('::');
    try {
      await ask(mapped, 'IPv4-mapped peer matches the IPv4 entry 127.0.0.1', ['203.0.113.9'], '203.0.113.9');
      await ask(unlisted, 'IPv4-mapped peer, 127.0.0.1 not trusted', ['203.0.113.9'], (address) =>
        address.endsWith('127.0.0.1'),
      );
      await ask(none, 'IPv4-mapped peer, no trustProxy', ['203.0.113.9'], (address) => address.endsWith('127.0.0.1'));
    } finally {
      await Promise.all([mapped.stop(), unlisted.stop(), none.stop()]);
    }
  }
  const loopback6 = await start('::1', ['::1']).catch((error: unknown) => {
    log.push(`unverified: could not listen on ::1 (${String(error)})`);
    return null;
  });
  if (loopback6 !== null) {
    const unlisted6 = await start('::1', ['127.0.0.1']);
    try {
      await ask(loopback6, '::1 peer matches the ::1 entry', ['203.0.113.9'], '203.0.113.9', '::1');
      await ask(unlisted6, '::1 peer not on the list', ['203.0.113.9'], '::1', '::1');
    } finally {
      await Promise.all([loopback6.stop(), unlisted6.stop()]);
    }
  }
}
await ipv6();

process.stdout.write(`${log.join('\n')}\n`);
conclude(statement, problems);
