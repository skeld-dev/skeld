// Does:  Reads the clocks the recorder uses: monotonic nanoseconds and the thread's CPU time.
// Holds: Time comes from the monotonic clock, never the wall clock, so a span is never negative.

import { performance } from 'node:perf_hooks';

export const nowNs = (): number => Math.round(performance.now() * 1e6);

export function threadCpuUs(): number {
  const usage = process.threadCpuUsage();
  return usage.user + usage.system;
}

export const toMicros = (ns: number): number => Math.round(ns) / 1000;

export const toMillis = (ns: number): number => Math.round(ns / 1000) / 1000;
