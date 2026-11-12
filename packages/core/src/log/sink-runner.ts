// Does:  Calls one server's sink with a frozen array of finished lines and reports when that call settles.
// Holds: At most one sink call per server is outstanding, and each call settles exactly once, never by a timeout.

import type { LogSink } from './types.ts';

export interface SinkRunner {
  busy(): boolean;
  // Does:  The age of the outstanding call in ms; 0 when none.
  pendingMs(): number;
  // Does:  Calls the sink with the batch when not busy; settled gets false for a throw or a rejection.
  call(lines: string[], settled: (ok: boolean) => void): void;
}

export function createSinkRunner(sink: LogSink): SinkRunner {
  let startedAt: number | null = null;

  return {
    busy: () => startedAt !== null,
    pendingMs: () => (startedAt === null ? 0 : performance.now() - startedAt),
    call(lines, settled) {
      startedAt = performance.now();
      const batch: readonly string[] = Object.freeze(lines);
      // Why: The executor turns a synchronous throw into a rejection, and resolve adopts any thenable the sink returns.
      new Promise<void>((resolve) => resolve(sink(batch))).then(
        () => {
          startedAt = null;
          settled(true);
        },
        () => {
          startedAt = null;
          settled(false);
        },
      );
    },
  };
}
