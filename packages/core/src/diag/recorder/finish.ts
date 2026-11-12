// Does:  Closes a request's record when its response is written or its socket destroyed.
// Holds: A request is finished once; a finish that finds no open record is counted as diag.unowned.

import type { OutgoingHttpHeaders } from 'node:http';
import { nowNs, threadCpuUs } from './clock.ts';
import { config } from './config.ts';
import { type Counter, keyedCounter } from './counts.ts';
import { checkListeners } from './contain.ts';
import { checkWrite } from './egress.ts';
import { limitState, observe } from './limits.ts';
import { addSampledRequest, addSyncSelf, countSpan, recordSpan, standaloneSeries } from './series.ts';
import { closeAll } from './spans.ts';
import { releaseSlot, type SlotRecord, state } from './slots.ts';

export const totalSeries = standaloneSeries('req.total', true);
const requestMs = limitState('limit.request_ms');
const destroyedCount = keyedCounter('req.status', 'destroyed');
const statusCounts = new Map<number, Counter>();

export const writeGauge = { backpressure: 0 };

function statusCounter(status: number): Counter {
  const found = statusCounts.get(status);
  if (found !== undefined) {
    return found;
  }
  const created = keyedCounter('req.status', status);
  statusCounts.set(status, created);
  return created;
}

function openRecord(hook: string): SlotRecord | null {
  const record = state.current;
  if (record === null || !record.open) {
    keyedCounter('diag.unowned', hook).total += 1;
    return null;
  }
  return record;
}

function finish(record: SlotRecord, status: Counter, t: number): void {
  const incl = t - record.start;
  record.endAt = t;
  if (record.step) {
    closeAll(record, t, record.cpu ? threadCpuUs() : -1);
    recordSpan(totalSeries, incl, incl - record.rootChild, -1, false, true);
    addSampledRequest(incl);
  } else {
    countSpan(totalSeries, incl);
  }
  if (record.seg === 0) {
    addSyncSelf(incl);
  } else if (record.step) {
    addSyncSelf(record.syncSelf * config.stepN);
  }
  status.total += 1;
  const { route, res } = record;
  if (config.options !== null) {
    observe(requestMs, incl / 1e6, config.options.requestTimeout, route?.id ?? null);
  }
  if (route !== null && incl > route.slowestNs) {
    route.slowestNs = incl;
  }
  if (res !== null && res.writableLength > writeGauge.backpressure) {
    writeGauge.backpressure = res.writableLength;
  }
  if (record.cpu) {
    checkListeners(record);
  }
  releaseSlot(record);
}

export function finishWrote(
  status: number,
  headers: OutgoingHttpHeaders | null,
  payload: string | Uint8Array | null,
): void {
  const record = openRecord('wrote');
  if (record === null) {
    return;
  }
  const t = nowNs();
  checkWrite(record, status, headers, payload);
  finish(record, statusCounter(status), t);
}

export function finishDestroyed(): void {
  const record = openRecord('destroyed');
  if (record !== null) {
    finish(record, destroyedCount, nowNs());
  }
}
