// Does:  Joins one server's queue to the process's stdout writer or to its sink, and closes it under a deadline.
// Holds: The deadline cancels nothing: a batch already handed over stays in flight and settles once, after close too.

import { createQueue } from './queue.ts';
import type { Destination, ResolvedLog } from './shapes.ts';
import { createSinkRunner } from './sink-runner.ts';
import { askTurn, pendingMs, type WriterTurn } from './stdout-writer.ts';

// Holds: Every write or sink call starts from the trigger's task or a settled operation, never on a request's stack.
export function createDestination(resolved: ResolvedLog, onRecovered: () => void): Destination {
  let closing: Promise<void> | null = null;
  // Why: Once close() was called a late settle only moves counts; a summary record would be a shutdown drop anyway.
  const queue = createQueue(flush, () => {
    if (closing === null) {
      onRecovered();
    }
  });
  const runner = resolved.sink === null ? null : createSinkRunner(resolved.sink);
  let finished: (() => void) | null = null;

  const turn: WriterTurn = {
    take() {
      const lines = queue.take();
      return lines === null ? null : `${lines.join('\n')}\n`;
    },
    settled(ok) {
      queue.settle(ok ? null : 'write_failed');
      afterSettle();
    },
  };

  function flush(): void {
    if (runner === null) {
      askTurn(turn);
      return;
    }
    if (runner.busy()) {
      return;
    }
    const lines = queue.take();
    if (lines !== null) {
      runner.call(lines, (ok) => {
        queue.settle(ok ? null : 'sink_failed');
        afterSettle();
      });
    }
  }

  function afterSettle(): void {
    if (queue.queued() > 0) {
      // Why: The writer's turn is asked again at once, in turn order; the next sink call waits for its own task.
      if (runner === null) {
        askTurn(turn);
      } else {
        queue.schedule();
      }
    } else if (finished !== null && queue.idle()) {
      finished();
    }
  }

  return {
    enqueue: (line, severityNumber) => queue.enqueue(line, severityNumber),
    counts: () => queue.counts(runner === null ? pendingMs() : runner.pendingMs()),
    close(timeoutMs) {
      if (closing !== null) {
        return closing;
      }
      queue.close();
      closing = queue.idle()
        ? Promise.resolve()
        : new Promise<void>((resolve) => {
            // Why: The one referenced logger timer: it keeps a waiting close() alive, and only for the deadline.
            const deadline = setTimeout(() => {
              finished = null;
              queue.dropQueued();
              resolve();
            }, timeoutMs);
            finished = () => {
              finished = null;
              clearTimeout(deadline);
              resolve();
            };
          });
      return closing;
    },
  };
}
