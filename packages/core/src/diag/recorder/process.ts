// Does:  Samples process-wide figures per snapshot: CPU, event-loop delay and utilisation, heap and GC.
// Holds: Each figure is the change since the previous snapshot, not a running total.

import {
  constants,
  type ELDHistogram,
  monitorEventLoopDelay,
  type PerformanceEntry,
  PerformanceObserver,
  type PerformanceObserverEntryList,
  performance,
} from 'node:perf_hooks';
import { getHeapStatistics } from 'node:v8';
import { toMicros } from './clock.ts';

interface GcFigures {
  n: number;
  pauseNs: number;
  maxNs: number;
}

const GC_KINDS: ReadonlyMap<number, string> = new Map([
  [constants.NODE_PERFORMANCE_GC_MINOR, 'scavenge'],
  [constants.NODE_PERFORMANCE_GC_MINOR_MARK_SWEEP, 'minor_mark_sweep'],
  [constants.NODE_PERFORMANCE_GC_MAJOR, 'mark_compact'],
  [constants.NODE_PERFORMANCE_GC_INCREMENTAL, 'incremental'],
  [constants.NODE_PERFORMANCE_GC_WEAKCB, 'weakcb'],
]);
const DELAY_RESOLUTION_MS = 10;

const gc = new Map<string, GcFigures>();
const watch: {
  cpu: NodeJS.CpuUsage;
  thread: NodeJS.CpuUsage;
  elu: ReturnType<typeof performance.eventLoopUtilization>;
  allocated: number;
  delay: ELDHistogram | null;
  observer: PerformanceObserver | null;
} = {
  cpu: process.cpuUsage(),
  thread: process.threadCpuUsage(),
  elu: performance.eventLoopUtilization(),
  allocated: getHeapStatistics().total_allocated_bytes,
  delay: null,
  observer: null,
};

export function gcKind(entry: PerformanceEntry): string {
  const detail: unknown = Reflect.get(entry, 'detail');
  const kind: unknown = typeof detail === 'object' && detail !== null ? Reflect.get(detail, 'kind') : undefined;
  return (typeof kind === 'number' ? GC_KINDS.get(kind) : undefined) ?? 'other';
}

function onGc(list: PerformanceObserverEntryList): void {
  for (const entry of list.getEntries()) {
    const kind = gcKind(entry);
    const figures = gc.get(kind) ?? { n: 0, pauseNs: 0, maxNs: 0 };
    const pauseNs = Math.round(entry.duration * 1e6);
    figures.n += 1;
    figures.pauseNs += pauseNs;
    figures.maxNs = Math.max(figures.maxNs, pauseNs);
    gc.set(kind, figures);
  }
}

export function startProcessWatch(): void {
  const delay = monitorEventLoopDelay({ resolution: DELAY_RESOLUTION_MS });
  delay.enable();
  const observer = new PerformanceObserver(onGc);
  observer.observe({ entryTypes: ['gc'] });
  watch.delay = delay;
  watch.observer = observer;
}

export function stopProcessWatch(): void {
  watch.delay?.disable();
  watch.observer?.disconnect();
  watch.delay = null;
  watch.observer = null;
}

function takeGc(): Record<string, { n: number; pause_us: number; max_us: number }> {
  const figures: Record<string, { n: number; pause_us: number; max_us: number }> = {};
  for (const [kind, { n, pauseNs, maxNs }] of gc) {
    figures[kind] = { n, pause_us: toMicros(pauseNs), max_us: toMicros(maxNs) };
  }
  gc.clear();
  return figures;
}

function takeDelay(): { p50_us: number; p99_us: number; max_us: number } {
  const { delay } = watch;
  if (delay === null || delay.count === 0) {
    return { p50_us: 0, p99_us: 0, max_us: 0 };
  }
  const figures = {
    p50_us: toMicros(delay.percentile(50)),
    p99_us: toMicros(delay.percentile(99)),
    max_us: toMicros(delay.max),
  };
  delay.reset();
  return figures;
}

export function takeProcessFigures(syncSelfNs: number): Record<string, unknown> {
  const cpu = process.cpuUsage();
  const thread = process.threadCpuUsage();
  const elu = performance.eventLoopUtilization();
  const heap = getHeapStatistics();
  const cpuUs = cpu.user + cpu.system - watch.cpu.user - watch.cpu.system;
  const mainUs = thread.user + thread.system - watch.thread.user - watch.thread.system;
  const utilization = performance.eventLoopUtilization(elu, watch.elu).utilization;
  const allocated = heap.total_allocated_bytes - watch.allocated;
  watch.cpu = cpu;
  watch.thread = thread;
  watch.elu = elu;
  watch.allocated = heap.total_allocated_bytes;
  return {
    cpu: cpuUs,
    main_cpu: mainUs,
    offthread_cpu: cpuUs - mainUs,
    unattributed_cpu: Math.round(mainUs * 1000 - syncSelfNs) / 1000,
    elu: Math.round(utilization * 1e6) / 1e6,
    alloc_bytes: allocated,
    heap: { used: heap.used_heap_size, total: heap.total_heap_size, rss: process.memoryUsage.rss() },
    gc: takeGc(),
    'loop.delay': takeDelay(),
  };
}
