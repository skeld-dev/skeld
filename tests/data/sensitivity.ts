// Does:  Proves a parameter value or SQL text never reaches a response, a log record or a printed error, on SQLite.
// Holds: Each marker is searched whole and cut in every response, every output line and the error as printed.

// biome-ignore-all lint/security/noSecrets: planted markers and fixture names, not credentials
// biome-ignore-all lint/performance/noAwaitInLoops: each case is requested alone so its records stay its own
import { fileURLToPath } from 'node:url';
import { inspect } from 'node:util';
import { defineContract } from '@skeld/core/contract';
import * as t from '@skeld/core/schema';
import { createServer } from '@skeld/core/server';
import { DataError, exposeDetail } from '@skeld/data/data-error';
import { sql } from '@skeld/data/sql';
import { createSqliteDatabase } from '@skeld/data/sqlite';
import { announceListening, type LogObject, startLogChild } from '../support/support-log.ts';
import { check, createReport, findMarker, newMarker, type Searched } from '../support/support-proof.ts';

const contract = defineContract({
  constraint: {
    method: 'GET',
    path: '/constraint/:m',
    params: t.object({ m: t.string({ maxLength: 64 }) }),
    responses: { 200: t.object({ ok: t.boolean() }) },
  },
  syntax: {
    method: 'GET',
    path: '/syntax/:m',
    params: t.object({ m: t.string({ maxLength: 64 }) }),
    responses: { 200: t.object({ ok: t.boolean() }) },
  },
  printed: {
    method: 'GET',
    path: '/printed',
    responses: {
      200: t.object({ visible: t.string({ maxLength: 1_000_000 }), exposed: t.string({ maxLength: 1_000_000 }) }),
    },
  },
});

async function serve(): Promise<void> {
  const db = createSqliteDatabase({ path: ':memory:' });
  const server = createServer({ log: { errorText: true } });
  const visible: string[] = [];
  const exposed: string[] = [];
  server.register(db.plugin);
  server.register(async (scope) => {
    await db.for(scope).reserve(async (connection) => {
      await connection.script('create table u (v text unique, c integer check (c > 0))');
    });
  });
  server.addHook('onError', (_context, error) => {
    visible.push(
      [
        JSON.stringify(error),
        inspect(error, { depth: null }),
        String(error),
        String(error instanceof Error ? error.stack : ''),
      ].join('\n'),
    );
    exposed.push(error instanceof DataError ? JSON.stringify(exposeDetail(error)) : '');
  });
  server.routes(contract, {
    constraint: async (request) => {
      const owned = db.for(request);
      await owned.query(sql`insert into u (v, c) values (${request.params.m}, ${1})`);
      await owned.query(sql`insert into u (v, c) values (${request.params.m}, ${1})`);
      return { status: 200, body: { ok: true } };
    },
    syntax: async (request) => {
      const text = `select * from u where ${request.params.m} ${request.params.m}`;
      await db.for(request).query(sql(Object.assign([text], { raw: [text] })));
      return { status: 200, body: { ok: true } };
    },
    printed: () => ({ status: 200, body: { visible: visible.join('\n'), exposed: exposed.join('\n') } }),
  });
  const { port } = await server.listen({ port: 0, host: '127.0.0.1' });
  process.on('SIGTERM', () => {
    void server.close().then(() => process.exit(0));
  });
  announceListening(port);
}

interface Failure {
  name: string;
  path: string;
  tag: string;
  control: (exposed: string, marker: string) => string | null;
}

const failures: Failure[] = [
  {
    name: 'a constraint failure with a marker parameter',
    path: 'constraint',
    tag: 'CONSTRAINT',
    control: () => null,
  },
  {
    name: 'a syntax error at a marker token',
    path: 'syntax',
    tag: 'SYNTAX',
    control: (exposed, marker) =>
      exposed.includes(marker)
        ? null
        : 'the database text the case plants is not in exposeDetail, so the case proves nothing',
  },
];

async function main(): Promise<void> {
  const report = createReport();
  const child = await startLogChild(fileURLToPath(import.meta.url), { args: [] });
  const responses: Searched[] = [];
  const markers = failures.map((one) => newMarker(one.tag));
  const codes: { status: number; body: string; failedRecords: LogObject[] }[] = [];
  try {
    for (const [at, one] of failures.entries()) {
      const marker = markers[at];
      if (marker === undefined) {
        throw new Error('a marker was not made');
      }
      const answer = await fetch(`http://127.0.0.1:${child.port}/${one.path}/${marker.whole}`);
      const body = await answer.text();
      const head = [...answer.headers].map(([name, value]) => `${name}: ${value}`).join('\n');
      responses.push({ where: `the response of ${one.name}`, text: `${answer.status}\n${head}\n${body}` });
      await child.waitForRecord(
        (record) => record.event_name === 'data.statement.failed' && failedCount(child.records()) >= at + 1,
      );
      codes.push({ status: answer.status, body, failedRecords: failedOf(child.records()) });
    }
    const printed = await fetch(`http://127.0.0.1:${child.port}/printed`);
    const printedText = await printed.text();
    const fields: { visible?: unknown; exposed?: unknown } = JSON.parse(printedText);
    const visibleText = String(fields.visible);
    const exposedParts = String(fields.exposed).split('\n');
    const exit = await child.stop();
    const output: Searched[] = [
      ...child.lines().map((line, at) => ({ where: `stdout line ${at + 1}`, text: line.text })),
      { where: 'stderr', text: child.stderr() },
      { where: 'the error as printed (JSON, inspect, String, stack)', text: visibleText },
    ];
    for (const [at, one] of failures.entries()) {
      const marker = markers[at];
      const seen = codes[at];
      const detail = exposedParts[at] ?? '';
      if (marker === undefined || seen === undefined) {
        throw new Error('a case has no result');
      }
      const problems: string[] = [];
      const everywhere = [...responses, ...output];
      problems.push(...findMarker(marker, everywhere));
      check(problems, seen.status === 500, `the status was ${seen.status}, not the fixed 500`);
      check(problems, seen.body.includes('INTERNAL'), 'the body is not the fixed INTERNAL error');
      const mine = failedOf(child.records())[at];
      check(
        problems,
        failedOf(child.records()).length === failures.length &&
          mine?.fields !== undefined &&
          JSON.stringify(mine.fields).includes('QUERY_FAILED'),
        `the log does not hold exactly one data.statement.failed record per failure, carrying QUERY_FAILED (${failedOf(child.records()).length} found)`,
      );
      const control = one.control(detail, marker.whole);
      check(problems, control === null, control ?? '');
      check(problems, exit.code === 0, `the server child exited with ${String(exit.code)}`);
      report.result(
        one.name,
        problems,
        'marker absent from the response, every output line and the printed error; one QUERY_FAILED record',
      );
    }
  } finally {
    await child.stop().catch(() => undefined);
  }
  report.finish();
}

function failedOf(records: LogObject[]): LogObject[] {
  return records.filter((record) => record.event_name === 'data.statement.failed');
}

function failedCount(records: LogObject[]): number {
  return failedOf(records).length;
}

if (process.argv[2] === 'serve') {
  await serve();
} else {
  await main();
}
