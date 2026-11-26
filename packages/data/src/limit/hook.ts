// Does:  Builds the limiter's onRequest hook: pass, a 429 written with send and retry-after, or a thrown 503.
// Holds: No record, thrown value or reply carries the client's address or its key; a refusal never runs the handler.

import { HttpError } from '@skeld/core/http-error';
import type { SecurityEvent } from '@skeld/core/gate';
import type { OnRequestHook, RequestContext } from '@skeld/core/server';
import { count, end as endSpan, start as startSpan } from '#diag';
import type { DataError } from '../data-error/data-error.ts';
import type { RefusedCache } from './cache.ts';
import { countedAddress, counterKey } from './key.ts';
import type { CheckedLimits, CheckedRule } from './rules.ts';
import { routeKey } from './rules.ts';
import { charge } from './store.ts';

export interface LimitEvents {
  readonly refused: SecurityEvent;
  readonly unavailable: SecurityEvent;
}

// Why: The engine's own body and content type for a gate's rate refusal (packages/core/src/lifecycle/gate.ts:61).
const REFUSED_BODY = JSON.stringify({ status: 429, code: 'RATE_LIMITED', message: 'Too many requests' });
const JSON_CONTENT_TYPE = 'application/json; charset=utf-8';

function refuse(context: RequestContext, events: LimitEvents, rule: CheckedRule, waitMs: number): void {
  const seconds = Math.min(Math.max(Math.ceil(waitMs / 1_000), 1), rule.windowSeconds);
  count('data.limit.outcome', 'refused');
  events.refused(context.log, { 'data.rule': rule.name });
  context.send({
    status: 429,
    headers: { 'retry-after': String(seconds), 'content-type': JSON_CONTENT_TYPE },
    payload: REFUSED_BODY,
  });
}

function unavailable(
  context: RequestContext,
  events: LimitEvents,
  rule: CheckedRule,
  reason: string,
  cause: DataError | null,
): HttpError {
  count('data.limit.outcome', 'unavailable');
  events.unavailable(context.log, { 'data.code': 'LIMIT_UNAVAILABLE', 'data.rule': rule.name, 'data.reason': reason });
  return new HttpError(503, 'LIMIT_UNAVAILABLE', 'Service unavailable', cause === null ? undefined : { cause });
}

// Does:  Returns the hook; events is read at each request, since the boot step registers them after this call.
export function limitHook(limits: CheckedLimits, cache: RefusedCache, events: () => LimitEvents): OnRequestHook {
  return async (context) => {
    const rule = limits.table[routeKey(context.route.method, context.route.path)];
    if (rule === undefined) {
      return;
    }
    const written = events();
    const counted = countedAddress(context.clientAddress);
    if (counted === null) {
      throw unavailable(context, written, rule, 'ADDRESS', null);
    }
    const key = counterKey(rule.name, counted);
    const cached = cache.wait(key);
    if (cached !== null) {
      refuse(context, written, rule, cached);
      return;
    }
    const span = startSpan('data.limit.charge');
    const outcome = await charge(limits.database, context, key, rule, limits.chargeTimeoutMs);
    endSpan(span);
    if (outcome.kind === 'aborted') {
      throw new HttpError(503, 'LIMIT_UNAVAILABLE', 'Service unavailable');
    }
    if (outcome.kind === 'failed') {
      throw unavailable(context, written, rule, outcome.reason, outcome.error);
    }
    if (outcome.count > rule.max) {
      cache.remember(key, outcome.waitMs);
      refuse(context, written, rule, outcome.waitMs);
      return;
    }
    count('data.limit.outcome', 'pass');
  };
}
