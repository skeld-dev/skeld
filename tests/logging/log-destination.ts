// Does:  Proves a stalled or dead stdout reader and a failing sink never stop a request and never hold over 1 MiB.
// Holds: Each fixture also shows its failure happened (a stuck write, failed writes, failed or hung sink calls).

// biome-ignore-all lint/performance/noAwaitInLoops: the stats route is polled until the fixture's failure shows
import { type ChildProcess, spawn } from 'node:child_process';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { defineContract } from '@skeld/core/contract';
import type { LogSink, LogStats } from '@skeld/core/log';
import * as t from '@skeld/core/schema';
import { createServer } from '@skeld/core/server';
import { announceListening } from '../support/support-log.ts';
import { check, createReport } from '../support/support-proof.ts';

type SinkMode = 'none' | 'throws' | 'rejects' | 'hangs' | 'reenters' | 'healthy';

interface Observed {
  stats: LogStats;
  sinkCalls: number;
  nested: number;
  echoed: number;
}

interface Fixture {
  sink: SinkMode;
  reader: 'silent' | 'exited' | 'none';
  // Does:  Says whether a stats sample shows the fixture's failure (or, for the control, a drained queue).
  shows: (seen: Observed) => boolean;
  never: readonly ('write_failed' | 'sink_failed')[];
}

const queueBytes = 1_048_576;
// Why: 400 records of about 4.2 KB queue about 1.7 MB in one handler call, past the 1 MiB queue and a 64 KiB pipe.
const burstRecords = 400;
const ordinary = 200;
const settleMs = 5000;
const pad = 'x'.repeat(1000);
const marker = 'logged from inside the sink';

const fixtures: Record<string, Fixture> = {
  'reader-silent': {
    sink: 'none',
    reader: 'silent',
    shows: ({ stats }) => stats.inFlight > 0 && stats.pendingMs > 0,
    never: ['write_failed', 'sink_failed'],
  },
  'reader-exited': {
    sink: 'none',
    reader: 'exited',
    shows: ({ stats }) => stats.dropped.write_failed > 0,
    never: ['sink_failed'],
  },
  'sink-throws': {
    sink: 'throws',
    reader: 'none',
    shows: ({ stats, sinkCalls }) => sinkCalls > 0 && stats.dropped.sink_failed > 0,
    never: ['write_failed'],
  },
  'sink-rejects': {
    sink: 'rejects',
    reader: 'none',
    shows: ({ stats, sinkCalls }) => sinkCalls > 0 && stats.dropped.sink_failed > 0,
    never: ['write_failed'],
  },
  'sink-hangs': {
    sink: 'hangs',
    reader: 'none',
    shows: ({ stats, sinkCalls }) => sinkCalls === 1 && stats.inFlight > 0 && stats.pendingMs > 0,
    never: ['write_failed', 'sink_failed'],
  },
  'sink-reenters': {
    sink: 'reenters',
    reader: 'none',
    shows: ({ sinkCalls, echoed }) => sinkCalls > 1 && echoed > 0,
    never: ['write_failed', 'sink_failed'],
  },
  'control: healthy sink': {
    sink: 'healthy',
    reader: 'none',
    shows: ({ stats, sinkCalls }) => sinkCalls > 0 && stats.queued === 0 && stats.inFlight === 0,
    never: ['write_failed', 'sink_failed'],
  },
};

const report = t.object({ report: t.string({ maxLength: 4000 }) });
const contract = defineContract({
  hello: { method: 'GET', path: '/', responses: { 200: t.object({ hello: t.string({ maxLength: 8 }) }) } },
  burst: { method: 'GET', path: '/burst', responses: { 200: report } },
  stats: { method: 'GET', path: '/stats', responses: { 200: report } },
});

function serve(mode: SinkMode): void {
  let sinkCalls = 0;
  let nested = 0;
  let echoed = 0;
  let inside = false;
  const sinks: Record<Exclude<SinkMode, 'none'>, LogSink> = {
    throws: () => {
      sinkCalls++;
      throw new Error('the sink fixture throws');
    },
    rejects: () => {
      sinkCalls++;
      return Promise.reject(new Error('the sink fixture rejects'));
    },
    hangs: () => {
      sinkCalls++;
      return new Promise<void>(() => undefined);
    },
    reenters: (records) => {
      sinkCalls++;
      nested += inside ? 1 : 0;
      echoed += records.some((line) => line.includes(marker)) ? 1 : 0;
      inside = true;
      server.log.info(marker);
      inside = false;
    },
    healthy: async () => {
      sinkCalls++;
      await delay(1);
    },
  };
  const server = createServer({ log: mode === 'none' ? { access: true } : { access: true, sink: sinks[mode] } });
  server.routes(contract, {
    hello: () => ({ status: 200, body: { hello: 'world' } }),
    burst: () => {
      for (let index = 0; index < burstRecords; index++) {
        server.log.warn('burst', { a: pad, b: pad, c: pad, d: pad });
      }
      return { status: 200, body: { report: String(burstRecords) } };
    },
    stats: () => ({
      status: 200,
      body: { report: JSON.stringify({ stats: server.logStats(), sinkCalls, nested, echoed }) },
    }),
  });
  server
    .listen({ port: 0, host: '127.0.0.1' })
    .then(({ port }) => announceListening(port))
    .catch((error: unknown) => {
      process.stderr.write(`serve failed: ${String(error)}\n`);
      process.exitCode = 1;
    });
}

function portOf(child: ChildProcess): Promise<number> {
  return new Promise((resolve, reject) => {
    let text = '';
    child.stderr?.setEncoding('utf8');
    child.stderr?.on('data', (chunk: string) => {
      text += chunk;
      const match = /^listening (\d+)$/m.exec(text);
      if (match?.[1] !== undefined) {
        resolve(Number(match[1]));
      }
    });
    child.once('exit', () => reject(new Error(`the server child exited before listening: ${text}`)));
  });
}

async function get(port: number, path: string): Promise<{ status: number; body: string }> {
  const response = await fetch(`http://127.0.0.1:${port}${path}`);
  return { status: response.status, body: await response.text() };
}

async function sample(port: number): Promise<Observed> {
  const reply = await get(port, '/stats');
  const parsed: Observed = JSON.parse(JSON.parse(reply.body).report);
  return parsed;
}

// Does:  Samples the stats route until the fixture's failure shows or the settle time ends; returns every sample.
async function settle(port: number, fixture: Fixture): Promise<Observed[]> {
  let last = await sample(port);
  const samples = [last];
  const deadline = Date.now() + settleMs;
  while (!fixture.shows(last) && Date.now() < deadline) {
    await delay(50);
    last = await sample(port);
    samples.push(last);
  }
  return samples;
}

const droppedTotal = (stats: LogStats): number => Object.values(stats.dropped).reduce((sum, count) => sum + count, 0);

async function runFixture(fixture: Fixture): Promise<{ problems: string[]; detail: string }> {
  const self = fileURLToPath(import.meta.url);
  const child = spawn(process.execPath, ['--conditions=skeld-source', self, 'serve', fixture.sink], {
    stdio: ['ignore', fixture.reader === 'none' ? 'ignore' : 'pipe', 'pipe'],
  });
  // Why: Destroying the only read end makes every write fail with EPIPE; a silent reader is the end left unread.
  if (fixture.reader === 'exited') {
    child.stdout?.destroy();
  }
  const problems: string[] = [];
  let samples: Observed[] = [];
  try {
    const port = await portOf(child);
    const burst = await get(port, '/burst');
    check(problems, burst.status === 200, `the burst answered ${burst.status}`);
    const afterBurst = await sample(port);
    const answers = await Promise.all(Array.from({ length: ordinary }, () => get(port, '/')));
    const fine = answers.filter((answer) => answer.status === 200 && answer.body === '{"hello":"world"}').length;
    check(problems, fine === ordinary, `${fine} of ${ordinary} ordinary requests answered 200 with their body`);
    samples = [afterBurst, ...(await settle(port, fixture))];
  } finally {
    child.kill('SIGKILL');
    if (child.exitCode === null && child.signalCode === null) {
      await once(child, 'exit');
    }
  }
  const last = samples.at(-1);
  if (last === undefined) {
    return { problems: [...problems, 'no stats sample'], detail: '' };
  }
  const held = Math.max(...samples.map(({ stats }) => stats.queuedBytes + stats.inFlightBytes));
  const unsummed = samples.filter(
    ({ stats }) => stats.created !== stats.written + stats.queued + stats.inFlight + droppedTotal(stats),
  );
  check(
    problems,
    unsummed.length === 0,
    `${unsummed.length} samples break created = written + queued + in flight + dropped`,
  );
  check(problems, held <= queueBytes, `${held} bytes held, over ${queueBytes}`);
  check(problems, last.stats.dropped.queue_full > 0, 'the burst never filled the queue');
  check(problems, fixture.shows(last), `the failure never showed in ${settleMs} ms`);
  for (const reason of fixture.never) {
    check(problems, last.stats.dropped[reason] === 0, `${last.stats.dropped[reason]} records dropped as ${reason}`);
  }
  check(problems, last.nested === 0, `${last.nested} sink calls started inside another`);
  return {
    problems,
    detail:
      `${ordinary} ordinary requests answered; ${samples.length} samples, at most ${held} bytes held; ` +
      `dropped ${JSON.stringify(last.stats.dropped)}; in flight ${last.stats.inFlight}; sink calls ${last.sinkCalls}`,
  };
}

function pastMode(value: string | undefined): SinkMode {
  const modes: readonly SinkMode[] = ['none', 'throws', 'rejects', 'hangs', 'reenters', 'healthy'];
  const mode = modes.find((candidate) => candidate === value);
  if (mode === undefined) {
    throw new Error(`unknown sink mode ${String(value)}`);
  }
  return mode;
}

if (process.argv[2] === 'serve') {
  serve(pastMode(process.argv[3]));
} else {
  const results = await Promise.all(
    Object.entries(fixtures).map(async ([name, fixture]) => ({ name, ...(await runFixture(fixture)) })),
  );
  const proof = createReport();
  for (const { name, problems, detail } of results) {
    proof.result(name, problems, detail);
  }
  proof.finish();
}
