// Does:  Proves a silent or dead reader and a failing sink never stop a request and never grow the queue past 1 MiB.
// Holds: Each fixture is judged on three driver reports; the p99 ratios are printed and recorded, never judged.

// biome-ignore-all lint/performance/noAwaitInLoops: the driver runs one after another, never in parallel
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { check, createReport } from './support-proof.ts';

const fixtures = [
  'reader-silent',
  'reader-exited',
  'sink-throws',
  'sink-rejects',
  'sink-hangs',
  'sink-reenters',
] as const;
const repetitions = 3;
const queueBytes = 1_048_576;
const driveTimeoutMs = 180_000;
const driver = fileURLToPath(new URL('../../benchmarks/logging/drive.ts', import.meta.url));
const sourceRoot = fileURLToPath(new URL('../..', import.meta.url));

interface Drive {
  fixture: string;
  requests: number;
  answered: number;
  statuses: Record<string, number>;
  p99Healthy: number;
  p99Failing: number;
  ratio: number;
  samples: number;
  sumHeld: boolean;
  maxHeldBytes: number;
  last: { created: number; written: number; queued: number; inFlight: number; dropped: Record<string, number> };
  sinkCalls: number | null;
  peakRssBytes: number;
  droppedShare: number;
}

type Obj = Record<string, unknown>;

function isObject(value: unknown): value is Obj {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function num(object: Obj, key: string): number {
  const value = object[key];
  if (typeof value !== 'number') {
    throw new Error(`report field ${key} is not a number`);
  }
  return value;
}

function member(object: Obj, key: string): Obj {
  const value = object[key];
  if (!isObject(value)) {
    throw new Error(`report field ${key} is not an object`);
  }
  return value;
}

function numbers(object: Obj): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [key, value] of Object.entries(object)) {
    if (typeof value !== 'number') {
      throw new Error(`report member ${key} is not a number`);
    }
    out[key] = value;
  }
  return out;
}

function readDrive(text: string): Drive {
  const root: unknown = JSON.parse(text);
  if (!isObject(root)) {
    throw new Error('the report is not a JSON object');
  }
  const p99 = member(root, 'p99Ms');
  const stats = member(root, 'stats');
  const last = member(stats, 'last');
  const sinkCalls = root.sinkCalls;
  if (sinkCalls !== null && typeof sinkCalls !== 'number') {
    throw new Error('report field sinkCalls is neither null nor a number');
  }
  if (typeof stats.sumHeld !== 'boolean') {
    throw new Error('report field stats.sumHeld is not a boolean');
  }
  if (typeof root.fixture !== 'string') {
    throw new Error('report field fixture is not a string');
  }
  return {
    fixture: root.fixture,
    requests: num(root, 'requests'),
    answered: num(root, 'answered'),
    statuses: numbers(member(root, 'statuses')),
    p99Healthy: num(p99, 'healthy'),
    p99Failing: num(p99, 'failing'),
    ratio: num(root, 'ratio'),
    samples: num(stats, 'samples'),
    sumHeld: stats.sumHeld,
    maxHeldBytes: num(stats, 'maxHeldBytes'),
    last: {
      created: num(last, 'created'),
      written: num(last, 'written'),
      queued: num(last, 'queued'),
      inFlight: num(last, 'inFlight'),
      dropped: numbers(member(last, 'dropped')),
    },
    sinkCalls,
    peakRssBytes: num(root, 'peakRssBytes'),
    droppedShare: num(root, 'droppedShare'),
  };
}

function drive(fixture: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [driver, '--fixture', fixture], {
      cwd: sourceRoot,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    let err = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      out += chunk;
    });
    child.stderr.on('data', (chunk: string) => {
      err += chunk;
    });
    const timer = setTimeout(() => child.kill('SIGKILL'), driveTimeoutMs);
    child.once('error', reject);
    child.once('close', (code, signal) => {
      clearTimeout(timer);
      if (code === 0) {
        resolve(out);
        return;
      }
      reject(new Error(`the driver ended with code ${code} signal ${signal}: ${err.trim().slice(-300)}`));
    });
  });
}

function judge(drove: Drive, fixture: string): string[] {
  const problems: string[] = [];
  const other = Object.entries(drove.statuses).filter(([status]) => status !== '200');
  const total = Object.values(drove.statuses).reduce((sum, count) => sum + count, 0);
  check(problems, drove.fixture === fixture, `report is for ${drove.fixture}, not ${fixture}`);
  check(problems, drove.requests > 0, 'no request was sent');
  check(problems, drove.answered === drove.requests, `${drove.answered} of ${drove.requests} answered 200`);
  check(problems, total === drove.requests, `statuses add up to ${total}, not ${drove.requests}`);
  check(problems, other.length === 0, `non-200 statuses: ${JSON.stringify(Object.fromEntries(other))}`);
  check(problems, drove.samples > 0, `the stats call was sampled ${drove.samples} times`);
  check(problems, drove.sumHeld, 'the sum rule failed in a sample');
  const { last } = drove;
  const dropped = Object.values(last.dropped).reduce((sum, count) => sum + count, 0);
  const accounted = last.written + dropped + last.queued + last.inFlight;
  check(problems, last.created === accounted, `last sample: created ${last.created} is not ${accounted}`);
  check(problems, drove.maxHeldBytes <= queueBytes, `held ${drove.maxHeldBytes} bytes, over ${queueBytes}`);
  if (fixture === 'sink-hangs') {
    check(problems, drove.sinkCalls === 1, `sink called ${drove.sinkCalls} times, not once`);
  }
  return problems;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? Number.NaN;
}

const fixed = (value: number, digits: number): string => value.toFixed(digits);

const report = createReport('log-destination');
report.note('AC-8 and AC-9: six fixtures, three driver reports each, run one after another');
report.note('The p99 figures and their ratios are recorded and not judged; peak RSS and dropped share are reading M-2');

for (const fixture of fixtures) {
  const ratios: number[] = [];
  const heldPeaks: number[] = [];
  const rss: number[] = [];
  const shares: number[] = [];
  let answered = 0;
  let sent = 0;
  for (let run = 1; run <= repetitions; run++) {
    const name = `${fixture} run ${run}`;
    let drove: Drive;
    try {
      drove = readDrive(await drive(fixture));
    } catch (error) {
      report.result(name, [`driver: ${error instanceof Error ? error.message : String(error)}`], '');
      continue;
    }
    ratios.push(drove.ratio);
    heldPeaks.push(drove.maxHeldBytes);
    rss.push(drove.peakRssBytes);
    shares.push(drove.droppedShare);
    answered += drove.answered;
    sent += drove.requests;
    report.result(
      name,
      judge(drove, fixture),
      `answered ${drove.answered} of ${drove.requests} (statuses ${JSON.stringify(drove.statuses)}); samples ${drove.samples}; ` +
        `sum held ${drove.sumHeld}; max held ${drove.maxHeldBytes} bytes; sinkCalls ${drove.sinkCalls}; ` +
        `p99 healthy ${fixed(drove.p99Healthy, 3)} ms, failing ${fixed(drove.p99Failing, 3)} ms, ratio ${fixed(drove.ratio, 3)}; ` +
        `peak RSS ${drove.peakRssBytes} bytes; dropped share ${fixed(drove.droppedShare, 4)}`,
    );
  }
  report.note(
    `recorded ${fixture}: ${answered} of ${sent} answered over ${ratios.length} runs; ratios [${ratios.map((r) => fixed(r, 3)).join(', ')}], ` +
      `median ${fixed(median(ratios), 3)} (recorded, not judged); max held ${Math.max(...heldPeaks)} bytes; ` +
      `peak RSS ${Math.max(...rss)} bytes; dropped share [${shares.map((s) => fixed(s, 4)).join(', ')}] (M-2)`,
  );
}
report.finish();
