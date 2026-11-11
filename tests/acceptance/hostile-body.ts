// Does:  Proves that four hostile 1 MiB bodies are each refused, and prints how long each refusal takes.
// Holds: Statuses and bodies decide the result; the timings are printed and judged elsewhere.

import net from 'node:net';
import { fileURLToPath } from 'node:url';
import { defineContract } from '@darkstart/core/contract';
import * as t from '@darkstart/core/schema';
import { createServer } from '@darkstart/core/server';
import { check, conclude } from './support.ts';
import { startServerChild } from './support-typesystem.ts';

const statement =
  'each of four 1 MiB hostile bodies (96,333 undeclared keys, one 1 MiB string, a 100,000-integer array, nesting 524,279 deep) sent to the route t.object({ title: t.string({ maxLength: 36 }) }) is refused 413, 100 times each';
const expectedStatus = 413;
const requestsPerShape = 100;
const limit = 1_048_576;
const nestingDepth = 524_279;
const arrayLength = 100_000;
const responseTimeoutMs = 10_000;
const pieceSize = 65_536;

const contract = defineContract({
  title: {
    method: 'POST',
    path: '/title',
    body: t.object({ title: t.string({ maxLength: 36 }) }),
    responses: { 200: t.object({ ok: t.boolean() }) },
  },
  usage: {
    method: 'GET',
    path: '/usage',
    responses: { 200: t.object({ user: t.integer({ minimum: 0 }), system: t.integer({ minimum: 0 }) }) },
  },
});

async function serve(): Promise<void> {
  const server = createServer();
  server.routes(contract, {
    title: () => ({ status: 200, body: { ok: true } }),
    usage: () => {
      const { user, system } = process.cpuUsage();
      return { status: 200, body: { user, system } };
    },
  });
  const { port } = await server.listen({ port: 0, host: '127.0.0.1' });
  process.stdout.write(`listening ${port}\n`);
}

function padTo(text: string, size: number): string {
  return `${text.slice(0, -1)}${' '.repeat(size - Buffer.byteLength(text))}}`;
}

function keysBody(count: number): string {
  const parts = ['{"title":"t"'];
  for (let index = 0; index < count; index++) {
    parts.push(`,"k${index}":0`);
  }
  parts.push('}');
  return parts.join('');
}

function largestKeyCount(): number {
  let low = 1;
  let high = 200_000;
  while (low < high) {
    const middle = (low + high + 1) >> 1;
    if (Buffer.byteLength(keysBody(middle)) <= limit) {
      low = middle;
    } else {
      high = middle - 1;
    }
  }
  return low;
}

function hostileBodies(): Record<string, string> {
  const opening = '{"title":"';
  const integers = Array.from({ length: arrayLength }, (_, index) => 100_000_000 + index);
  return {
    h1: padTo(keysBody(largestKeyCount()), limit),
    h2: `${opening}${'a'.repeat(limit - opening.length - 2)}"}`,
    h3: padTo(`{"title":"t","items":[${integers.join(',')}]}`, limit),
    h4: `{"title":"t","x":${'['.repeat(nestingDepth)}${']'.repeat(nestingDepth)}}`,
  };
}

function sendPieces(socket: net.Socket, request: Buffer, offset: number, stop: () => boolean): void {
  if (offset >= request.length || stop() || socket.destroyed) {
    return;
  }
  socket.write(request.subarray(offset, offset + pieceSize), () =>
    setImmediate(() => sendPieces(socket, request, offset + pieceSize, stop)),
  );
}

interface Refusal {
  status: number;
  ms: number;
}

function refuse(port: number, request: Buffer): Promise<Refusal> {
  return new Promise((resolve) => {
    const socket = net.connect(port, '127.0.0.1');
    const chunks: Buffer[] = [];
    let started = 0;
    let settled = false;
    const finish = (status: number) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      const ms = performance.now() - started;
      socket.destroy();
      resolve({ status, ms });
    };
    const timer = setTimeout(() => finish(0), responseTimeoutMs);
    socket.on('connect', () => {
      started = performance.now();
      sendPieces(socket, request, 0, () => settled);
    });
    socket.on('data', (data) => {
      chunks.push(Buffer.from(data));
      const text = Buffer.concat(chunks).toString('latin1');
      if (text.includes('\r\n\r\n')) {
        finish(Number(text.split(' ')[1]));
      }
    });
    socket.on('close', () => finish(0));
    socket.on('error', () => undefined);
  });
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? Number.NaN;
}

async function refuseMany(port: number, request: Buffer, remaining: number, into: Refusal[]): Promise<Refusal[]> {
  if (remaining === 0) {
    return into;
  }
  into.push(await refuse(port, request));
  return refuseMany(port, request, remaining - 1, into);
}

async function main(): Promise<void> {
  const problems: string[] = [];
  const child = await startServerChild(fileURLToPath(import.meta.url));
  const usage = async (): Promise<number> => {
    const response = await fetch(`http://127.0.0.1:${child.port}/usage`);
    const body: unknown = await response.json();
    const user = typeof body === 'object' && body !== null && 'user' in body ? Number(body.user) : Number.NaN;
    const system = typeof body === 'object' && body !== null && 'system' in body ? Number(body.system) : Number.NaN;
    return user + system;
  };
  const measureShape = async ([shape, text]: [string, string]): Promise<unknown> => {
    const bytes = Buffer.byteLength(text);
    const head = `POST /title HTTP/1.1\r\nHost: x\r\nContent-Type: application/json\r\nContent-Length: ${bytes}\r\nConnection: close\r\n\r\n`;
    const request = Buffer.concat([Buffer.from(head, 'latin1'), Buffer.from(text, 'utf8')]);
    check(problems, bytes === limit, `${shape} is ${bytes} bytes, not ${limit}`);
    const cpuBefore = await usage();
    const refusals = await refuseMany(child.port, request, requestsPerShape, []);
    const cpuAfter = await usage();
    const statuses: Record<string, number> = {};
    for (const refusal of refusals) {
      statuses[refusal.status] = (statuses[refusal.status] ?? 0) + 1;
    }
    check(
      problems,
      statuses[expectedStatus] === requestsPerShape,
      `${shape} statuses were ${JSON.stringify(statuses)}`,
    );
    return {
      shape,
      bytes,
      statuses,
      medianMs: median(refusals.map((refusal) => refusal.ms)),
      serverCpuUsPerRefusal: (cpuAfter - cpuBefore) / requestsPerShape,
    };
  };
  const results: unknown[] = [];
  try {
    const shapes = Object.entries(hostileBodies());
    await shapes.reduce(async (previous, entry) => {
      await previous;
      results.push(await measureShape(entry));
    }, Promise.resolve());
  } finally {
    await child.stop();
  }
  process.stdout.write(`${JSON.stringify(results)}\n`);
  conclude(statement, problems);
}

if (process.argv[2] === 'serve') {
  await serve();
} else {
  await main();
}
