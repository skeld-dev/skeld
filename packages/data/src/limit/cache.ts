// Does:  Remembers refused keys until their window ends, so a refused address is answered without a statement.
// Holds: The cache never holds more than 10,000 keys; at the bound the oldest insertion leaves first.

import { count, limit } from '#diag';

export interface RefusedCache {
  // Does:  Returns the milliseconds left for a refused key, or null when the key is not refused or its deadline passed.
  wait(key: Uint8Array): number | null;
  remember(key: Uint8Array, waitMs: number): void;
}

// Why: A fixed bound keeps memory flat under a flood of distinct refused addresses.
const MAX_KEYS = 10_000;

function textOf(key: Uint8Array): string {
  return Buffer.from(key.buffer, key.byteOffset, key.byteLength).toString('base64');
}

export function createRefusedCache(): RefusedCache {
  // Why: A Map iterates in insertion order, so its first key is the oldest; deadlines are on performance.now().
  const deadlines = new Map<string, number>();
  return {
    wait(key) {
      const text = textOf(key);
      const deadline = deadlines.get(text);
      if (deadline === undefined) {
        return null;
      }
      const left = deadline - performance.now();
      if (left <= 0) {
        deadlines.delete(text);
        return null;
      }
      count('data.limit.cache_hit', 'hit');
      return left;
    },
    remember(key, waitMs) {
      const text = textOf(key);
      deadlines.delete(text);
      if (deadlines.size >= MAX_KEYS) {
        const oldest = deadlines.keys().next();
        if (oldest.done !== true) {
          deadlines.delete(oldest.value);
        }
      }
      deadlines.set(text, performance.now() + waitMs);
      limit('data.limit.cache', deadlines.size, MAX_KEYS);
    },
  };
}
