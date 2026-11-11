// Does:  Tracks the requests waiting on application code and expires those past their route's time limit.
// Holds: A request is tracked only while it waits and its connection is open, and expires at most once.

import type { Exchange } from './exchange.ts';

// Why: A deadline then fires at most a tenth of its limit late, as Node's own request-timeout check does.
const CHECKS_PER_LIMIT = 10;
// Why: A short route limit must not wake the whole server every millisecond while any request waits.
const MIN_PERIOD_MS = 10;

function release(exchange: Exchange): void {
  const { waiting } = exchange;
  if (waiting !== null) {
    waiting.delete(exchange);
    exchange.waiting = null;
  }
}

// Does:  Ends a running request in its final state and stops tracking it.
export function settle(exchange: Exchange, state: 'sent-by-hook' | 'written'): void {
  exchange.state = state;
  release(exchange);
}

// Does:  Returns the signal application code holds: aborted when the client leaves or the request times out.
// Holds: Built on first read only; every reader of one request gets the same signal.
export function signalOf(exchange: Exchange): AbortSignal {
  if (exchange.signal !== null) {
    return exchange.signal;
  }
  const controller = new AbortController();
  const signal = AbortSignal.any([exchange.req.signal, controller.signal]);
  exchange.abort = controller;
  exchange.signal = signal;
  if (exchange.state === 'timed-out') {
    controller.abort(timeoutReason());
  }
  return signal;
}

export function timeoutReason(): DOMException {
  return new DOMException('The request timed out', 'TimeoutError');
}

export interface Deadlines {
  // Does:  Returns the queue of one time limit, at boot; the check period follows the shortest limit.
  queue(limitMs: number): Set<Exchange>;
  // Does:  Starts the deadline of a request that now waits on a promise or on its body; a no-op once started.
  wait(exchange: Exchange): void;
  // Does:  Stops the check for good and forgets every waiting request; called once every connection has closed.
  stop(): void;
}

// Does:  Builds one queue per distinct time limit and one shared check that expires the overdue requests.
// Holds: Each queue is in deadline order, so a check stops at its first request not yet due.
export function createDeadlines(expire: (exchange: Exchange) => void): Deadlines {
  const queues = new Map<number, Set<Exchange>>();
  let periodMs = Number.POSITIVE_INFINITY;
  let timer: ReturnType<typeof setInterval> | null = null;
  let stopped = false;

  function pause(): void {
    if (timer !== null) {
      clearInterval(timer);
      timer = null;
    }
  }

  function check(): void {
    const now = performance.now();
    let left = 0;
    for (const queue of queues.values()) {
      for (const exchange of queue) {
        if (exchange.deadline > now) {
          break;
        }
        queue.delete(exchange);
        exchange.waiting = null;
        expire(exchange);
      }
      left += queue.size;
    }
    // Why: An idle server keeps no timer; the next request that waits starts it again.
    if (left === 0) {
      pause();
    }
  }

  return {
    queue(limitMs) {
      const found = queues.get(limitMs);
      if (found !== undefined) {
        return found;
      }
      const created = new Set<Exchange>();
      queues.set(limitMs, created);
      periodMs = Math.min(periodMs, Math.max(MIN_PERIOD_MS, Math.floor(limitMs / CHECKS_PER_LIMIT)));
      return created;
    },
    wait(exchange) {
      const { socket } = exchange.req;
      if (stopped || exchange.waiting !== null || exchange.state !== 'running' || socket.destroyed) {
        return;
      }
      const { timeoutMs, waiting } = exchange.route;
      // Why: Reading the peer address now caches it on the socket, so it is still known after the socket closes.
      void socket.remoteAddress;
      exchange.deadline = performance.now() + timeoutMs;
      exchange.waiting = waiting;
      waiting.add(exchange);
      // Why: A client that left has no one to answer; its request must not stay reachable until its deadline.
      exchange.res.on('close', () => release(exchange));
      if (timer === null) {
        timer = setInterval(check, periodMs);
        timer.unref();
      }
    },
    stop() {
      stopped = true;
      pause();
      for (const queue of queues.values()) {
        for (const exchange of queue) {
          exchange.waiting = null;
        }
        queue.clear();
      }
    },
  };
}
