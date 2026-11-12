// Does:  Admits a bounded number of records per event and route in fixed windows and reports the exact count refused.
// Holds: Route keys are fixed at ready, an unlisted route counts as no route, and every window timer is unreferenced.

import { count } from '#diag';
import { WINDOW_MS, WINDOW_RECORDS } from './limits.ts';
import type { SuppressedEvent, Suppression } from './shapes.ts';

interface Window {
  readonly event: SuppressedEvent;
  readonly route: string | null;
  admitted: number;
  refused: number;
  timer: ReturnType<typeof setTimeout> | null;
}

type RouteWindows = Map<SuppressedEvent, Window>;

// Does:  Builds a server's suppression; onSummary gets each window that refused a record, when it expires or at flush.
export function createSuppression(
  onSummary: (event: SuppressedEvent, route: string | null, count: number) => void,
): Suppression {
  const noRoute: RouteWindows = new Map();
  let routes: ReadonlyMap<string, RouteWindows> = new Map();
  let fixed = false;
  let total = 0;

  // Does:  Closes an open window and reports it when it refused any record.
  function close(window: Window): void {
    const refused = window.refused;
    window.timer = null;
    window.admitted = 0;
    window.refused = 0;
    if (refused > 0) {
      onSummary(window.event, window.route, refused);
    }
  }

  function windowOf(event: SuppressedEvent, route: string | null): Window {
    const table = (route === null ? undefined : routes.get(route)) ?? noRoute;
    const known = table.get(event);
    if (known !== undefined) {
      return known;
    }
    const window: Window = { event, route: table === noRoute ? null : route, admitted: 0, refused: 0, timer: null };
    table.set(event, window);
    return window;
  }

  return {
    ready(templates) {
      // Why: The key set is fixed once, at listen; a later call would let the route keys grow.
      if (fixed) {
        return;
      }
      fixed = true;
      routes = new Map(templates.map((template) => [template, new Map()]));
    },
    admit(event, route) {
      const window = windowOf(event, route);
      if (window.timer === null) {
        // Why: A window is fixed from its key's first record, so a steady flood still yields one summary per window.
        window.timer = setTimeout(close, WINDOW_MS, window);
        window.timer.unref();
      }
      if (window.admitted < WINDOW_RECORDS) {
        window.admitted += 1;
        return true;
      }
      window.refused += 1;
      total += 1;
      count('log.suppressed', event);
      return false;
    },
    suppressed() {
      return total;
    },
    flush() {
      for (const table of [noRoute, ...routes.values()]) {
        for (const window of table.values()) {
          if (window.timer !== null) {
            clearTimeout(window.timer);
            close(window);
          }
        }
      }
    },
  };
}
