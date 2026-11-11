// Does:  Proves that a stalled request line and a stalled body are answered 408 within the checking interval.
// Holds: Measured with short timeouts and with the defaults, each answer inside a wall-clock window.

import http from 'node:http';
import { syncBuiltinESMExports } from 'node:module';
import net from 'node:net';
import { fileURLToPath } from 'node:url';
import { check, conclude, parseRaw } from './support.ts';
import { startServerChild } from './support-typesystem.ts';

const statement =
  'with headersTimeout 2000 and requestTimeout 4000 half a request line is answered 408 within 2000 to 3250 ms and half a body within 4000 to 5250 ms; with 20000 and 40000 unfinished headers within 20000 to 22250 ms; at the defaults the connection check runs every 6000 ms';
const defaultInterval = 6000;
const settingsKey = 'DARKSTART_PROBE_TIMEOUTS';
const slackAfterMs = 5000;

function intervalOf(server: http.Server | undefined): number {
  const held: unknown = server === undefined ? undefined : Reflect.get(server, 'connectionsCheckingInterval');
  return typeof held === 'number' ? held : 0;
}

async function serve(): Promise<void> {
  let captured: http.Server | undefined;
  const original = http.createServer;
  Reflect.set(http, 'createServer', (...args: unknown[]) => {
    captured = Reflect.apply(original, http, args);
    return captured;
  });
  syncBuiltinESMExports();
  const { defineContract } = await import('@darkstart/core/contract');
  const t = await import('@darkstart/core/schema');
  const { createServer } = await import('@darkstart/core/server');
  const contract = defineContract({
    interval: {
      method: 'GET',
      path: '/interval',
      responses: { 200: t.object({ ms: t.integer({ minimum: 0 }) }) },
    },
    echo: {
      method: 'POST',
      path: '/echo',
      body: t.object({ a: t.string({ maxLength: 200 }) }),
      responses: { 200: t.object({ ok: t.boolean() }) },
    },
  });
  const settings = process.env[settingsKey] ?? '';
  const [headersTimeout, requestTimeout] = settings === '' ? [undefined, undefined] : settings.split(',').map(Number);
  const server = createServer(
    headersTimeout === undefined || requestTimeout === undefined ? {} : { headersTimeout, requestTimeout },
  );
  server.routes(contract, {
    interval: () => ({ status: 200, body: { ms: intervalOf(captured) } }),
    echo: () => ({ status: 200, body: { ok: true } }),
  });
  const { port } = await server.listen({ port: 0, host: '127.0.0.1' });
  process.stdout.write(`listening ${port}\n`);
}

interface Timed {
  readonly status: number;
  readonly firstByteMs: number;
  readonly closedMs: number;
}

function timeIncomplete(port: number, piece: string, limitMs: number): Promise<Timed> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let connectedAt = 0;
    let firstByteMs = -1;
    const socket = net.connect(port, '127.0.0.1');
    const finish = () => {
      clearTimeout(timer);
      socket.destroy();
      const status = parseRaw(Buffer.concat(chunks).toString('latin1')).status;
      resolve({
        status: Number.isNaN(status) ? 0 : status,
        firstByteMs,
        closedMs: Math.round(performance.now() - connectedAt),
      });
    };
    const timer = setTimeout(finish, limitMs);
    socket.on('connect', () => {
      connectedAt = performance.now();
      socket.write(piece, 'latin1');
    });
    socket.on('data', (data) => {
      if (firstByteMs < 0) {
        firstByteMs = Math.round(performance.now() - connectedAt);
      }
      chunks.push(Buffer.from(data));
    });
    socket.on('close', finish);
    socket.on('error', () => undefined);
  });
}

async function readInterval(port: number): Promise<number> {
  const response = await fetch(`http://127.0.0.1:${port}/interval`);
  const body: unknown = await response.json();
  return typeof body === 'object' && body !== null && 'ms' in body && typeof body.ms === 'number' ? body.ms : -1;
}

async function prove(): Promise<void> {
  const problems: string[] = [];
  const script = fileURLToPath(import.meta.url);
  process.env[settingsKey] = '2000,4000';
  const fast = await startServerChild(script);
  process.env[settingsKey] = '20000,40000';
  const slow = await startServerChild(script);
  process.env[settingsKey] = '';
  const standard = await startServerChild(script);
  const log: string[] = [];
  try {
    const halfBody =
      'POST /echo HTTP/1.1\r\nhost: x\r\ncontent-type: application/json\r\ncontent-length: 100\r\n\r\n{"a":"';
    const [halfLine, halfBodyResult, unfinishedHeaders, fastInterval, slowInterval, defaultsInterval] =
      await Promise.all([
        timeIncomplete(fast.port, 'GET /interv', 2000 + slackAfterMs),
        timeIncomplete(fast.port, halfBody, 4000 + slackAfterMs),
        timeIncomplete(slow.port, 'GET /interval HTTP/1.1\r\nhost: x\r\nx-slow: ', 20_000 + slackAfterMs),
        readInterval(fast.port),
        readInterval(slow.port),
        readInterval(standard.port),
      ]);
    log.push(`2000/4000 half request line: ${JSON.stringify(halfLine)}`);
    log.push(`2000/4000 half body: ${JSON.stringify(halfBodyResult)}`);
    log.push(`20000/40000 unfinished headers: ${JSON.stringify(unfinishedHeaders)}`);
    log.push(
      `connection check interval ms: 2000/4000 ${fastInterval}, 20000/40000 ${slowInterval}, defaults ${defaultsInterval}`,
    );
    const inBand = (label: string, result: Timed, low: number, high: number) => {
      check(problems, result.status === 408, `${label} answered ${result.status}, not 408`);
      check(
        problems,
        result.firstByteMs >= low && result.firstByteMs <= high,
        `${label} first byte at ${result.firstByteMs} ms, outside ${low} to ${high}`,
      );
    };
    inBand('half request line (2000)', halfLine, 2000, 3250);
    inBand('half body (4000)', halfBodyResult, 4000, 5250);
    inBand('unfinished headers (20000)', unfinishedHeaders, 20_000, 22_250);
    check(
      problems,
      defaultsInterval === defaultInterval,
      `defaults connection check interval was ${defaultsInterval} ms, not ${defaultInterval}`,
    );
  } finally {
    await Promise.all([fast.stop(), slow.stop(), standard.stop()]);
  }
  process.stdout.write(`${log.join('\n')}\n`);
  conclude(statement, problems);
}

if (process.argv[2] === 'serve') {
  await serve();
} else {
  await prove();
}
