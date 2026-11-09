import type { IncomingMessage, ServerResponse } from 'node:http';
import type { RouteInfo } from '../../contract/types.ts';
import { nowNs, toMillis } from './clock.ts';
import { config } from './config.ts';
import { counter } from './counts.ts';
import { raise } from './events.ts';
import { limitState, observe } from './limits.ts';
import { type RouteRecord, routeRecord } from './routes.ts';
import { recordSpan, type Series, standaloneSeries } from './series.ts';

export interface Frame {
  series: Series | null;
  start: number;
  child: number;
  childCpu: number;
  seg: number;
  cpu: number;
}

export interface SlotRecord {
  readonly index: number;
  readonly frames: readonly Frame[];
  gen: number;
  open: boolean;
  inSeg: boolean;
  depth: number;
  step: boolean;
  cpu: boolean;
  seg: number;
  segStart: number;
  start: number;
  endAt: number;
  rootChild: number;
  syncSelf: number;
  syncDone: boolean;
  schemaChecked: boolean;
  replaced: boolean;
  route: RouteRecord | null;
  req: IncomingMessage | null;
  res: ServerResponse | null;
}

export const SLOT_COUNT = 4096;
export const DEPTH = 16;
export const INDEX_MASK = 0x1fff;
export const DEPTH_SHIFT = 13;
export const DEPTH_MASK = 0xf;
export const GEN_SHIFT = 17;
const GEN_MAX = 0xfff;

const syncSeries = standaloneSeries('req.sync', true);
const headerBytes = limitState('limit.header_bytes');
const abandoned = counter('diag.abandoned');

function createFrame(): Frame {
  return { series: null, start: 0, child: 0, childCpu: 0, seg: 0, cpu: -1 };
}

function createSlot(index: number): SlotRecord {
  return {
    index,
    frames: Array.from({ length: DEPTH }, createFrame),
    gen: 0,
    open: false,
    inSeg: false,
    depth: 0,
    step: false,
    cpu: false,
    seg: 0,
    segStart: 0,
    start: 0,
    endAt: 0,
    rootChild: 0,
    syncSelf: 0,
    syncDone: false,
    schemaChecked: false,
    replaced: false,
    route: null,
    req: null,
    res: null,
  };
}

export const ambient: SlotRecord = Object.assign(createSlot(SLOT_COUNT), { gen: 1, step: true, cpu: true });

export const slots: readonly SlotRecord[] = [
  ...Array.from({ length: SLOT_COUNT }, (_, index) => createSlot(index)),
  ambient,
];

const free: SlotRecord[] = slots.slice(0, SLOT_COUNT).reverse();

export const state: {
  current: SlotRecord | null;
  ring: number;
  listening: boolean;
  begun: number;
  inflight: number;
} = { current: null, ring: 0, listening: false, begun: 0, inflight: 0 };

const sampling = { stepLeft: 0, cpuLeft: 0 };

const slotValue = (record: SlotRecord): number => (record.gen << DEPTH_SHIFT) | record.index;

function slotFor(slot: number): SlotRecord | null {
  const record = slots[slot & INDEX_MASK];
  return record !== undefined && record !== ambient && record.gen === slot >>> DEPTH_SHIFT ? record : null;
}

function takeOldest(): SlotRecord | null {
  const index = state.ring;
  state.ring = index + 1 === SLOT_COUNT ? 0 : index + 1;
  const record = slots[index];
  if (record === undefined) {
    return null;
  }
  abandoned.total += 1;
  state.inflight -= 1;
  return record;
}

export function releaseSlot(record: SlotRecord): void {
  record.open = false;
  record.req = null;
  record.res = null;
  state.inflight -= 1;
  free.push(record);
}

function observeHeaderBytes(rawHeaders: readonly string[]): void {
  const { options } = config;
  if (options === null) {
    return;
  }
  let bytes = 2 * rawHeaders.length;
  for (const part of rawHeaders) {
    bytes += part.length;
  }
  observe(headerBytes, bytes, options.maxHeaderSize, null);
}

export function beginRequest(req: IncomingMessage, res: ServerResponse): number {
  state.begun += 1;
  const record = free.pop() ?? takeOldest();
  if (record === null) {
    return 0;
  }
  record.gen = record.gen === GEN_MAX ? 1 : record.gen + 1;
  record.open = true;
  record.inSeg = true;
  record.depth = 0;
  record.seg = 0;
  record.rootChild = 0;
  record.syncSelf = 0;
  record.syncDone = false;
  record.schemaChecked = false;
  record.replaced = false;
  record.route = null;
  record.step = sampling.stepLeft === 0;
  record.cpu = sampling.cpuLeft === 0;
  sampling.stepLeft = record.step ? config.stepN - 1 : sampling.stepLeft - 1;
  sampling.cpuLeft = record.cpu ? config.cpuN - 1 : sampling.cpuLeft - 1;
  record.req = req;
  record.res = res;
  state.inflight += 1;
  state.current = record;
  observeHeaderBytes(req.rawHeaders);
  const t = nowNs();
  record.start = t;
  record.segStart = t;
  return slotValue(record);
}

export function leaveSlot(slot: number): void {
  const record = slotFor(slot);
  state.current = null;
  if (record === null || !record.inSeg) {
    return;
  }
  record.inSeg = false;
  const length = (record.open ? nowNs() : record.endAt) - record.segStart;
  if (!record.syncDone) {
    record.syncDone = true;
    recordSpan(syncSeries, length, length, -1, false, record.step);
  }
  if (length > config.blockMs * 1e6) {
    raise('loop.block', toMillis(length), record.route?.name ?? null, null);
  }
}

export function resumeSlot(slot: number): void {
  const record = slotFor(slot);
  if (record === null) {
    state.current = null;
    return;
  }
  record.seg += 1;
  record.inSeg = true;
  record.segStart = nowNs();
  state.current = record;
}

export function currentSlot(): number {
  const record = state.current;
  return record === null ? 0 : slotValue(record);
}

export function routeRequest(route: RouteInfo): void {
  const record = state.current;
  if (record === null) {
    return;
  }
  const found = routeRecord(route);
  record.route = found;
  found.count.total += 1;
}

export const currentRouteName = (): string | null => state.current?.route?.name ?? null;
