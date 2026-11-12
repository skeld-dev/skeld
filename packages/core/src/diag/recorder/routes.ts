// Does:  Keeps one record per route: its request counter, slowest request and response checks.
// Holds: Each declared route identity keeps its own validators and counters, even when names repeat.

import type { RouteInfo } from '../../contract/types.ts';
import type { Check, Schema } from '../../schema/types.ts';
import { type Counter, keyedCounter } from './counts.ts';

export interface ResponseCheck {
  readonly schema: Schema;
  readonly check: Check;
}

export interface RouteRecord {
  readonly id: string;
  readonly name: string;
  readonly method: string;
  readonly path: string;
  readonly count: Counter;
  readonly validators: Map<number, ResponseCheck | null>;
  slowestNs: number;
}

const byInfo = new WeakMap<RouteInfo, RouteRecord>();

// Why: Consecutive requests usually hit the same route, so the last record is tried before the map.
const lastHit: { info: RouteInfo | null; record: RouteRecord | null } = { info: null, record: null };

export const routeList: RouteRecord[] = [];

export function routeRecord(info: RouteInfo): RouteRecord {
  if (info === lastHit.info && lastHit.record !== null) {
    return lastHit.record;
  }
  const found = byInfo.get(info);
  if (found !== undefined) {
    lastHit.info = info;
    lastHit.record = found;
    return found;
  }
  const id = `r${routeList.length + 1}`;
  const created: RouteRecord = {
    id,
    name: info.name,
    method: info.method,
    path: info.path,
    count: keyedCounter('req.count', id),
    validators: new Map(),
    slowestNs: 0,
  };
  byInfo.set(info, created);
  routeList.push(created);
  return created;
}
