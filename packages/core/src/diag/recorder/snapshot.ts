// Does:  Writes one snapshot line per interval: spans, counts, limits, events and gauges.
// Holds: Taking a snapshot resets the per-window figures and keeps the run-wide ones.

import { nowNs, toMicros } from './clock.ts';
import { countTotals } from './counts.ts';
import { listenerGauge } from './contain.ts';
import { failingNames, takeEventFigures, takeJournal } from './events.ts';
import { appendJournal, appendSnapshot } from './files.ts';
import { totalSeries, writeGauge } from './finish.ts';
import { settleFloor } from './floor.ts';
import { bootLedger } from './ledger.ts';
import { takeLimitFigures } from './limits.ts';
import { takeProcessFigures } from './process.ts';
import { routeList } from './routes.ts';
import { recordSpan, standaloneSeries, takeSampledRequests, takeSpanFigures, takeSyncSelfNs } from './series.ts';
import { state } from './slots.ts';
import { gaugeState } from './spans.ts';

export interface BootFigures {
  readyMs: number | null;
  startedAt: number;
}

const flushSeries = standaloneSeries('diag.flush', false);
const windowState = { last: Date.now() };

export const bootFigures: BootFigures = { readyMs: null, startedAt: Date.now() };

function takeGauges(socketsOpen: number): Record<string, unknown> {
  const gauges: Record<string, unknown> = {};
  for (const route of routeList) {
    if (route.slowestNs > 0) {
      gauges[`req.slowest{${route.name}}`] = toMicros(route.slowestNs);
      route.slowestNs = 0;
    }
  }
  gauges['req.respond.backpressure'] = writeGauge.backpressure;
  writeGauge.backpressure = 0;
  gauges['contain.listeners'] = {
    server_request: listenerGauge.server_request,
    sockets_open: socketsOpen,
    inflight: state.inflight,
    socket_listeners_peak: listenerGauge.socket_listeners_peak,
  };
  gauges['boot.ready_ms'] = bootFigures.readyMs;
  gauges['boot.routes'] = routeList.length;
  gauges['boot.stages'] = bootLedger();
  gauges['close.inflight'] = gaugeState.closeInflight;
  return gauges;
}

export function writeSnapshot(final: boolean): void {
  const started = nowNs();
  const t = Date.now();
  const windowMs = t - windowState.last;
  windowState.last = t;
  const requests = totalSeries.n;
  const socketsOpen = settleFloor(state.begun);
  const processFigures = takeProcessFigures(takeSyncSelfNs());
  const line = JSON.stringify({
    t,
    at: t - bootFigures.startedAt,
    window_ms: windowMs,
    final,
    requests,
    sampled: takeSampledRequests(),
    process: processFigures,
    spans: takeSpanFigures(),
    counts: countTotals(),
    limits: takeLimitFigures(),
    events: takeEventFigures(),
    gauges: takeGauges(socketsOpen),
    failing: failingNames(),
  });
  appendSnapshot(line);
  const journal = takeJournal();
  if (journal.length > 0) {
    appendJournal(journal);
  }
  const elapsed = nowNs() - started;
  recordSpan(flushSeries, elapsed, elapsed, -1, false, true);
}
