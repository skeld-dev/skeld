// Does:  Proves that a body refusal reaches a slow reader and that stalled, flooding and pipelined peers are bounded.
// Holds: It speaks raw TCP to a child server, so the client's timing is independent of the server's event loop.

import net from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { defineContract } from '@skeld/core/contract';
import { createServer } from '@skeld/core/server';
import * as t from '@skeld/core/schema';
import { check, conclude, parseRaw, rawExchange } from '../support/support.ts';
import { startServerChild } from '../support/support-typesystem.ts';

const statement =
  'ADR-033: body refusal survives a delayed reader, closes stalled/flooding peers within its grace, blocks pipelined handlers, and releases capacity on close and shutdown';
const body = t.object({ title: t.string({ maxLength: 36 }) });
const ok = t.object({ ok: t.boolean() });
const contract = defineContract({
  upload: { method: 'POST', path: '/upload', body, responses: { 200: ok } },
  slow: { method: 'POST', path: '/slow', body, responses: { 200: ok } },
  later: { method: 'GET', path: '/later', responses: { 200: ok } },
  stats: {
    method: 'GET',
    path: '/stats',
    responses: { 200: t.object({ reached: t.integer({ minimum: 0 }) }) },
  },
});

async function serve(): Promise<void> {
  const server = createServer({ closeTimeoutMs: 100 });
  let reached = 0;
  server.addHook('onRequest', (context) => {
    if (context.route.name === 'later') {
      reached++;
    }
  });
  server.addHook('onError', async (context) => {
    if (context.path === '/slow') {
      await delay(50);
    }
  });
  const answer = () => ({ status: 200 as const, body: { ok: true } });
  server.routes(contract, {
    upload: answer,
    slow: answer,
    later: () => {
      reached++;
      return answer();
    },
    stats: () => ({ status: 200, body: { reached } }),
  });
  const address = await server.listen({ host: '127.0.0.1', port: 0 });
  process.stdout.write(`listening ${address.port}\n`);
  process.once('SIGTERM', () => {
    void server.close();
  });
}

function head(path: string, framing: string, connection = 'close'): string {
  return `POST ${path} HTTP/1.1\r\nHost: x\r\nContent-Type: application/json\r\n${framing}\r\nConnection: ${connection}\r\n\r\n`;
}

interface Result {
  readonly status: number;
  readonly complete: boolean;
  readonly responseMs: number | null;
  readonly closedMs: number;
  readonly error: string | null;
  readonly bytes: number;
}

function exchange(port: number, initial: string, blocked = false, flood = false): Promise<Result> {
  return new Promise((resolve) => {
    const socket = net.connect({ port, host: '127.0.0.1', allowHalfOpen: true });
    const chunks: Buffer[] = [];
    let started = performance.now();
    let responseMs: number | null = null;
    let error: string | null = null;
    let settled = false;
    let writer: ReturnType<typeof setInterval> | null = null;
    const finish = (): void => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      if (writer !== null) {
        clearInterval(writer);
      }
      const text = Buffer.concat(chunks).toString('latin1');
      const response = parseRaw(text);
      const contentLength = Number(response.headers.get('content-length'));
      socket.destroy();
      resolve({
        status: response.status,
        complete: Number.isFinite(contentLength) && Buffer.byteLength(response.body, 'latin1') === contentLength,
        responseMs,
        closedMs: performance.now() - started,
        error,
        bytes: Buffer.byteLength(text, 'latin1'),
      });
    };
    const timer = setTimeout(finish, 2000);
    socket.on('error', (value: NodeJS.ErrnoException) => {
      error = value.code ?? value.message;
    });
    socket.on('close', finish);
    socket.on('data', (data: Buffer) => {
      responseMs ??= performance.now() - started;
      chunks.push(Buffer.from(data));
    });
    socket.on('connect', () => {
      started = performance.now();
      socket.write(initial);
      if (blocked) {
        // Why: Models a descheduled client, independent of the child server's event loop.
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
        for (let i = 0; i < 3; i++) {
          socket.write(Buffer.alloc(65_536, 32));
          Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5);
        }
      }
      // Why: Sending goes on after the FIN, so that a full close shows up as a write error.
      writer = setInterval(() => {
        if (!socket.destroyed && socket.writableLength < 65_536) {
          socket.write(Buffer.alloc(flood ? 65_536 : 1, 32));
        }
      }, 10);
    });
  });
}

function verify(problems: string[], label: string, result: Result): void {
  check(problems, result.status === 413 && result.complete, `${label}: incomplete 413 ${JSON.stringify(result)}`);
  check(problems, result.responseMs !== null && result.responseMs < 400, `${label}: response waited for upload`);
  check(problems, result.closedMs < 1500, `${label}: connection exceeded grace plus scheduling allowance`);
}

async function main(): Promise<void> {
  const problems: string[] = [];
  const child = await startServerChild(fileURLToPath(import.meta.url));
  const declared = head('/upload', 'Content-Length: 1048576');
  try {
    const cases = [
      ['declared-delayed', declared + ' '.repeat(65_536), true, false],
      ['keepalive-delayed', head('/upload', 'Content-Length: 1048576', 'keep-alive') + ' '.repeat(65_536), true, false],
      [
        'chunked-delayed',
        `${head('/upload', 'Transfer-Encoding: chunked')}100000\r\n${' '.repeat(65_536)}`,
        true,
        false,
      ],
      ['declared-stalled', declared + ' '.repeat(4096), false, false],
      [
        'chunked-stalled',
        `${head('/upload', 'Transfer-Encoding: chunked', 'keep-alive')}100000\r\n${' '.repeat(4096)}`,
        false,
        false,
      ],
      ['declared-flood', head('/upload', 'Content-Length: 1073741824') + ' '.repeat(4096), false, true],
    ] as const;
    await cases.reduce(async (previous, [label, request, blocked, flood]) => {
      await previous;
      const result = await exchange(child.port, request, blocked, flood);
      verify(problems, label, result);
      process.stdout.write(`${label} ${JSON.stringify(result)}\n`);
    }, Promise.resolve());

    const pipeline = 'GET /later HTTP/1.1\r\nHost: x\r\n\r\n';
    await Promise.all(
      ['/upload', '/slow'].map(async (path) => {
        const result = await exchange(
          child.port,
          head(path, 'Content-Length: 1481', 'keep-alive') + ' '.repeat(1481) + pipeline,
        );
        verify(problems, `pipeline ${path}`, result);
      }),
    );
    const statsResponse = await fetch(`http://127.0.0.1:${child.port}/stats`);
    const stats: unknown = await statsResponse.json();
    check(
      problems,
      typeof stats === 'object' && stats !== null && 'reached' in stats && stats.reached === 0,
      'pipelined request entered application',
    );

    const saturated = await Promise.all(
      Array.from({ length: 300 }, () => exchange(child.port, declared + ' '.repeat(4096))),
    );
    check(
      problems,
      saturated.every((result) => result.closedMs < 1500),
      'saturated connections not released',
    );
    process.stdout.write(
      `saturation ${JSON.stringify({ requests: saturated.length, received413: saturated.filter((result) => result.complete && result.status === 413).length, earlyCloses: saturated.filter((result) => result.closedMs < 400).length })}\n`,
    );
    verify(problems, 'capacity recovered', await exchange(child.port, declared + ' '.repeat(65_536), true));

    const peerStarted = performance.now();
    const peerResponse = await rawExchange(child.port, declared + ' '.repeat(4096));
    check(
      problems,
      peerResponse.status === 413 && performance.now() - peerStarted < 400,
      'peer EOF did not finish promptly',
    );
    const aborted = net.connect(child.port, '127.0.0.1');
    aborted.on('error', () => undefined);
    await new Promise<void>((resolve) => aborted.once('connect', resolve));
    aborted.write(declared + ' '.repeat(4096));
    await delay(20);
    aborted.destroy();
    const normal = await fetch(`http://127.0.0.1:${child.port}/upload`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{"title":"ok"}',
    });
    check(problems, normal.status === 200, 'normal request failed after refusals and peer abort');
    await normal.text();

    const pending = exchange(child.port, declared + ' '.repeat(4096));
    await delay(80);
    const started = performance.now();
    await child.stop();
    check(problems, performance.now() - started < 1500, 'shutdown retained a refused socket');
    await pending;
  } finally {
    await child.stop();
  }
  conclude(statement, problems);
}

if (process.argv[2] === 'serve') {
  await serve();
} else {
  await main();
}
