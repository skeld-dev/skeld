// Does:  Runs password computations in the process's two slots, with at most 64 callers waiting up to 5,000 ms each.
// Holds: At most two computations run at once; a slot is freed only when its computation settles, never by its caller.

import { limit } from '#diag';

// Why: Two of libuv's four threads stay free for the rest of the process (file, DNS and other crypto work).
const SLOTS = 2;
const MAX_WAITING = 64;
const WAIT_MS = 5000;

interface Waiter {
  readonly admit: () => void;
}

// Does:  Marks a caller refused for lack of a slot: the queue was full, its wait passed 5,000 ms or its signal aborted.
export const BUSY = Symbol('busy');

let running = 0;
const waiting: Waiter[] = [];

function release(): void {
  const next = waiting.shift();
  if (next === undefined) {
    running -= 1;
    return;
  }
  next.admit();
}

// Does:  Resolves true once a slot is the caller's, false when the queue is full, the wait ends or the signal aborts.
// Holds: A true answer counts one running computation, which the caller ends with exactly one release.
function acquire(signal: AbortSignal | undefined): Promise<boolean> | boolean {
  if (signal?.aborted === true) {
    return false;
  }
  if (running < SLOTS && waiting.length === 0) {
    running += 1;
    return true;
  }
  limit('auth.hash.waiting', waiting.length + 1, MAX_WAITING);
  if (waiting.length >= MAX_WAITING) {
    return false;
  }
  return new Promise<boolean>((resolve) => {
    const leave = (): void => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', leave);
      const at = waiting.indexOf(waiter);
      if (at !== -1) {
        waiting.splice(at, 1);
        resolve(false);
      }
    };
    const waiter: Waiter = {
      admit: () => {
        clearTimeout(timer);
        signal?.removeEventListener('abort', leave);
        resolve(true);
      },
    };
    const timer = setTimeout(leave, WAIT_MS);
    signal?.addEventListener('abort', leave, { once: true });
    waiting.push(waiter);
  });
}

// Does:  Runs work in a slot; answers BUSY when no slot came, or when the signal aborts while the work still runs.
// Holds: The slot taken for work is released once, when work settles, whatever the caller was answered.
export async function inSlot<T>(signal: AbortSignal | undefined, work: () => Promise<T>): Promise<T | typeof BUSY> {
  if (!(await acquire(signal))) {
    return BUSY;
  }
  let computing: Promise<T>;
  try {
    computing = work();
  } catch (error) {
    release();
    throw error;
  }
  const settled = computing.finally(release);
  if (signal === undefined) {
    return settled;
  }
  return new Promise<T | typeof BUSY>((resolve, reject) => {
    const abandon = (): void => resolve(BUSY);
    // Why: The handlers attach before the abort check, so an abandoned computation's result and rejection are dropped.
    settled.then(resolve, reject).finally(() => signal.removeEventListener('abort', abandon));
    if (signal.aborted) {
      abandon();
      return;
    }
    signal.addEventListener('abort', abandon, { once: true });
  });
}
