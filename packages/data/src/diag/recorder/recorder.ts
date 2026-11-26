// Does:  Implements data's diagnostic hooks for the diag build and writes data-snapshot.jsonl and data-journal.jsonl.
// Holds: It exports exactly the hooks empty.ts declares; after one failed write it writes nothing more.

import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import type { Count, End, Limit, Start, Token } from '../empty.ts';

export type { Token } from '../empty.ts';

interface SpanRecord {
  seq: Token;
  label: string;
  t0: number;
}

interface SpanFigures {
  n: number;
  runN: number;
  totalNs: number;
  maxNs: number;
}

interface LimitFigures {
  n: number;
  used: number;
  max: number;
  ratio: number;
  over: number;
  runPeak: number;
  armed: boolean;
}

const SNAPSHOT_INTERVAL_MS = 1000;
// Why: A span left open is overwritten after 4096 newer ones, so an unclosed span never grows memory.
const RING = 4096;
const NEAR = 0.8;
const ALARM = 0.95;
// Why: A flood of one name must not fill the journal; its figures still record every occurrence.
const LINES_PER_WINDOW = 10;

const ring: SpanRecord[] = Array.from({ length: RING }, () => ({ seq: 0, label: '', t0: 0 }));
const spans = new Map<string, SpanFigures>();
const counts = new Map<string, number>();
const limits = new Map<string, LimitFigures>();
const eventLines = new Map<string, number>();
const run = { seq: 0, lost: 0, stopped: false, finalWritten: false };

const nowNs = (): number => Math.round(performance.now() * 1e6);
const labelOf = (name: string, key: string | number | undefined): string =>
  key === undefined || key === '' ? name : `${name}{${key}}`;

function readDir(): string {
  const dir = process.env.SKELD_DIAG_DIR;
  if (dir === undefined || dir === '') {
    throw new Error('SKELD_DIAG_DIR is not set; the data diag build writes data-snapshot.jsonl and data-journal.jsonl');
  }
  return dir;
}

const dir = readDir();
// Why: The package's import rule admits no node:path, and Node accepts a slash separator on every platform.
const base = dir.endsWith('/') ? dir : `${dir}/`;
const snapshotPath = `${base}data-snapshot.jsonl`;
const journalPath = `${base}data-journal.jsonl`;
mkdirSync(dir, { recursive: true });
writeFileSync(snapshotPath, '');
writeFileSync(journalPath, '');

function append(path: string, line: string): void {
  if (run.stopped) {
    return;
  }
  try {
    appendFileSync(path, `${line}\n`);
  } catch (error) {
    run.stopped = true;
    const code: unknown = error instanceof Error ? Reflect.get(error, 'code') : undefined;
    if (typeof code !== 'string') {
      throw error;
    }
    process.stderr.write(`skeld data diag: writing ${path} failed: ${code}; diag files stop here\n`);
  }
}

function journal(name: string, entry: Record<string, unknown>): void {
  const lines = eventLines.get(name) ?? 0;
  eventLines.set(name, lines + 1);
  if (lines < LINES_PER_WINDOW) {
    append(journalPath, JSON.stringify({ t: Date.now(), name, ...entry }));
  }
}

function takeSpans(): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [label, figures] of spans) {
    out[label] = {
      n: figures.n,
      run_n: figures.runN,
      total_ms: Math.round(figures.totalNs / 1000) / 1000,
      max_ms: Math.round(figures.maxNs / 1000) / 1000,
    };
    figures.n = 0;
    figures.totalNs = 0;
    figures.maxNs = 0;
  }
  return out;
}

function takeLimits(): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [name, figures] of limits) {
    out[name] = {
      n: figures.n,
      used: figures.used,
      max: figures.max,
      ratio: Math.round(figures.ratio * 1e6) / 1e6,
      over: figures.over,
      run_peak: Math.round(figures.runPeak * 1e6) / 1e6,
      armed: figures.armed,
    };
    figures.n = 0;
    figures.used = 0;
    figures.max = 0;
    figures.ratio = 0;
    figures.over = 0;
  }
  return out;
}

function writeSnapshot(final: boolean): void {
  const line = {
    t: Date.now(),
    final,
    counts: Object.fromEntries(counts),
    spans: takeSpans(),
    limits: takeLimits(),
    lost_spans: run.lost,
  };
  eventLines.clear();
  append(snapshotPath, JSON.stringify(line));
}

function writeFinal(): void {
  if (!run.finalWritten) {
    run.finalWritten = true;
    writeSnapshot(true);
  }
}

const timer = setInterval(() => writeSnapshot(false), SNAPSHOT_INTERVAL_MS);
// Why: The snapshot timer must not keep the process alive.
timer.unref();
// Why: A process that exits between two ticks still gets its last figures.
process.on('exit', writeFinal);

export const start: Start = (name, key) => {
  run.seq += 1;
  const record = ring[run.seq % RING];
  if (record === undefined) {
    throw new RangeError(`span ring has no slot ${run.seq % RING}`);
  }
  if (record.seq !== 0) {
    run.lost += 1;
  }
  record.seq = run.seq;
  record.label = labelOf(name, key);
  record.t0 = nowNs();
  return run.seq;
};

export const end: End = (token) => {
  const record = ring[token % RING];
  if (record === undefined || record.seq !== token || token === 0) {
    run.lost += 1;
    return;
  }
  const ns = nowNs() - record.t0;
  record.seq = 0;
  let figures = spans.get(record.label);
  if (figures === undefined) {
    figures = { n: 0, runN: 0, totalNs: 0, maxNs: 0 };
    spans.set(record.label, figures);
  }
  figures.n += 1;
  figures.runN += 1;
  figures.totalNs += ns;
  if (ns > figures.maxNs) {
    figures.maxNs = ns;
  }
};

export const count: Count = (name, key) => {
  const label = labelOf(name, key);
  counts.set(label, (counts.get(label) ?? 0) + 1);
};

export const limit: Limit = (name, used, max) => {
  let figures = limits.get(name);
  if (figures === undefined) {
    figures = { n: 0, used: 0, max: 0, ratio: 0, over: 0, runPeak: 0, armed: true };
    limits.set(name, figures);
  }
  const ratio = max > 0 ? used / max : 0;
  figures.n += 1;
  if (figures.n === 1 || ratio > figures.ratio) {
    figures.used = used;
    figures.max = max;
    figures.ratio = ratio;
  }
  if (ratio > figures.runPeak) {
    figures.runPeak = ratio;
  }
  if (ratio > 1) {
    figures.over += 1;
  }
  if (figures.armed && ratio >= ALARM) {
    figures.armed = false;
    journal(name, { kind: 'headroom_low', used, max });
  } else if (!figures.armed && ratio < NEAR) {
    figures.armed = true;
  }
};
