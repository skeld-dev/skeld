// Does:  Opens and closes timing spans on the current request's frame stack, and detached tracks.
// Holds: A span closed out of order closes those above it first and is counted as diag.span_order.

import type { SpanName, TrackName } from '../empty.ts';
import { nowNs, threadCpuUs } from './clock.ts';
import { config } from './config.ts';
import { counter, keyedCounter } from './counts.ts';
import { limitState, observe } from './limits.ts';
import { keyedSeries, nameEntry, recordSpan, type Series } from './series.ts';
import {
  ambient,
  DEPTH_MASK,
  DEPTH_SHIFT,
  type Frame,
  GEN_SHIFT,
  INDEX_MASK,
  type SlotRecord,
  slots,
  state,
} from './slots.ts';

interface TrackRecord {
  readonly index: number;
  series: Series | null;
  start: number;
  gen: number;
}

// Why: Bit 29 marks a token as a detached track, so endSpan can tell the two kinds apart.
const DETACHED = 1 << 29;
export const TRACK_COUNT = 4096;
const TRACK_INDEX_MASK = 0xfff;
const TRACK_GEN_SHIFT = 12;
const TRACK_GEN_MAX = 0x1ffff;

const handlerEntry = nameEntry('req.handler');
const handlerSync = keyedSeries(handlerEntry, 'sync', true);
const handlerAsync = keyedSeries(handlerEntry, 'async', true);
const pluginLimit = limitState('limit.plugin_ms');
const closeLimit = limitState('limit.close_ms');
const spanOrder = counter('diag.span_order');
const depthOverflow = counter('diag.depth_overflow');
const abandoned = counter('diag.abandoned');

const tracks: readonly TrackRecord[] = Array.from({ length: TRACK_COUNT }, (_, index) => ({
  index,
  series: null,
  start: 0,
  gen: 0,
}));
const trackState = { ring: 0, sampled: 0 };

export const gaugeState: { closeInflight: number | null } = { closeInflight: null };

const tokenOf = (record: SlotRecord, depth: number): number =>
  (record.gen << GEN_SHIFT) | (depth << DEPTH_SHIFT) | record.index;

function openFrame(record: SlotRecord, frame: Frame, series: Series, t: number, cpu: number): number {
  const depth = record.depth;
  frame.series = series;
  frame.start = t;
  frame.child = 0;
  frame.childCpu = 0;
  frame.seg = record.seg;
  frame.cpu = cpu;
  record.depth = depth + 1;
  return tokenOf(record, depth);
}

function closeTop(record: SlotRecord, t: number, cpu: number): void {
  const depth = record.depth - 1;
  const frame = record.frames[depth];
  record.depth = depth;
  if (frame === undefined || frame.series === null) {
    return;
  }
  const incl = t - frame.start;
  const same = frame.seg === record.seg;
  const cpuIncl = same && frame.cpu >= 0 && cpu >= 0 ? cpu - frame.cpu : -1;
  const parent = depth > 0 ? record.frames[depth - 1] : undefined;
  if (parent === undefined) {
    record.rootChild += incl;
  } else {
    parent.child += incl;
    if (cpuIncl >= 0) {
      parent.childCpu += cpuIncl;
    }
  }
  let series = frame.series;
  frame.series = null;
  if (series === handlerEntry.keyless) {
    series = same ? handlerSync : handlerAsync;
  }
  const self = incl - frame.child;
  const boot = record === ambient;
  if (same && !boot) {
    record.syncSelf += self;
  }
  recordSpan(series, incl, self, cpuIncl >= 0 ? cpuIncl - frame.childCpu : -1, same && boot, record.step);
  if (series.name === 'boot.plugin' && config.options !== null) {
    observe(pluginLimit, incl / 1e6, config.options.pluginTimeoutMs, null);
  }
}

export function closeAll(record: SlotRecord, t: number, cpu: number): void {
  while (record.depth > 0) {
    closeTop(record, t, cpu);
  }
}

function closeThrough(record: SlotRecord, depth: number, t: number, cpu: number): void {
  if (depth < record.depth - 1) {
    spanOrder.total += 1;
    while (record.depth > depth + 1) {
      closeTop(record, t, cpu);
    }
  }
  closeTop(record, t, cpu);
}

function measuresCpu(record: SlotRecord, depth: number): boolean {
  const frame = record.frames[depth];
  return record.cpu && frame !== undefined && frame.cpu >= 0;
}

function openRecord(): SlotRecord | null {
  return state.current ?? (state.listening ? null : ambient);
}

export function startSpan(name: SpanName, key?: string | number): number {
  const live = state.current;
  if (live !== null && !live.step) {
    return 0;
  }
  const record = openRecord();
  if (record === null) {
    keyedCounter('diag.unowned', name).total += 1;
    return 0;
  }
  if (!record.step) {
    return 0;
  }
  const entry = nameEntry(name);
  const frame = record.frames[record.depth];
  if (frame === undefined) {
    depthOverflow.total += 1;
    return 0;
  }
  const series = key === undefined ? entry.keyless : keyedSeries(entry, key);
  return openFrame(record, frame, series, nowNs(), record.cpu && !entry.step ? threadCpuUs() : -1);
}

function openSlotOf(token: number): SlotRecord | null {
  const record = slots[token & INDEX_MASK];
  if (record === undefined || record.gen !== token >>> GEN_SHIFT) {
    return null;
  }
  return ((token >>> DEPTH_SHIFT) & DEPTH_MASK) < record.depth ? record : null;
}

function endTrack(token: number): void {
  const track = tracks[token & TRACK_INDEX_MASK];
  if (track === undefined || track.series === null || track.gen !== (token ^ DETACHED) >>> TRACK_GEN_SHIFT) {
    return;
  }
  const series = track.series;
  track.series = null;
  const incl = nowNs() - track.start;
  recordSpan(series, incl, incl, -1, false, true);
  if (series.name === 'close.total' && config.options !== null) {
    observe(closeLimit, incl / 1e6, config.options.closeTimeoutMs, null);
  }
}

export function endSpan(token: number): void {
  if (token === 0) {
    return;
  }
  if (token >= DETACHED) {
    endTrack(token);
    return;
  }
  const record = openSlotOf(token);
  if (record === null) {
    return;
  }
  const depth = (token >>> DEPTH_SHIFT) & DEPTH_MASK;
  const t = nowNs();
  closeThrough(record, depth, t, measuresCpu(record, depth) ? threadCpuUs() : -1);
}

export function nextSpan(token: number, name: SpanName): number {
  const record = token === 0 || token >= DETACHED ? null : openSlotOf(token);
  if (record === null) {
    return startSpan(name);
  }
  const depth = (token >>> DEPTH_SHIFT) & DEPTH_MASK;
  const entry = nameEntry(name);
  const t = nowNs();
  const cpu = measuresCpu(record, depth) || (record.cpu && !entry.step) ? threadCpuUs() : -1;
  closeThrough(record, depth, t, cpu);
  const frame = record.frames[depth];
  if (frame === undefined) {
    return 0;
  }
  return openFrame(record, frame, entry.keyless, t, entry.step ? -1 : cpu);
}

export function trackSpan(name: TrackName, key?: string): number {
  const entry = nameEntry(name);
  if (entry.step) {
    const n = trackState.sampled;
    trackState.sampled = n + 1;
    if (n % config.stepN !== 0) {
      return 0;
    }
  }
  const index = trackState.ring;
  trackState.ring = index + 1 === TRACK_COUNT ? 0 : index + 1;
  const track = tracks[index];
  if (track === undefined) {
    return 0;
  }
  if (track.series !== null) {
    abandoned.total += 1;
  }
  if (name === 'close.total') {
    gaugeState.closeInflight = state.inflight;
  }
  track.gen = track.gen === TRACK_GEN_MAX ? 1 : track.gen + 1;
  track.series = key === undefined ? entry.keyless : keyedSeries(entry, key);
  track.start = nowNs();
  return DETACHED | (track.gen << TRACK_GEN_SHIFT) | index;
}
