// Does:  Reads the clocks the recorder uses: monotonic nanoseconds and the thread's CPU time.
// Holds: Time comes from the monotonic clock, never the wall clock, so a span is never negative.

import { performance } from 'node:perf_hooks';

export const nowNs = (): number => Math.round(performance.now() * 1e6);

export function threadCpuUs(): number {
  // Why: Read alone, the thread's usage moves in tick-sized steps on Linux; a process read first brings it up to date.
  process.cpuUsage();
  const usage = process.threadCpuUsage();
  return usage.user + usage.system;
}

// Why: About 20 ms of wall time or 64 observed changes bound the probe, so it costs little at open on any host.
const STEP_PROBE_NS = 20_000_000;
const STEP_PROBE_CHANGES = 64;

// Does:  Measures the median size of the thread CPU clock's changes, in microseconds; null when it never moved.
export function measureCpuStep(): number | null {
  const until = nowNs() + STEP_PROBE_NS;
  const steps: number[] = [];
  let last = threadCpuUs();
  while (steps.length < STEP_PROBE_CHANGES && nowNs() < until) {
    const now = threadCpuUs();
    if (now !== last) {
      steps.push(now - last);
      last = now;
    }
  }
  steps.sort((a, b) => a - b);
  return steps[Math.floor(steps.length / 2)] ?? null;
}

export const toMicros = (ns: number): number => Math.round(ns) / 1000;

export const toMillis = (ns: number): number => Math.round(ns / 1000) / 1000;
