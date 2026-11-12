// Does:  Proves close() flushes to a reading reader and, against a silent one, resolves in time with exact loss counts.
// Holds: Stats are sampled inside the served process in one tick, so every sample is one consistent view of a server.

// biome-ignore-all lint/security/noSecrets: route templates and event names, not credentials
// biome-ignore-all lint/performance/noAwaitInLoops: samples and polls are taken one after another
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { defineContract } from '@skeld/core/contract';
import * as t from '@skeld/core/schema';
import { createServer, type Server } from '@skeld/core/server';
import { announceListening, type LogChild, type LogObject, startLogChild } from './support-log.ts';
import { check, createReport } from './support-proof.ts';

const deadlineMs = 1000;
const refusals = 30;
const perWindow = 20;
const readingRecords = 300;
const silentRecords = 400;
const pairBRecords = 50;
const padding = 'p'.repeat(900);
const reportShape = t.object({ report: t.string({ maxLength: 8000 }) });
const contract = defineContract({
  items: { method: 'POST', path: '/items', responses: { 200: t.object({ ok: t.boolean() }) } },
  go: { method: 'GET', path: '/go', responses: { 200: reportShape } },
  stats: { method: 'GET', path: '/stats', responses: { 200: reportShape } },
});

interface Sample {
  created: number;
  written: number;
  queued: number;
  inFlight: number;
  suppressed: number;
  dropped: Record<string, number>;
}

function sampleOf(server: Server): Sample {
  const stats = server.logStats();
  return {
    created: stats.created,
    written: stats.written,
    queued: stats.queued,
    inFlight: stats.inFlight,
    suppressed: stats.suppressed,
    dropped: { ...stats.dropped },
  };
}

function droppedTotal(sample: Sample): number {
  return Object.values(sample.dropped).reduce<number>((total, count) => total + count, 0);
}

function sumProblem(name: string, sample: Sample): string | null {
  const accounted = sample.written + sample.queued + sample.inFlight + droppedTotal(sample);
  return sample.created === accounted ? null : `${name}: created ${sample.created} is not ${accounted}`;
}

function dumpStats(label: string, servers: Record<string, Server>): void {
  const dump = Object.fromEntries(Object.entries(servers).map(([name, server]) => [name, sampleOf(server)]));
  process.stderr.write(`${label} ${JSON.stringify(dump)}\n`);
}

function listenAnnounce(server: Server, onListening: () => void): void {
  server
    .listen({ port: 0, host: '127.0.0.1' })
    .then(({ port }) => {
      onListening();
      announceListening(port);
    })
    .catch((error: unknown) => {
      process.stderr.write(`serve failed: ${String(error)}\n`);
      process.exitCode = 1;
    });
}

function handlersFor(server: Server, go: () => unknown) {
  return {
    items: () => ({ status: 200 as const, body: { ok: true } }),
    go: () => {
      const report = JSON.stringify(go());
      return { status: 200 as const, body: { report } };
    },
    stats: () => ({ status: 200 as const, body: { report: JSON.stringify({ a: sampleOf(server) }) } }),
  };
}

function serveSingle(variant: 'reading' | 'silent'): void {
  const server = createServer();
  const finish = async (): Promise<void> => {
    const before = sampleOf(server);
    const started = performance.now();
    await server.close();
    const closeMs = performance.now() - started;
    process.stderr.write(`CLOSE ${JSON.stringify({ closeMs, before, after: sampleOf(server) })}\n`);
    if (variant === 'reading') {
      process.exit(0);
    }
  };
  server.routes(
    contract,
    handlersFor(server, () => {
      const count = variant === 'reading' ? readingRecords : silentRecords;
      for (let seq = 1; seq <= count; seq++) {
        server.log.info(`rec ${seq} ${variant === 'silent' ? padding : ''}`, { seq });
      }
      setImmediate(() => void finish());
      return { sent: count };
    }),
  );
  listenAnnounce(server, () => {
    process.on('SIGTERM', () => process.exit(0));
    process.on('exit', () => dumpStats('FINAL', { a: server }));
  });
}

function servePair(): void {
  const first = createServer();
  const second = createServer();
  second.routes(contract, {
    items: () => ({ status: 200, body: { ok: true } }),
    go: async () => {
      for (let seq = 1; seq <= silentRecords; seq++) {
        first.log.info(`a ${seq} ${padding}`, { seq });
      }
      await delay(100);
      for (let seq = 1; seq <= pairBRecords; seq++) {
        second.log.info(`b ${seq}`, { seq });
      }
      await delay(100);
      const before = { a: sampleOf(first), b: sampleOf(second) };
      const started = performance.now();
      await first.close();
      const closeMs = performance.now() - started;
      const after = { a: sampleOf(first), b: sampleOf(second) };
      return { status: 200, body: { report: JSON.stringify({ before, after, closeMs }) } };
    },
    stats: () => ({
      status: 200,
      body: { report: JSON.stringify({ a: sampleOf(first), b: sampleOf(second) }) },
    }),
  });
  first.routes(
    contract,
    handlersFor(first, () => ({})),
  );
  first
    .listen({ port: 0, host: '127.0.0.1' })
    .then(() => {
      listenAnnounce(second, () => {
        process.on('SIGTERM', () => process.exit(0));
        process.on('exit', () => dumpStats('FINAL', { a: first, b: second }));
      });
    })
    .catch((error: unknown) => {
      process.stderr.write(`serve failed: ${String(error)}\n`);
      process.exitCode = 1;
    });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function jsonLine(child: LogChild, label: string): Record<string, unknown> | null {
  const line = child
    .stderr()
    .split('\n')
    .find((text) => text.startsWith(`${label} `));
  const parsed = line === undefined ? null : parseJson(line.slice(label.length + 1));
  return isRecord(parsed) ? parsed : null;
}

const emptySample: Sample = { created: -1, written: -1, queued: -1, inFlight: -1, suppressed: -1, dropped: {} };

function asSample(value: unknown): Sample {
  if (!isRecord(value) || !isRecord(value.dropped)) {
    return emptySample;
  }
  return {
    created: Number(value.created),
    written: Number(value.written),
    queued: Number(value.queued),
    inFlight: Number(value.inFlight),
    suppressed: Number(value.suppressed),
    dropped: Object.fromEntries(Object.entries(value.dropped).map(([key, count]) => [key, Number(count)])),
  };
}

function shutdownOf(sample: Sample): number {
  return sample.dropped.shutdown ?? 0;
}

async function untilLines(child: LogChild, wanted: number, ms: number): Promise<boolean> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (child.lines().length >= wanted) {
      return true;
    }
    await delay(25);
  }
  return child.lines().length >= wanted;
}

async function untilStderr(child: LogChild, label: string, ms: number): Promise<boolean> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (child.stderr().includes(`\n${label} `)) {
      return true;
    }
    await delay(10);
  }
  return child.stderr().includes(`\n${label} `);
}

async function refuse(port: number, count: number): Promise<number> {
  let refused = 0;
  for (let attempt = 0; attempt < count; attempt++) {
    const response = await fetch(`http://127.0.0.1:${port}/items`, {
      method: 'POST',
      headers: { origin: 'http://evil.example' },
    });
    await response.text();
    refused += response.status === 403 ? 1 : 0;
  }
  return refused;
}

function seqsOf(records: LogObject[], prefix: string): number[] {
  return records
    .filter((rec) => rec.event_name === 'skeld.app.message' && String(rec.message).startsWith(prefix))
    .map((rec) => (isRecord(rec.fields) ? Number(rec.fields.seq) : Number.NaN))
    .sort((left, right) => left - right);
}

function leadingRun(seqs: readonly number[]): boolean {
  return seqs.every((seq, index) => seq === index + 1);
}

async function readingCase(report: ReturnType<typeof createReport>): Promise<void> {
  const problems: string[] = [];
  const child = await startLogChild(fileURLToPath(import.meta.url), {
    args: ['reading'],
    reader: { mode: 'read' },
  });
  let exitCode: number | null = null;
  try {
    check(problems, (await refuse(child.port, refusals)) === refusals, 'a refusal was not answered 403');
    const response = await fetch(`http://127.0.0.1:${child.port}/go`);
    await response.text();
    check(problems, response.status === 200, `/go answered ${response.status}`);
    exitCode = (await child.exited).code;
  } finally {
    await child.stop();
  }
  const close = jsonLine(child, 'CLOSE');
  const records = child.records();
  const seqs = seqsOf(records, 'rec ');
  const csrf = records.filter((rec) => rec.event_name === 'skeld.refuse.csrf');
  const summaries = records.filter(
    (rec) => rec.event_name === 'skeld.log.suppressed' && rec['skeld.suppressed.event_name'] === 'skeld.refuse.csrf',
  );
  const closed = records.filter((rec) => rec.event_name === 'skeld.server.closed');
  const queued = close === null ? -1 : asSample(close.before).queued;
  check(problems, exitCode === 0, `the child exited with ${String(exitCode)}`);
  check(problems, close !== null, 'the child never reported close() resolving');
  check(problems, queued > 0, `${queued} records were queued when close() was called`);
  check(
    problems,
    seqs.length === readingRecords && leadingRun(seqs),
    `${seqs.length} of ${readingRecords} author records reached the reader`,
  );
  check(problems, csrf.length === perWindow, `${csrf.length} refusal records, expected ${perWindow}`);
  check(problems, summaries.length === 1, `${summaries.length} summaries for the open window`);
  const counted = summaries[0]?.['skeld.suppressed.count'];
  check(
    problems,
    counted === refusals - perWindow,
    `the summary counts ${String(counted)}, expected ${refusals - perWindow}`,
  );
  check(problems, closed.length === 1, `${closed.length} closed records`);
  check(problems, child.unparsed().length === 0, `${child.unparsed().length} lines did not parse`);
  report.result(
    'AC-12 a reading reader holds every record and the open window summary when the child exits as close() resolves',
    problems,
    `${queued} records queued at the call; ${seqs.length} author records, ${csrf.length} refusals, 1 summary counting ${refusals - perWindow}, closed record present; child exit ${String(exitCode)} in the turn close() resolved`,
  );
}

interface Silent {
  closeMs: number;
  before: Sample;
  after: Sample;
  final: Sample;
  lines: number;
}

async function silentRun(): Promise<{ run: Silent | null; problems: string[] }> {
  const problems: string[] = [];
  const child = await startLogChild(fileURLToPath(import.meta.url), {
    args: ['silent'],
    reader: { mode: 'silent', ms: 6000 },
  });
  let run: Silent | null = null;
  try {
    const response = await fetch(`http://127.0.0.1:${child.port}/go`);
    await response.text();
    check(problems, response.status === 200, `/go answered ${response.status}`);
    check(problems, await untilStderr(child, 'CLOSE', 10_000), 'close() never resolved');
    const close = jsonLine(child, 'CLOSE');
    if (close !== null) {
      const after = asSample(close.after);
      const handedOver = after.created - shutdownOf(after);
      check(
        problems,
        await untilLines(child, handedOver, 20_000),
        `the reader received fewer than the ${handedOver} handed-over lines`,
      );
      const lines = child.lines().length;
      const stopping = child.stop();
      await child.exited;
      await stopping;
      run = {
        closeMs: Number(close.closeMs),
        before: asSample(close.before),
        after,
        final: asSample(jsonLine(child, 'FINAL')?.a),
        lines,
      };
    }
  } finally {
    await child.stop();
  }
  check(problems, child.unparsed().length === 0, `${child.unparsed().length} lines did not parse`);
  return { run, problems };
}

function silentProblems(run: Silent): string[] {
  const problems: string[] = [];
  const { after, final } = run;
  const limit = deadlineMs * 1.5;
  check(problems, run.closeMs <= limit, `close() took ${run.closeMs.toFixed(0)} ms, over ${limit} ms`);
  check(
    problems,
    run.closeMs >= deadlineMs * 0.9,
    `close() took ${run.closeMs.toFixed(0)} ms, so the deadline was not reached`,
  );
  check(problems, after.inFlight > 0, `${after.inFlight} records in flight after close()`);
  check(problems, shutdownOf(after) > 0, `${shutdownOf(after)} records dropped as shutdown`);
  check(problems, after.queued === 0, `${after.queued} records still queued after close()`);
  const others = droppedTotal(after) - shutdownOf(after);
  check(problems, others === 0, `${others} records dropped for another reason`);
  check(
    problems,
    final.inFlight === 0 && final.queued === 0,
    `after the reader resumed: ${final.inFlight} in flight, ${final.queued} queued`,
  );
  check(
    problems,
    final.written === after.written + after.inFlight,
    `the in-flight batch became ${final.written - after.written} written, expected ${after.inFlight}`,
  );
  check(problems, shutdownOf(final) === shutdownOf(after), 'a settled batch moved into shutdown');
  check(problems, run.lines === final.written, `the reader holds ${run.lines} lines, written is ${final.written}`);
  for (const [name, sample] of [
    ['before close()', run.before],
    ['after close()', after],
    ['after the reader resumed', final],
  ] as const) {
    const sum = sumProblem(name, sample);
    check(problems, sum === null, sum ?? '');
  }
  return problems;
}

async function silentCases(report: ReturnType<typeof createReport>, runs: number): Promise<void> {
  const times: number[] = [];
  for (let index = 1; index <= runs; index++) {
    const { run, problems } = await silentRun();
    if (run === null) {
      report.result(`AC-12 [run ${index}] a silent reader`, [...problems, 'the run produced no samples'], '');
      continue;
    }
    times.push(run.closeMs);
    const { after, final } = run;
    report.result(
      `AC-12 [run ${index}] a silent reader: close() resolves by Q-4's measure and loss is counted once`,
      [...problems, ...silentProblems(run)],
      `close() ${run.closeMs.toFixed(0)} ms (limit ${deadlineMs * 1.5}); in flight ${after.inFlight}, shutdown ${shutdownOf(after)}, queued ${after.queued}, sum rule held; after the reader resumed written ${final.written} = ${run.lines} lines`,
    );
  }
  const spread: string[] = [];
  check(spread, times.length === runs, `${times.length} of ${runs} runs gave a close time`);
  const worst = Math.max(...times);
  check(spread, worst <= deadlineMs * 1.5, `the slowest close() took ${worst.toFixed(0)} ms`);
  report.result(
    'AC-12 close() against a silent reader, measured in every run',
    spread,
    `${times.map((ms) => ms.toFixed(0)).join(', ')} ms in ${runs} runs, limit ${deadlineMs * 1.5} ms`,
  );
}

interface PairSample {
  at: string;
  a: Sample;
  b: Sample;
}

function asPair(value: unknown): { a: Sample; b: Sample } {
  return isRecord(value) ? { a: asSample(value.a), b: asSample(value.b) } : { a: emptySample, b: emptySample };
}

async function takePair(port: number, at: string): Promise<PairSample> {
  const response = await fetch(`http://127.0.0.1:${port}/stats`);
  const body: unknown = await response.json();
  const parsed = isRecord(body) ? parseJson(String(body.report)) : null;
  return { at, ...asPair(parsed) };
}

function pairProblems(
  go: Record<string, unknown>,
  samples: readonly PairSample[],
  dump: Record<string, unknown> | null,
  child: LogChild,
): { problems: string[]; detail: string } {
  const problems: string[] = [];
  const before = asPair(go.before);
  const after = asPair(go.after);
  const final = asPair(dump);
  const closeMs = Number(go.closeMs);
  const limit = deadlineMs * 1.5;
  check(problems, closeMs <= limit, `close() took ${closeMs.toFixed(0)} ms, over ${limit} ms`);
  check(
    problems,
    closeMs >= deadlineMs * 0.9,
    `close() took ${closeMs.toFixed(0)} ms, so the deadline was not reached`,
  );
  check(
    problems,
    before.a.inFlight > 0 && before.b.queued > 0,
    `before close(): A in flight ${before.a.inFlight}, B queued ${before.b.queued}`,
  );
  check(problems, after.a.inFlight > 0, `A has ${after.a.inFlight} records in flight after close()`);
  check(
    problems,
    after.a.inFlight === before.a.inFlight,
    `A in flight moved from ${before.a.inFlight} to ${after.a.inFlight}`,
  );
  check(
    problems,
    after.a.written === before.a.written,
    `A written moved from ${before.a.written} to ${after.a.written}`,
  );
  check(problems, shutdownOf(after.a) > 0, `A dropped ${shutdownOf(after.a)} as shutdown`);
  check(
    problems,
    after.b.written === before.b.written && after.b.inFlight === before.b.inFlight,
    `B written and in flight moved from ${before.b.written} and ${before.b.inFlight} to ${after.b.written} and ${after.b.inFlight}`,
  );
  const named: [string, Sample][] = [
    ['A before', before.a],
    ['B before', before.b],
    ['A after', after.a],
    ['B after', after.b],
    ['A final', final.a],
    ['B final', final.b],
    ...samples.flatMap((sample): [string, Sample][] => [
      [`A ${sample.at}`, sample.a],
      [`B ${sample.at}`, sample.b],
    ]),
  ];
  for (const [name, sample] of named) {
    const sum = sumProblem(name, sample);
    check(problems, sum === null, sum ?? '');
  }
  const records = child.records();
  const lines = child.lines().length;
  check(
    problems,
    child.unparsed().length === 0,
    `${child.unparsed().length} stdout lines did not parse as one JSON object`,
  );
  check(
    problems,
    final.a.inFlight === 0 && final.b.queued === 0,
    `after the reader resumed: A in flight ${final.a.inFlight}, B queued ${final.b.queued}`,
  );
  check(
    problems,
    final.a.written === after.a.written + after.a.inFlight,
    `A's in-flight batch became ${final.a.written - after.a.written} written, expected ${after.a.inFlight}`,
  );
  check(problems, shutdownOf(final.a) === shutdownOf(after.a), 'A settled batch moved into shutdown');
  check(
    problems,
    lines === final.a.written + final.b.written,
    `the reader holds ${lines} lines, A and B wrote ${final.a.written} + ${final.b.written}`,
  );
  const secondSeqs = seqsOf(records, 'b ');
  check(
    problems,
    secondSeqs.length === pairBRecords && leadingRun(secondSeqs),
    `${secondSeqs.length} of ${pairBRecords} records of the second server reached the reader`,
  );
  const firstSeqs = seqsOf(records, 'a ');
  check(problems, leadingRun(firstSeqs), 'the first server records that arrived are not a leading run');
  return {
    problems,
    detail: `close() ${closeMs.toFixed(0)} ms; A in flight ${before.a.inFlight} before and ${after.a.inFlight} after, written ${after.a.written} unchanged, shutdown ${shutdownOf(after.a)}; B written ${after.b.written} and in flight ${after.b.inFlight} unchanged; ${named.length} samples all held the sum; reader resumed: ${lines} lines = A ${final.a.written} + B ${final.b.written}, ${secondSeqs.length} of B's ${pairBRecords} records and ${firstSeqs.length} of A's reached it`,
  };
}

async function pairCase(report: ReturnType<typeof createReport>): Promise<void> {
  const problems: string[] = [];
  const child = await startLogChild(fileURLToPath(import.meta.url), {
    args: ['pair'],
    reader: { mode: 'silent', ms: 7000 },
  });
  const samples: PairSample[] = [];
  let go: Record<string, unknown> = {};
  try {
    samples.push(await takePair(child.port, 'before the scenario'));
    const response = await fetch(`http://127.0.0.1:${child.port}/go`);
    const body: unknown = await response.json();
    const parsed = isRecord(body) ? parseJson(String(body.report)) : null;
    go = isRecord(parsed) ? parsed : {};
    check(problems, response.status === 200, `/go answered ${response.status}`);
    const stop = Date.now() + 25_000;
    let latest = await takePair(child.port, 'after close()');
    samples.push(latest);
    while (Date.now() < stop && !(latest.a.inFlight === 0 && latest.b.queued === 0 && latest.b.inFlight === 0)) {
      await delay(25);
      latest = await takePair(child.port, 'polling');
      samples.push(latest);
    }
    await untilLines(child, latest.a.written + latest.b.written, 5000);
  } finally {
    await child.stop();
  }
  const judged = pairProblems(go, samples, jsonLine(child, 'FINAL'), child);
  report.result(
    'AC-16 two servers, a silent reader and a first close past its deadline',
    [...problems, ...judged.problems],
    judged.detail,
  );
}

async function main(): Promise<void> {
  const report = createReport('log-close');
  await readingCase(report);
  await silentCases(report, 3);
  await pairCase(report);
  report.finish();
}

const requested = (['reading', 'silent', 'pair'] as const).find((candidate) => candidate === process.argv[3]);
if (process.argv[2] === 'serve') {
  if (requested === 'pair') {
    servePair();
  } else if (requested !== undefined) {
    serveSingle(requested);
  } else {
    process.stderr.write(`unknown variant ${String(process.argv[3])}\n`);
    process.exitCode = 1;
  }
} else {
  await main();
}
