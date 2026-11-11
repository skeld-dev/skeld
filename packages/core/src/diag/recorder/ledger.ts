import { type PerformanceEntry, PerformanceObserver } from 'node:perf_hooks';
import { GCProfiler, type GCProfilerResult, getHeapSpaceStatistics } from 'node:v8';
import { nowNs, toMicros } from './clock.ts';
import { gcKind } from './process.ts';
import { ambient } from './slots.ts';

interface Heap {
  readonly young: number;
  readonly old: number;
  readonly code: number;
}

interface Mark extends Heap {
  readonly at: number;
  readonly stage: string;
  readonly cost: number;
}

interface Collection {
  readonly at: number;
  readonly kind: string;
  readonly pause: number;
  readonly before: Heap;
  readonly after: Heap;
}

interface StageFigures {
  wall_us: number;
  young_bytes: number;
  old_bytes: number;
  gc_n: number;
  gc_pause_us: number;
  marks: number;
  mark_us: number;
}

type GcStatistics = GCProfilerResult['statistics'];
type SpaceGroup = keyof Heap;

const OUTSIDE = '(no boot span)';
// Background compilers allocate code and trusted space through their own buffers, so those spaces move ±300 KB between
// two reads with no main-thread work; they are kept apart from young and old and reported for the whole boot only.
const GROUPS: ReadonlyMap<string, SpaceGroup> = new Map([
  ['new_space', 'young'],
  ['new_large_object_space', 'young'],
  ['old_space', 'old'],
  ['large_object_space', 'old'],
  ['code_space', 'code'],
  ['code_large_object_space', 'code'],
  ['trusted_space', 'code'],
  ['trusted_large_object_space', 'code'],
]);

const ledger: {
  profiler: GCProfiler | null;
  observer: PerformanceObserver | null;
  entries: PerformanceEntry[];
  stats: GcStatistics;
  marks: Mark[];
  readBytes: number;
  done: boolean;
  figures: Record<string, unknown> | null;
} = {
  profiler: null,
  observer: null,
  entries: [],
  stats: [],
  marks: [],
  readBytes: 0,
  done: false,
  figures: null,
};

function addSpace(heap: { -readonly [group in SpaceGroup]: number }, name: string, used: number): void {
  const group = GROUPS.get(name);
  if (group !== undefined) {
    heap[group] += used;
  }
}

function readHeap(): Heap {
  const heap = { young: 0, old: 0, code: 0 };
  for (const space of getHeapSpaceStatistics()) {
    addSpace(heap, space.space_name, space.space_used_size);
  }
  return heap;
}

function innermost(): string {
  return ambient.frames[ambient.depth - 1]?.series?.name ?? OUTSIDE;
}

function takeMark(): void {
  const begin = nowNs();
  const heap = readHeap();
  const stage = innermost();
  const at = nowNs();
  ledger.marks.push({ ...heap, at, stage, cost: at - begin });
}

export function markBoot(): void {
  if (ledger.profiler !== null && !ledger.done) {
    takeMark();
  }
}

export function openBoot(): void {
  const observer = new PerformanceObserver((list) => {
    ledger.entries.push(...list.getEntries());
  });
  observer.observe({ entryTypes: ['gc'] });
  ledger.observer = observer;
  const calibration = readHeap();
  ledger.readBytes = readHeap().young - calibration.young;
  takeMark();
  ledger.profiler = new GCProfiler();
  ledger.profiler.start();
}

export function closeBoot(): void {
  if (ledger.profiler === null || ledger.done) {
    return;
  }
  ledger.stats = ledger.profiler.stop().statistics;
  takeMark();
  ledger.done = true;
}

function stageOf(stages: Map<string, StageFigures>, name: string): StageFigures {
  const found = stages.get(name);
  if (found !== undefined) {
    return found;
  }
  const created = { wall_us: 0, young_bytes: 0, old_bytes: 0, gc_n: 0, gc_pause_us: 0, marks: 0, mark_us: 0 };
  stages.set(name, created);
  return created;
}

function profiledHeap(spaces: GcStatistics[number]['beforeGC']['heapSpaceStatistics']): Heap {
  const heap = { young: 0, old: 0, code: 0 };
  for (const space of spaces) {
    addSpace(heap, space.spaceName, space.spaceUsedSize);
  }
  return heap;
}

function collections(entries: readonly PerformanceEntry[], stats: GcStatistics): Collection[] {
  return entries.flatMap((entry, index) => {
    const stat = stats[index];
    if (stat === undefined) {
      return [];
    }
    return [
      {
        at: Math.round(entry.startTime * 1e6),
        kind: gcKind(entry),
        pause: entry.duration * 1e6,
        before: profiledHeap(stat.beforeGC.heapSpaceStatistics),
        after: profiledHeap(stat.afterGC.heapSpaceStatistics),
      },
    ];
  });
}

function settle(first: Mark, rest: readonly Mark[], gcs: readonly Collection[]): Record<string, unknown> {
  const stages = new Map<string, StageFigures>();
  const total = { wall_us: 0, young_bytes: 0, old_bytes: 0, code_bytes: 0, gc_n: 0, gc_pause_us: 0, mark_us: 0 };
  const gc: Record<string, unknown>[] = [];
  let pending = gcs;
  let previous = first;
  for (const mark of rest) {
    const stage = stageOf(stages, previous.stage);
    const inside = pending.filter((collection) => collection.at < mark.at);
    pending = pending.slice(inside.length);
    const allocated = {
      young: mark.young - previous.young,
      old: mark.old - previous.old,
      code: mark.code - previous.code,
    };
    for (const collection of inside) {
      allocated.young += collection.before.young - collection.after.young;
      allocated.old += collection.before.old - collection.after.old;
      allocated.code += collection.before.code - collection.after.code;
      stage.gc_n += 1;
      stage.gc_pause_us += toMicros(collection.pause);
      total.gc_pause_us += toMicros(collection.pause);
      gc.push({
        kind: collection.kind,
        at_us: toMicros(collection.at - first.at),
        pause_us: toMicros(collection.pause),
        young_before: collection.before.young,
        young_after: collection.after.young,
        old_before: collection.before.old,
        old_after: collection.after.old,
        stage: previous.stage,
      });
    }
    const wall = toMicros(mark.at - previous.at);
    const cost = toMicros(mark.cost);
    stage.wall_us += wall;
    stage.young_bytes += allocated.young;
    stage.old_bytes += allocated.old;
    stage.marks += 1;
    stage.mark_us += cost;
    total.wall_us += wall;
    total.young_bytes += allocated.young;
    total.old_bytes += allocated.old;
    total.code_bytes += allocated.code;
    total.gc_n += inside.length;
    total.mark_us += cost;
    previous = mark;
  }
  return { total, stages: Object.fromEntries(stages), gc, marks: rest.length + 1, read_bytes: ledger.readBytes };
}

export function bootLedger(): Record<string, unknown> | null {
  const [first, ...rest] = ledger.marks;
  const last = rest.at(-1);
  if (
    ledger.figures !== null ||
    !ledger.done ||
    ledger.observer === null ||
    first === undefined ||
    last === undefined
  ) {
    return ledger.figures;
  }
  const inBoot = [...ledger.entries, ...ledger.observer.takeRecords()].filter((entry) => {
    const at = Math.round(entry.startTime * 1e6);
    return at >= first.at && at <= last.at;
  });
  if (inBoot.length < ledger.stats.length) {
    return { pending: true, gc_seen: inBoot.length, gc_expected: ledger.stats.length };
  }
  ledger.observer.disconnect();
  ledger.observer = null;
  ledger.entries = [];
  ledger.marks = [];
  const sorted = inBoot.toSorted((a, b) => a.startTime - b.startTime);
  ledger.figures =
    sorted.length === ledger.stats.length
      ? settle(first, rest, collections(sorted, ledger.stats))
      : { mismatch: true, gc_seen: sorted.length, gc_expected: ledger.stats.length };
  return ledger.figures;
}
