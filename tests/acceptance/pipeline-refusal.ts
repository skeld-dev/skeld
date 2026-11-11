import net from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { defineContract } from '@darkstart/core/contract';
import { HttpError } from '@darkstart/core/http-error';
import * as t from '@darkstart/core/schema';
import { createServer } from '@darkstart/core/server';
import { check, conclude } from './support.ts';
import { startServerChild } from './support-typesystem.ts';

const statement =
  'a POST declared over its limit and a GET in one write answers only the POST with connection: close and the GET never runs, behind a 50 ms hook that passes (413), throws a 401 or sends a 401; an in-limit POST and GET behind the hook are both answered on a kept connection; a chunked over-limit body leaves the GET unrun with a synchronous hook and after the 413 with the 50 ms hook';
const bodyLimit = 1024;
const overLimit = 4000;
const hookDelayMs = 50;
const readMs = 1500;
const keptOpenMs = 800;

const acknowledgement = t.object({ ok: t.boolean() });
const uploadBody = t.object({ title: t.string({ maxLength: 4096 }) });

function upload(path: string) {
  return { method: 'POST', path, body: uploadBody, responses: { 200: acknowledgement } } as const;
}

const contract = defineContract({
  upload: upload('/upload'),
  uploadThrow: upload('/upload-throw'),
  uploadSend: upload('/upload-send'),
  uploadSync: upload('/upload-sync'),
  later: { method: 'GET', path: '/later', responses: { 200: acknowledgement } },
  count: {
    method: 'GET',
    path: '/count',
    responses: { 200: t.object({ calls: t.integer({ minimum: 0 }) }) },
  },
});

async function serve(): Promise<void> {
  let calls = 0;
  const server = createServer();
  server.addHook('onRequest', (context) => {
    const name = context.route.name;
    if (name === 'later' || name === 'count' || name === 'uploadSync') {
      return;
    }
    return (async () => {
      await delay(hookDelayMs);
      if (name === 'uploadThrow') {
        throw new HttpError(401, 'UNAUTHORIZED', 'no');
      }
      if (name === 'uploadSend') {
        context.send({ status: 401, payload: '{"status":401}' });
      }
    })();
  });
  const accept = () => ({ status: 200, body: { ok: true } }) as const;
  server.routes(
    contract,
    {
      upload: accept,
      uploadThrow: accept,
      uploadSend: accept,
      uploadSync: accept,
      later: () => {
        calls++;
        return accept();
      },
      count: () => ({ status: 200, body: { calls } }),
    },
    { bodyLimits: { upload: bodyLimit, uploadThrow: bodyLimit, uploadSend: bodyLimit, uploadSync: bodyLimit } },
  );
  const { port } = await server.listen({ port: 0, host: '127.0.0.1' });
  process.stdout.write(`listening ${port}\n`);
}

interface Seen {
  readonly statuses: readonly number[];
  readonly raw: string;
  readonly closedByServer: boolean;
}

function readStatuses(raw: string): number[] {
  return [...raw.matchAll(/HTTP\/1\.1 (\d{3}) /g)].map((match) => Number(match[1]));
}

function converse(port: number, writes: readonly string[], gaps: readonly number[], waitMs: number): Promise<Seen> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let closed = false;
    const socket = net.connect(port, '127.0.0.1');
    const finish = () => {
      clearTimeout(timer);
      socket.destroy();
      const raw = Buffer.concat(chunks).toString('latin1');
      resolve({ statuses: readStatuses(raw), raw, closedByServer: closed });
    };
    const timer = setTimeout(finish, waitMs);
    socket.on('data', (data) => chunks.push(Buffer.from(data)));
    socket.on('close', () => {
      closed = true;
      finish();
    });
    socket.on('error', () => undefined);
    socket.on('connect', () => {
      let elapsed = 0;
      writes.forEach((piece, position) => {
        elapsed += gaps[position] ?? 0;
        setTimeout(() => socket.write(piece, 'latin1'), elapsed);
      });
    });
  });
}

const laterRequest = 'GET /later HTTP/1.1\r\nhost: x\r\n\r\n';

function declaredPost(path: string, size: number): string {
  const head = '{"title":"';
  const body = `${head}${'a'.repeat(size - head.length - 2)}"}`;
  return `POST ${path} HTTP/1.1\r\nhost: x\r\ncontent-type: application/json\r\ncontent-length: ${body.length}\r\n\r\n${body}`;
}

function chunkedPost(path: string): string {
  const piece = `{"title":"${'a'.repeat(overLimit)}`;
  const closing = '"}';
  const frame = (text: string) => `${text.length.toString(16)}\r\n${text}\r\n`;
  return `POST ${path} HTTP/1.1\r\nhost: x\r\ncontent-type: application/json\r\ntransfer-encoding: chunked\r\n\r\n${frame(piece)}${frame(closing)}0\r\n\r\n`;
}

async function readCount(port: number): Promise<number> {
  const response = await fetch(`http://127.0.0.1:${port}/count`, { headers: { connection: 'close' } });
  const body: unknown = await response.json();
  return typeof body === 'object' && body !== null && 'calls' in body && typeof body.calls === 'number'
    ? body.calls
    : -1;
}

function closes(raw: string): boolean {
  return /\r\nconnection: close\r\n/i.test(raw);
}

async function prove(): Promise<void> {
  const problems: string[] = [];
  const log: string[] = [];
  const child = await startServerChild(fileURLToPath(import.meta.url));
  const { port } = child;
  try {
    const declared = async (label: string, path: string, status: number): Promise<void> => {
      const before = await readCount(port);
      const seen = await converse(port, [declaredPost(path, overLimit) + laterRequest], [0], readMs);
      const after = await readCount(port);
      log.push(
        `${label}: statuses ${seen.statuses.join(',')} connection-close ${closes(seen.raw)} closed ${seen.closedByServer} later-calls ${after - before}`,
      );
      check(
        problems,
        seen.statuses.length === 1 && seen.statuses[0] === status,
        `${label}: answered ${seen.statuses.join(',')}, not only ${status}`,
      );
      check(problems, closes(seen.raw), `${label}: the answer does not carry connection: close`);
      check(problems, after - before === 0, `${label}: the later handler ran ${after - before} times`);
    };
    await declared('declared over-limit, hook passes', '/upload', 413);
    await declared('declared over-limit, hook throws 401', '/upload-throw', 401);
    await declared('declared over-limit, hook sends 401', '/upload-send', 401);

    const beforeKept = await readCount(port);
    const kept = await converse(port, [declaredPost('/upload', 200) + laterRequest], [0], keptOpenMs);
    const afterKept = await readCount(port);
    log.push(
      `in-limit POST and GET: statuses ${kept.statuses.join(',')} connection-close ${closes(kept.raw)} closed ${kept.closedByServer} later-calls ${afterKept - beforeKept}`,
    );
    check(
      problems,
      kept.statuses.length === 2 && kept.statuses.every((status) => status === 200),
      `in-limit pair answered ${kept.statuses.join(',')}, not 200,200`,
    );
    check(problems, !closes(kept.raw) && !kept.closedByServer, 'in-limit pair: the connection was not kept open');
    check(
      problems,
      afterKept - beforeKept === 1,
      `in-limit pair: the later handler ran ${afterKept - beforeKept} times, not 1`,
    );

    const beforeSync = await readCount(port);
    const sync = await converse(port, [chunkedPost('/upload-sync') + laterRequest], [0], readMs);
    const afterSync = await readCount(port);
    log.push(
      `chunked over-limit, synchronous hook, GET in the same write: statuses ${sync.statuses.join(',')} connection-close ${closes(sync.raw)} later-calls ${afterSync - beforeSync}`,
    );
    check(problems, sync.statuses[0] === 413, `chunked synchronous: first answer ${sync.statuses[0]}, not 413`);
    check(
      problems,
      afterSync - beforeSync === 0,
      `chunked synchronous: the later handler ran ${afterSync - beforeSync} times`,
    );

    const beforeSlow = await readCount(port);
    const slow = await converse(port, [chunkedPost('/upload'), laterRequest], [0, 400], readMs);
    const afterSlow = await readCount(port);
    log.push(
      `chunked over-limit, 50 ms hook, GET written after the 413: statuses ${slow.statuses.join(',')} connection-close ${closes(slow.raw)} closed ${slow.closedByServer} later-calls ${afterSlow - beforeSlow}`,
    );
    check(
      problems,
      slow.statuses.length === 1 && slow.statuses[0] === 413,
      `chunked 50 ms: answered ${slow.statuses.join(',')}, not only 413`,
    );
    check(problems, closes(slow.raw), 'chunked 50 ms: the 413 does not carry connection: close');
    check(
      problems,
      afterSlow - beforeSlow === 0,
      `chunked 50 ms: a GET after the 413 ran the later handler ${afterSlow - beforeSlow} times`,
    );

    const beforeSame = await readCount(port);
    const same = await converse(port, [chunkedPost('/upload') + laterRequest], [0], readMs);
    const afterSame = await readCount(port);
    log.push(
      `recorded, not judged (R-34): chunked over-limit, 50 ms hook, GET in the same write: statuses ${same.statuses.join(',')} connection-close ${closes(same.raw)} later-calls ${afterSame - beforeSame}`,
    );
  } finally {
    await child.stop();
  }
  process.stdout.write(`${log.join('\n')}\n`);
  conclude(statement, problems);
}

if (process.argv[2] === 'serve') {
  await serve();
} else {
  await prove();
}
