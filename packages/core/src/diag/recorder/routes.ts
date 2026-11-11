// Does:  Keeps one record per route: its request counter, slowest request and response checks.
// Holds: A route name maps to one record for the life of the process.

import type { RouteInfo } from '../../contract/types.ts';
import type { Check, Schema } from '../../schema/types.ts';
import { type Counter, keyedCounter } from './counts.ts';

export interface ResponseCheck {
  readonly schema: Schema;
  readonly check: Check;
}

export interface RouteRecord {
  readonly name: string;
  readonly method: string;
  readonly path: string;
  readonly count: Counter;
  readonly validators: Map<number, ResponseCheck | null>;
  slowestNs: number;
}

const byName = new Map<string, RouteRecord>();

// Why: Consecutive requests usually hit the same route, so the last record is tried before the map.
const lastHit: { info: RouteInfo | null; record: RouteRecord | null } = { info: null, record: null };

export const routeList: RouteRecord[] = [];

export function routeRecord(info: RouteInfo): RouteRecord {
  if (info === lastHit.info && lastHit.record !== null) {
    return lastHit.record;
  }
  const found = byName.get(info.name);
  if (found !== undefined) {
    lastHit.info = info;
    lastHit.record = found;
    return found;
  }
  const created: RouteRecord = {
    name: info.name,
    method: info.method,
    path: info.path,
    count: keyedCounter('req.count', info.name),
    validators: new Map(),
    slowestNs: 0,
  };
  byName.set(info.name, created);
  routeList.push(created);
  return created;
}
