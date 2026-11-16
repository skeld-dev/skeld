// Does:  Holds the small helpers every V05 and V06 proof shares: record narrowing, waiting and header reading.
// Holds: Nothing here touches the product; each helper is pure or waits on a timer.

import { setTimeout as pause } from 'node:timers/promises';

export const sleep = pause;

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function parseRecord(text: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(text);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export async function until(done: () => boolean, ms: number): Promise<boolean> {
  const stop = Date.now() + ms;
  while (Date.now() < stop) {
    if (done()) {
      return true;
    }
    // biome-ignore lint/performance/noAwaitInLoops: a poll waits for the condition one step at a time
    await pause(10);
  }
  return done();
}

// Does:  Waits until the log sink has stopped receiving lines, so a count taken afterwards is final.
export async function settleLog(lines: readonly string[]): Promise<void> {
  let seen = -1;
  while (seen !== lines.length) {
    seen = lines.length;
    // biome-ignore lint/performance/noAwaitInLoops: each wait compares against the previous count
    await pause(60);
  }
}
