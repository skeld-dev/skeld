// Does:  Proves that a route's body limit is the smaller of bodyLimit and the cap derived from its schema.
// Holds: Each case is sent over a raw socket, both with a declared length and with chunked encoding.

import { defineContract } from '@skeld/core/contract';
import * as t from '@skeld/core/schema';
import { createServer } from '@skeld/core/server';
import { check, conclude, type RawResponse, rawExchange } from '../support/support.ts';
import { chunked, flush, openSocket, settle } from '../support/support-typesystem.ts';

const capStatement =
  'for the route body t.object({ title: t.string({ maxLength: 36 }) }) the derived cap is 1,480 bytes: Content-Length 1481 and a chunked body of 1,481 bytes are refused 413 with connection: close before a handler or preHandler runs, and a bodyLimit of 512 on the route moves the refusal point to 513';
const wideStatement =
  'a valid body of 20 string fields of maxLength 36, every character written as \\uXXXX and pretty-printed with 4-space indentation and a trailing newline, is accepted 200, and the same body padded one character past the derived cap is refused 413';

const titleCap = 1480;
const smallLimit = 512;
const fieldCount = 20;
const fieldLength = 36;
const escapedUnitBytes = 6;
const chunkedSettleMs = 300;

const titleBody = t.object({ title: t.string({ maxLength: 36 }) });
const wideProperties = Object.fromEntries(
  Array.from({ length: fieldCount }, (_, index) => [fieldName(index), t.string({ maxLength: fieldLength })]),
);
const okResponse = t.object({ ok: t.boolean() });

function fieldName(index: number): string {
  return `field${String(index).padStart(2, '0')}`;
}

const contract = defineContract({
  title: { method: 'POST', path: '/title', body: titleBody, responses: { 200: okResponse } },
  small: { method: 'POST', path: '/small', body: titleBody, responses: { 200: okResponse } },
  wide: { method: 'POST', path: '/wide', body: t.object(wideProperties), responses: { 200: okResponse } },
});

const counters = { handler: 0, preHandler: 0 };
const server = createServer();
server.addHook('preHandler', () => {
  counters.preHandler++;
});
const answer = () => {
  counters.handler++;
  return { status: 200 as const, body: { ok: true } };
};
server.routes(contract, { title: answer, small: answer, wide: answer }, { bodyLimits: { small: smallLimit } });

function head(path: string, extra: string): string {
  return `POST ${path} HTTP/1.1\r\nHost: x\r\nContent-Type: application/json\r\n${extra}\r\n\r\n`;
}

function validTitleBody(size: number): string {
  const opening = '{"title":"abc"';
  return `${opening}${' '.repeat(size - opening.length - 1)}}`;
}

function limitOf(response: RawResponse): string {
  return /limit of (\d+) bytes/.exec(response.body)?.[1] ?? `no limit in ${response.body}`;
}

async function declaredRefusal(port: number, path: string, length: number): Promise<RawResponse> {
  const exchange = openSocket(port);
  await flush(exchange.socket, head(path, `Content-Length: ${length}`));
  return settle(exchange);
}

interface ChunkedRefusal {
  earlyBytes: number;
  response: RawResponse;
}

async function chunkedRefusal(port: number, path: string, limit: number): Promise<ChunkedRefusal> {
  const exchange = openSocket(port);
  await flush(exchange.socket, head(path, 'Transfer-Encoding: chunked'));
  await flush(exchange.socket, chunked(validTitleBody(limit)));
  await new Promise((resolve) => setTimeout(resolve, chunkedSettleMs));
  const earlyBytes = exchange.bytesReceived();
  await flush(exchange.socket, chunked(' '));
  return { earlyBytes, response: await settle(exchange) };
}

function exchangeWith(port: number, path: string, body: string): Promise<RawResponse> {
  const request = `${head(path, `Content-Length: ${Buffer.byteLength(body)}\r\nConnection: close`)}${body}`;
  return rawExchange(port, request);
}

function chunkedExchange(port: number, path: string, body: string): Promise<RawResponse> {
  const request = `${head(path, 'Transfer-Encoding: chunked\r\nConnection: close')}${body.length.toString(16)}\r\n${body}\r\n0\r\n\r\n`;
  return rawExchange(port, request);
}

function escapedValue(): string {
  return Array.from(
    { length: fieldLength },
    (_, index) => `\\u${(0x61 + (index % 26)).toString(16).padStart(4, '0')}`,
  ).join('');
}

function prettyBody(padding: number): string {
  const lines = Array.from({ length: fieldCount }, (_, index) => `    "${fieldName(index)}": "${escapedValue()}"`);
  return `{\n${lines.join(',\n')}\n}${' '.repeat(padding)}\n`;
}

function wideCap(): number {
  const property = (index: number) =>
    Buffer.byteLength(JSON.stringify(fieldName(index))) + 1 + (2 + escapedUnitBytes * fieldLength);
  const dense =
    2 + Array.from({ length: fieldCount }, (_, index) => property(index)).reduce((a, b) => a + b, 0) + (fieldCount - 1);
  return 2 * dense + 1024;
}

const capProblems: string[] = [];
const wideProblems: string[] = [];
const { port: servicePort } = await server.listen({ port: 0, host: '127.0.0.1' });
try {
  const declared = await declaredRefusal(servicePort, '/title', titleCap + 1);
  check(capProblems, declared.status === 413, `Content-Length ${titleCap + 1} answered ${declared.status}`);
  check(
    capProblems,
    declared.headers.get('connection') === 'close',
    `connection was ${declared.headers.get('connection')}`,
  );
  check(capProblems, limitOf(declared) === String(titleCap), `the 413 named the limit ${limitOf(declared)}`);

  const streamed = await chunkedRefusal(servicePort, '/title', titleCap);
  check(
    capProblems,
    streamed.earlyBytes === 0,
    `${streamed.earlyBytes} response bytes arrived before byte ${titleCap + 1}`,
  );
  check(
    capProblems,
    streamed.response.status === 413,
    `chunked ${titleCap + 1} bytes answered ${streamed.response.status}`,
  );
  check(
    capProblems,
    streamed.response.headers.get('connection') === 'close',
    `chunked connection was ${streamed.response.headers.get('connection')}`,
  );

  const smallDeclared = await declaredRefusal(servicePort, '/small', smallLimit + 1);
  check(
    capProblems,
    smallDeclared.status === 413,
    `bodyLimit ${smallLimit}: Content-Length ${smallLimit + 1} answered ${smallDeclared.status}`,
  );
  check(
    capProblems,
    limitOf(smallDeclared) === String(smallLimit),
    `the 413 named the limit ${limitOf(smallDeclared)}`,
  );
  const smallStreamed = await chunkedRefusal(servicePort, '/small', smallLimit);
  check(
    capProblems,
    smallStreamed.earlyBytes === 0,
    `${smallStreamed.earlyBytes} response bytes arrived before byte ${smallLimit + 1}`,
  );
  check(
    capProblems,
    smallStreamed.response.status === 413,
    `bodyLimit ${smallLimit}: chunked answered ${smallStreamed.response.status}`,
  );

  check(
    capProblems,
    counters.handler === 0 && counters.preHandler === 0,
    `counters after the refusals: ${JSON.stringify(counters)}`,
  );

  const atCap = await exchangeWith(servicePort, '/title', validTitleBody(titleCap));
  check(capProblems, atCap.status === 200, `a valid ${titleCap}-byte body answered ${atCap.status}`);
  const atCapChunked = await chunkedExchange(servicePort, '/title', validTitleBody(titleCap));
  check(
    capProblems,
    atCapChunked.status === 200,
    `a valid chunked ${titleCap}-byte body answered ${atCapChunked.status}`,
  );
  const atSmall = await exchangeWith(servicePort, '/small', validTitleBody(smallLimit));
  check(
    capProblems,
    atSmall.status === 200,
    `a valid ${smallLimit}-byte body on the small route answered ${atSmall.status}`,
  );
  check(capProblems, counters.handler === 3, `handler counter after the three controls: ${counters.handler}`);

  const cap = wideCap();
  const valid = prettyBody(0);
  const validBytes = Buffer.byteLength(valid);
  const padded = Buffer.byteLength(prettyBody(cap - validBytes));
  const accepted = await exchangeWith(servicePort, '/wide', valid);
  check(
    wideProblems,
    accepted.status === 200,
    `the ${validBytes}-byte pretty-printed body answered ${accepted.status}`,
  );
  const atWideCap = await exchangeWith(servicePort, '/wide', prettyBody(cap - validBytes));
  check(
    wideProblems,
    atWideCap.status === 200,
    `the body padded to ${padded} bytes (the cap) answered ${atWideCap.status}`,
  );
  const pastCap = await exchangeWith(servicePort, '/wide', prettyBody(cap - validBytes + 1));
  check(wideProblems, pastCap.status === 413, `the body padded to ${cap + 1} bytes answered ${pastCap.status}`);
  check(wideProblems, limitOf(pastCap) === String(cap), `the 413 named the limit ${limitOf(pastCap)}, expected ${cap}`);
  process.stdout.write(
    `${JSON.stringify({ wideValidBytes: validBytes, wideCapComputed: cap, wideCapFrom413: limitOf(pastCap) })}\n`,
  );
} finally {
  await server.close();
}
conclude(capStatement, capProblems);
conclude(wideStatement, wideProblems);
