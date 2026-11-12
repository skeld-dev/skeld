// Does:  Releases registered plugin resources in reverse acquisition order under individual deadlines.
// Holds: Every callback is removed before invocation and all failures are collected without skipping later cleanup.

import { end, start } from '#diag';

interface Disposal {
  readonly name: string;
  readonly callback: () => void | Promise<void>;
}

export interface DisposalState {
  readonly abort: AbortController;
  readonly callbacks: Disposal[];
}

export async function dispose(state: DisposalState, timeoutMs: number): Promise<unknown[]> {
  const failures: unknown[] = [];
  for (let entry = state.callbacks.pop(); entry !== undefined; entry = state.callbacks.pop()) {
    const { name, callback } = entry;
    const span = start('close.plugin', name);
    const expiry = Promise.withResolvers<void>();
    const timer = setTimeout(
      () => expiry.reject(new Error(`Plugin ${name} disposal exceeded ${timeoutMs} ms`)),
      timeoutMs,
    );
    try {
      // biome-ignore lint/performance/noAwaitInLoops: resources unwind sequentially in reverse acquisition order
      await Promise.race([Promise.try(callback), expiry.promise]);
    } catch (cause) {
      failures.push(new Error(`Plugin ${name} disposal failed`, { cause }));
    } finally {
      clearTimeout(timer);
      end(span);
    }
  }
  return failures;
}
