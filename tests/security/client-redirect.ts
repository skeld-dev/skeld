// Does:  Proves the typed client rejects every redirect status without a second request and lets a 304 through.
// Holds: The Location target is a separate node:http server that records every request it receives, body included.

// biome-ignore-all lint/performance/noAwaitInLoops: each call is sent alone so the target's record of requests stays attributable
import http from 'node:http';
import { createClient } from '@skeld/core/client';
import { defineContract } from '@skeld/core/contract';
import { HttpError } from '@skeld/core/http-error';
import * as t from '@skeld/core/schema';
import { check, conclude } from '../support/support.ts';

const statement =
  'a client call answered 301, 302, 303, 307 or 308 rejects with REDIRECT_NOT_SUPPORTED and a null status, makes no request to the Location target (a POST body is never delivered there), and keeps the Location value out of the message; a 304 answer resolves with status 304';
const redirectStatuses = [301, 302, 303, 307, 308];
const locationToken = 'location-token-7f3a91c2';
const postedNote = 'posted-note-5d20e8b4';

const contract = defineContract({
  fetchIt: {
    method: 'GET',
    path: '/go',
    query: t.object({ mode: t.string({ maxLength: 8 }) }),
    responses: { 200: t.object({ ok: t.boolean() }) },
  },
  sendIt: {
    method: 'POST',
    path: '/post',
    query: t.object({ mode: t.string({ maxLength: 8 }) }),
    body: t.object({ note: t.string({ maxLength: 40 }) }),
    responses: { 200: t.object({ ok: t.boolean() }) },
  },
});

interface Seen {
  method: string;
  url: string;
  body: string;
}

const targetSeen: Seen[] = [];
const target = http.createServer((req, res) => {
  const chunks: Buffer[] = [];
  req.on('data', (chunk: Buffer) => chunks.push(chunk));
  req.on('end', () => {
    targetSeen.push({ method: req.method ?? '', url: req.url ?? '', body: Buffer.concat(chunks).toString('utf8') });
    res.writeHead(200, { 'content-type': 'application/json' }).end('{"ok":true}');
  });
});

async function listen(server: http.Server): Promise<number> {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('a server did not bind a TCP port');
  }
  return address.port;
}

const targetPort = await listen(target);
const locationValue = `http://127.0.0.1:${targetPort}/landing/${locationToken}`;

const answerer = http.createServer((req, res) => {
  const mode = new URL(req.url ?? '/', 'http://peer').searchParams.get('mode') ?? '';
  req.resume();
  req.on('end', () => {
    const status = Number(mode);
    if (status === 304) {
      res.writeHead(304).end();
    } else {
      res.writeHead(status, { location: locationValue }).end();
    }
  });
});
const answererPort = await listen(answerer);
const client = createClient(contract, { baseUrl: `http://127.0.0.1:${answererPort}` });

type Outcome = { kind: 'resolved'; status: number } | { kind: 'rejected'; error: unknown };

async function observe(invoke: () => Promise<{ status: number }>): Promise<Outcome> {
  try {
    return { kind: 'resolved', status: (await invoke()).status };
  } catch (error) {
    return { kind: 'rejected', error };
  }
}

function describe(outcome: Outcome): string {
  if (outcome.kind === 'resolved') {
    return `resolved ${outcome.status}`;
  }
  return outcome.error instanceof HttpError
    ? `HttpError ${outcome.error.code} status ${String(outcome.error.status)}`
    : String(outcome.error);
}

const problems: string[] = [];

function expectRedirectRefusal(label: string, outcome: Outcome): void {
  const refused =
    outcome.kind === 'rejected' &&
    outcome.error instanceof HttpError &&
    outcome.error.code === 'REDIRECT_NOT_SUPPORTED' &&
    outcome.error.status === null;
  check(
    problems,
    refused,
    `${label}: call was ${describe(outcome)}, expected REDIRECT_NOT_SUPPORTED with a null status`,
  );
  if (outcome.kind === 'rejected' && outcome.error instanceof HttpError) {
    check(
      problems,
      !outcome.error.message.includes(locationToken) && !outcome.error.message.includes(String(targetPort)),
      `${label}: the message carries the Location value: ${outcome.error.message}`,
    );
  }
}

try {
  for (const status of redirectStatuses) {
    expectRedirectRefusal(
      `GET answered ${status}`,
      await observe(() => client.fetchIt({ query: { mode: String(status) } })),
    );
  }
  for (const status of [307, 308]) {
    expectRedirectRefusal(
      `POST with a JSON body answered ${status}`,
      await observe(() => client.sendIt({ query: { mode: String(status) }, body: { note: postedNote } })),
    );
  }
  await new Promise((resolve) => setTimeout(resolve, 200));
  check(
    problems,
    targetSeen.length === 0,
    `the Location target received ${targetSeen.length} requests: ${JSON.stringify(targetSeen)}`,
  );
  check(
    problems,
    !targetSeen.some((seen) => seen.body.includes(postedNote)),
    'the POST body was delivered to the Location target',
  );

  const notModified = await observe(() => client.fetchIt({ query: { mode: '304' } }));
  check(
    problems,
    notModified.kind === 'resolved' && notModified.status === 304,
    `GET answered 304: call was ${describe(notModified)}, expected resolved 304`,
  );
  check(
    problems,
    targetSeen.length === 0,
    `after the 304 the Location target had received ${targetSeen.length} requests`,
  );
} finally {
  for (const server of [answerer, target]) {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}
conclude(statement, problems);
