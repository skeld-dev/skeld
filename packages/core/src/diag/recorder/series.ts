import { createHistogram, type RecordableHistogram } from 'node:perf_hooks';
import type { StageName, StepName } from '../empty.ts';
import { toMicros } from './clock.ts';

export interface NameEntry {
  readonly name: string;
  readonly step: boolean;
  readonly keyless: Series;
  readonly keyed: Map<string | number, Series>;
}

export interface Series {
  readonly label: string;
  readonly name: string;
  readonly always: boolean;
  readonly histogram: RecordableHistogram;
  readonly pending: number[];
  n: number;
  cn: number;
  incl: number;
  self: number;
  cpu: number;
  maxNs: number;
  sampled: number;
}

export interface SpanFigures {
  readonly n: number;
  readonly cn: number;
  readonly incl: number;
  readonly self: number;
  readonly cpu: number;
  readonly p50: number;
  readonly p95: number;
  readonly max: number;
}

const STAGES: readonly StageName[] = [
  'req.preroute',
  'req.route.find',
  'req.hook.on_request',
  'req.body',
  'req.body.read',
  'req.body.parse',
  'req.validate',
  'req.hook.pre_handler',
  'req.respond',
  'req.hook.on_send',
  'req.respond.write',
];
const STEPS: readonly StepName[] = [
  'req.preroute.framing',
  'req.preroute.target',
  'req.route.split',
  'req.route.match',
  'req.body.media_type',
  'req.body.forbidden_key',
  'req.query.parse',
  'req.validate.errors',
  'req.handler.arg',
  'req.respond.serialize',
];
const SAMPLED_TRACKS: ReadonlySet<string> = new Set(['client.url', 'client.headers']);
const STEP_NAMES: ReadonlySet<string> = new Set<string>([...STEPS, 'req.validate.part', ...SAMPLED_TRACKS]);
const ALWAYS_PRESENT: ReadonlySet<string> = new Set<string>([...STAGES, ...STEPS]);

// Span histograms hold 1 ns to 1 h at two significant figures; three figures make reset() cost about 35 µs each.
const HISTOGRAM_RANGE = { lowest: 1, highest: 3_600_000_000_000, figures: 2 };
// Self-wall values held per series between snapshots before they are recorded into its histogram.
const PENDING_MAX = 1024;

const allSeries: Series[] = [];
const entries = new Map<string, NameEntry>();
const window = { syncSelfNs: 0, sampledN: 0, sampledInclNs: 0 };

function createSeries(label: string, name: string, always: boolean): Series {
  const created: Series = {
    label,
    name,
    always,
    histogram: createHistogram(HISTOGRAM_RANGE),
    pending: [],
    n: 0,
    cn: 0,
    incl: 0,
    self: 0,
    cpu: 0,
    maxNs: 0,
    sampled: 0,
  };
  allSeries.push(created);
  return created;
}

export function nameEntry(name: string): NameEntry {
  const found = entries.get(name);
  if (found !== undefined) {
    return found;
  }
  const created: NameEntry = {
    name,
    step: STEP_NAMES.has(name),
    keyless: createSeries(name, name, ALWAYS_PRESENT.has(name)),
    keyed: new Map(),
  };
  entries.set(name, created);
  return created;
}

export function keyedSeries(entry: NameEntry, key: string | number, always = false): Series {
  const found = entry.keyed.get(key);
  if (found !== undefined) {
    return found;
  }
  const created = createSeries(`${entry.name}{${key}}`, entry.name, always);
  entry.keyed.set(key, created);
  return created;
}

for (const name of ALWAYS_PRESENT) {
  nameEntry(name);
}

export const standaloneSeries = (label: string, always: boolean): Series => createSeries(label, label, always);

function flushPending(series: Series): void {
  const { histogram, pending } = series;
  for (const value of pending) {
    histogram.record(value);
  }
  pending.length = 0;
}

export function countSpan(series: Series, inclNs: number): void {
  series.n += 1;
  series.incl += inclNs;
}

export function recordSpan(
  series: Series,
  inclNs: number,
  selfNs: number,
  cpuUs: number,
  sync: boolean,
  sampled: boolean,
): void {
  series.n += 1;
  series.incl += inclNs;
  series.self += selfNs;
  if (cpuUs >= 0) {
    series.cn += 1;
    series.cpu += cpuUs;
  }
  if (selfNs > series.maxNs) {
    series.maxNs = selfNs;
  }
  if (sampled) {
    series.sampled += 1;
    series.pending.push(selfNs);
    if (series.pending.length === PENDING_MAX) {
      flushPending(series);
    }
  }
  if (sync) {
    window.syncSelfNs += selfNs;
  }
}

export function addSyncSelf(selfNs: number): void {
  window.syncSelfNs += selfNs;
}

export function addSampledRequest(inclNs: number): void {
  window.sampledN += 1;
  window.sampledInclNs += inclNs;
}

export function takeSampledRequests(): { n: number; incl: number } {
  const sampled = { n: window.sampledN, incl: toMicros(window.sampledInclNs) };
  window.sampledN = 0;
  window.sampledInclNs = 0;
  return sampled;
}

export function takeSyncSelfNs(): number {
  const value = window.syncSelfNs;
  window.syncSelfNs = 0;
  return value;
}

function figures(series: Series): SpanFigures {
  flushPending(series);
  const { histogram } = series;
  const empty = series.sampled === 0;
  return {
    n: series.n,
    cn: series.cn,
    incl: toMicros(series.incl),
    self: toMicros(series.self),
    cpu: series.cpu,
    p50: empty ? 0 : toMicros(histogram.percentile(50)),
    p95: empty ? 0 : toMicros(histogram.percentile(95)),
    max: toMicros(series.maxNs),
  };
}

export function takeSpanFigures(): Record<string, SpanFigures> {
  const spans: Record<string, SpanFigures> = {};
  for (const series of allSeries) {
    if (series.n === 0) {
      if (series.always) {
        spans[series.label] = figures(series);
      }
      continue;
    }
    spans[series.label] = figures(series);
    series.n = 0;
    series.cn = 0;
    series.incl = 0;
    series.self = 0;
    series.cpu = 0;
    series.maxNs = 0;
    if (series.sampled > 0) {
      series.sampled = 0;
      series.histogram.reset();
    }
  }
  return spans;
}
