// Does:  Closes a request's record when its response is written or its socket destroyed.
// Holds: A request is finished once; a finish that finds no open record is counted as diag.unowned.

import type { OutgoingHttpHeaders } from 'node:http';
import { nowNs } from './clock.ts';
import { config } from './config.ts';
import { type Counter, keyedCounter } from './counts.ts';
import { checkListeners } from './contain.ts';
import { checkWrite } from './egress.ts';
import { limitState, observe } from './limits.ts';
import { addSampledRequest, addSyncSelf, countSpan, recordSpan, standaloneSeries } from './series.ts';
import { closeAll } from './spans.ts';
import { activeCpuUs, releaseSlot, type SlotRecord, state } from './slots.ts';

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

// Does:  Reads the CPU end stamp of a request whose spans carry CPU; -1 for any other request.
const cpuStamp = (record: SlotRecord): number => (record.step && record.cpu ? activeCpuUs(record) : -1);

function finish(record: SlotRecord, status: Counter, t: number, cpu: number): void {
  const incl = t - record.start;
  record.endAt = t;
  if (record.step) {
    closeAll(record, t, cpu);
    recordSpan(totalSeries, incl, incl - record.rootChild, cpu, false, true);
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
  const cpu = cpuStamp(record);
  // Why: Both end stamps come before the egress check, so no span is charged the recorder's own check.
  checkWrite(record, status, headers, payload);
  finish(record, statusCounter(status), t, cpu);
}

export function finishDestroyed(): void {
  const record = openRecord('destroyed');
  if (record !== null) {
    const t = nowNs();
    finish(record, destroyedCount, t, cpuStamp(record));
  }
}
