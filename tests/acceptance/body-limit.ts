// Does:  Proves that a body over the route's limit is answered 413 with connection: close before the handler runs.
// Holds: Both ways of exceeding the limit are sent: a declared Content-Length and streamed chunks.

import net from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import * as t from '@skeld/core/schema';
import { defineContract } from '@skeld/core/contract';
import { createServer } from '@skeld/core/server';
import { check, conclude, parseRaw, type RawResponse } from './support.ts';

const statement =
  'a body over the route body limit of 1,048,576 bytes, by declared Content-Length or by streamed bytes, answers 413 with connection: close before the handler runs';
const limit = 1_048_576;
const expectedStatus = 413;
const pieceSize = 65_536;

const contract = defineContract({
  upload: {
    method: 'POST',
    path: '/upload',
    body: t.object({ name: t.string({ unbounded: 'the 1,048,576-byte server limit is the subject of this script' }) }),
    responses: { 200: t.object({ ok: t.boolean() }) },
  },
});

let handlerRuns = 0;
const server = createServer();
server.routes(contract, {
  upload: () => {
    handlerRuns++;
    return { status: 200, body: { ok: true } };
  },
});

interface Exchange {
  socket: net.Socket;
  closed: Promise<void>;
  response: () => RawResponse;
}

function openSocket(target: number): Exchange {
  const socket = net.connect(target, '127.0.0.1');
  const chunks: Buffer[] = [];
  socket.on('data', (data) => chunks.push(Buffer.from(data)));
  socket.on('error', () => undefined);
  const closed = new Promise<void>((resolve) => socket.on('close', () => resolve()));
  return { socket, closed, response: () => parseRaw(Buffer.concat(chunks).toString('latin1')) };
}

function head(extra: string): string {
  return `POST /upload HTTP/1.1\r\nHost: x\r\nContent-Type: application/json\r\n${extra}\r\n\r\n`;
}

function flush(socket: net.Socket, data: string | Buffer): Promise<void> {
  return new Promise((resolve) => socket.write(data, () => resolve()));
}

async function writeChunked(socket: net.Socket, remaining: number): Promise<void> {
  if (remaining <= 0 || socket.destroyed) {
    return;
  }
  const size = Math.min(pieceSize, remaining);
  await flush(socket, `${size.toString(16)}\r\n`);
  await flush(socket, Buffer.alloc(size, 0x61));
  await flush(socket, '\r\n');
  await writeChunked(socket, remaining - size);
}

async function settle(exchange: Exchange): Promise<RawResponse> {
  await Promise.race([exchange.closed, delay(3000, undefined, { ref: false })]);
  exchange.socket.destroy();
  return exchange.response();
}

const problems: string[] = [];
const { port } = await server.listen({ port: 0, host: '127.0.0.1' });
try {
  const declared = openSocket(port);
  await flush(declared.socket, head(`Content-Length: ${limit + 1}`));
  const declaredResponse = await settle(declared);
  check(problems, declaredResponse.status === expectedStatus, `declared length answered ${declaredResponse.status}`);
  check(
    problems,
    declaredResponse.headers.get('connection') === 'close',
    `declared length connection header was ${declaredResponse.headers.get('connection')}`,
  );

  const streamed = openSocket(port);
  await flush(streamed.socket, head('Transfer-Encoding: chunked'));
  await writeChunked(streamed.socket, limit + 1);
  if (!streamed.socket.destroyed) {
    await flush(streamed.socket, '0\r\n\r\n');
  }
  const streamedResponse = await settle(streamed);
  check(problems, streamedResponse.status === expectedStatus, `streamed body answered ${streamedResponse.status}`);
  check(
    problems,
    streamedResponse.headers.get('connection') === 'close',
    `streamed body connection header was ${streamedResponse.headers.get('connection')}`,
  );

  check(problems, handlerRuns === 0, `handler ran ${handlerRuns} times for oversize bodies`);
} finally {
  await server.close();
}
conclude(statement, problems);
