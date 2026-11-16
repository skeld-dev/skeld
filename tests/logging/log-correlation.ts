// Does:  Proves inbound trace and request ids are written only when valid and only with correlation on.
// Holds: Each fixture is searched whole and cut in every stdout line and all stderr text, with the option on and off.

import { randomBytes } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { defineContract } from '@skeld/core/contract';
import * as t from '@skeld/core/schema';
import { createServer } from '@skeld/core/server';
import { announceListening, type LogChild, type LogObject, startLogChild } from '../support/support-log.ts';
import { check, createReport, findMarker, type Searched } from '../support/support-proof.ts';
import { request as wireRequest } from '../support/support-wire.ts';

const ok = t.object({ ok: t.boolean() });
const contract = defineContract({
  hello: { method: 'GET', path: '/hi', responses: { 200: ok } },
  boom: { method: 'GET', path: '/boom', responses: { 200: ok } },
});

function serve(): void {
  const server = createServer({
    log: { access: true, thresholds: { security: 'info' }, correlation: process.env.CORRELATION === 'on' },
  });
  server.routes(contract, {
    hello: ({ log }) => {
      log.info('hello');
      return { status: 200, body: { ok: true } };
    },
    boom: () => {
      throw new Error('boom');
    },
  });
  server
    .listen({ port: 0, host: '127.0.0.1' })
    .then(({ port }) => announceListening(port))
    .catch((error: unknown) => {
      process.stderr.write(`serve failed: ${String(error)}\n`);
      process.exitCode = 1;
    });
}

interface Fixture {
  name: string;
  headers: string[];
  accepted: { traceId?: string; flags?: string; id?: string };
  // Why: Every random value the fixture plants, searched whole and as any cut of its digits.
  planted: { whole: string; digits: string }[];
}

function hex(bytes: number): string {
  return randomBytes(bytes).toString('hex');
}

function needle(whole: string, digits: string): { whole: string; digits: string } {
  return { whole, digits };
}

function fixtures(): Fixture[] {
  const list: Fixture[] = [];
  const traceparent = (version: string, trace: string, span: string, flags: string): string =>
    `${version}-${trace}-${span}-${flags}`;
  const idMark = (tag: string): string => `MARK_${tag}_${hex(12)}`;
  const digitsOf = (value: string): string => /_([0-9a-f]{24})/.exec(value)?.[1] ?? '';

  const validOne = { trace: hex(16), span: hex(8), id: idMark('OKID1') };
  list.push({
    name: 'valid traceparent (flags 01) and valid id',
    headers: [`traceparent: ${traceparent('00', validOne.trace, validOne.span, '01')}`, `x-request-id: ${validOne.id}`],
    accepted: { traceId: validOne.trace, flags: '01', id: validOne.id },
    planted: [
      needle(validOne.trace, validOne.trace),
      needle(validOne.span, validOne.span),
      needle(validOne.id, digitsOf(validOne.id)),
    ],
  });
  const upper = { trace: hex(16), span: hex(8) };
  list.push({
    name: 'invalid traceparent: uppercase hex',
    headers: [`traceparent: ${traceparent('00', upper.trace.toUpperCase(), upper.span.toUpperCase(), '01')}`],
    accepted: {},
    planted: [needle(upper.trace, upper.trace), needle(upper.span, upper.span)],
  });
  const control = idMark('IDCTL');
  list.push({
    name: 'invalid id: a control character (tab) inside',
    headers: [`x-request-id: ${control}\tmore`],
    accepted: {},
    planted: [needle(control, digitsOf(control))],
  });
  const twice = { trace: hex(16), span: hex(8), first: idMark('DUPA'), second: idMark('DUPB') };
  list.push({
    name: 'a header sent more than once is ignored (traceparent twice, id twice)',
    headers: [
      `traceparent: ${traceparent('00', twice.trace, twice.span, '01')}`,
      `traceparent: ${traceparent('00', twice.trace, twice.span, '01')}`,
      `x-request-id: ${twice.first}`,
      `x-request-id: ${twice.second}`,
    ],
    accepted: {},
    planted: [
      needle(twice.trace, twice.trace),
      needle(twice.span, twice.span),
      needle(twice.first, digitsOf(twice.first)),
      needle(twice.second, digitsOf(twice.second)),
    ],
  });
  return list;
}

function windows(digits: string, size: number): string[] {
  const found: string[] = [];
  for (let at = 0; at + size <= digits.length; at++) {
    found.push(digits.slice(at, at + size));
  }
  return found;
}

function lowered(texts: readonly Searched[]): Searched[] {
  return texts.map(({ where, text }) => ({ where, text: text.toLowerCase() }));
}

type Planted = Fixture['planted'][number];

function appearances(texts: readonly Searched[], needles: readonly Planted[]): string[] {
  const searched = lowered(texts);
  return needles.flatMap(({ whole, digits }) =>
    findMarker(
      { whole: whole.toLowerCase(), windows: windows(digits.toLowerCase(), Math.min(10, digits.length)) },
      searched,
    ),
  );
}

const paths = ['/hi', '/nope', '/boom'] as const;
const expectedEvents: Record<(typeof paths)[number], string[]> = {
  '/hi': ['skeld.app.message', 'skeld.request.closed'],
  '/nope': ['skeld.refuse.not_found', 'skeld.request.closed'],
  '/boom': ['skeld.request.error', 'skeld.request.closed'],
};

interface Exchanged {
  fixture: Fixture;
  path: (typeof paths)[number];
  status: number;
  localId: string | null;
}

async function runMode(
  mode: 'on' | 'off',
  list: readonly Fixture[],
): Promise<{
  child: LogChild;
  exchanged: Exchanged[];
  searched: Searched[];
  waited: boolean;
}> {
  const child = await startLogChild(fileURLToPath(import.meta.url), { env: { CORRELATION: mode } });
  const exchanged = await Promise.all(
    list.flatMap((fixture) =>
      paths.map(async (path): Promise<Exchanged> => {
        const wire = await wireRequest(child.port, 'GET', path, fixture.headers);
        return { fixture, path, status: wire.status, localId: wire.first('x-request-id') };
      }),
    ),
  );
  const wanted = exchanged.length * 2;
  const ids = new Set(exchanged.flatMap((entry) => (entry.localId === null ? [] : [entry.localId])));
  const deadline = Date.now() + 10_000;
  let waited = false;
  while (Date.now() < deadline && !waited) {
    waited = child.records().filter((record) => ids.has(String(record['skeld.request_id']))).length >= wanted;
    if (!waited) {
      // biome-ignore lint/performance/noAwaitInLoops: a poll waits for the records of the last requests
      await delay(20);
    }
  }
  await child.stop();
  const searched: Searched[] = [
    ...child.lines().map((line, index) => ({ where: `stdout line ${index + 1}`, text: line.text })),
    { where: 'stdout bytes', text: child.stdoutBytes().toString('latin1') },
    { where: 'stderr', text: child.stderr() },
  ];
  return { child, exchanged, searched, waited };
}

const correlationKeys = ['trace_id', 'trace_flags', 'http.request.header.x-request-id'] as const;

function recordsOf(child: LogChild, localId: string): LogObject[] {
  return child.records().filter((record) => record['skeld.request_id'] === localId);
}

function checkRequest(child: LogChild, entry: Exchanged, mode: 'on' | 'off', inbound: Fixture['accepted']): string[] {
  const problems: string[] = [];
  const where = `${entry.path}`;
  if (entry.localId === null) {
    return [`${where}: the response carried no x-request-id`];
  }
  const records = recordsOf(child, entry.localId);
  check(
    problems,
    entry.status === (entry.path === '/hi' ? 200 : entry.path === '/nope' ? 404 : 500),
    `${where}: status ${entry.status}`,
  );
  const events = records.map((record) => String(record.event_name)).sort();
  check(
    problems,
    JSON.stringify(events) === JSON.stringify([...expectedEvents[entry.path]].sort()),
    `${where}: records ${events.join(',')}`,
  );
  const inboundIds = entry.fixture.headers
    .filter((header) => header.startsWith('x-request-id:'))
    .map((header) => header.slice(13).trim());
  check(problems, !inboundIds.includes(entry.localId), `${where}: the response id is the inbound header's value`);
  for (const record of records) {
    const label = `${where} ${String(record.event_name)}`;
    const expectation = mode === 'on' ? inbound : {};
    check(
      problems,
      record.trace_id === expectation.traceId,
      `${label}: trace_id is ${JSON.stringify(record.trace_id)}, expected ${JSON.stringify(expectation.traceId)}`,
    );
    check(
      problems,
      record.trace_flags === expectation.flags,
      `${label}: trace_flags is ${JSON.stringify(record.trace_flags)}, expected ${JSON.stringify(expectation.flags)}`,
    );
    const header = record['http.request.header.x-request-id'];
    const wanted = expectation.id === undefined ? undefined : [expectation.id];
    check(
      problems,
      JSON.stringify(header) === JSON.stringify(wanted),
      `${label}: http.request.header.x-request-id is ${JSON.stringify(header)}, expected ${JSON.stringify(wanted)}`,
    );
    check(problems, record['skeld.request_id'] !== expectation.id, `${label}: the local id equals the inbound id`);
  }
  return problems;
}

function absentKeys(child: LogChild): string[] {
  const holding = child.records().filter((record) => correlationKeys.some((key) => key in record));
  return holding.length === 0 ? [] : [`${holding.length} records hold a correlation key`];
}

function rejected(fixture: Fixture): Planted[] {
  return fixture.planted.filter(
    (planted) => planted.whole !== fixture.accepted.traceId && planted.whole !== fixture.accepted.id,
  );
}

function exchangesOf(run: { exchanged: Exchanged[] }, fixture: Fixture): Exchanged[] {
  const found = run.exchanged.filter((candidate) => candidate.fixture === fixture);
  if (found.length !== paths.length) {
    throw new Error(`fixture ${fixture.name} has ${found.length} exchanges, not ${paths.length}`);
  }
  return found;
}

async function main(): Promise<void> {
  const report = createReport();
  const list = fixtures();
  const accepted = list.filter((fixture) => fixture.name.startsWith('valid traceparent ('));
  const refused = list.filter((fixture) => !accepted.includes(fixture));
  const [on, off] = await Promise.all([runMode('on', list), runMode('off', list)]);
  for (const [mode, run] of [
    ['on', on],
    ['off', off],
  ] as const) {
    report.result(
      `AC-6 [${mode}] every request was answered and its records arrived`,
      run.waited ? [] : ['the records of the last requests never arrived'],
      `${run.exchanged.length} requests (${list.length} fixtures by ${paths.length} routes), ${run.child.records().length} records read`,
    );
  }
  const onProblems: string[] = [];
  for (const fixture of accepted) {
    for (const entry of exchangesOf(on, fixture)) {
      onProblems.push(
        ...checkRequest(on.child, entry, 'on', fixture.accepted).map((problem) => `${fixture.name}: ${problem}`),
      );
    }
    onProblems.push(...appearances(on.searched, rejected(fixture)).map((found) => `${fixture.name}: ${found}`));
  }
  report.result(
    'AC-6 [on] a valid traceparent and a valid inbound id appear in trace_id, trace_flags and http.request.header.x-request-id',
    onProblems,
    `${accepted.length} valid fixtures by 3 request kinds (handler record, refusal, error, each with its access record): fields equal the inbound values, the local id differs, the parent span id appears nowhere`,
  );
  for (const fixture of refused) {
    const problems: string[] = [];
    for (const entry of exchangesOf(on, fixture)) {
      problems.push(...checkRequest(on.child, entry, 'on', fixture.accepted));
    }
    problems.push(...appearances(on.searched, rejected(fixture)));
    const kept = Object.keys(fixture.accepted).length > 0 ? ' while the valid one is on all of them' : '';
    report.result(
      `AC-6 [on] ${fixture.name}`,
      problems,
      `${rejected(fixture).length} planted value(s) searched whole and cut in ${on.searched.length} texts, 0 found; the rejected field is on none of the 6 records${kept}`,
    );
  }
  const offProblems: string[] = [...absentKeys(off.child)];
  for (const fixture of list) {
    for (const entry of exchangesOf(off, fixture)) {
      offProblems.push(...checkRequest(off.child, entry, 'off', {}).map((problem) => `${fixture.name}: ${problem}`));
    }
    offProblems.push(...appearances(off.searched, fixture.planted).map((found) => `${fixture.name}: ${found}`));
  }
  report.result(
    'AC-6 [off] with the option off no inbound trace or request id appears, valid or not',
    offProblems,
    `${list.length} fixtures (${accepted.length} valid, ${refused.length} not) by 3 request kinds: no record holds trace_id, trace_flags or the id key; no fixture value appears in ${off.searched.length} texts, whole or cut`,
  );
  report.finish();
}

if (process.argv[2] === 'serve') {
  serve();
} else {
  await main();
}
