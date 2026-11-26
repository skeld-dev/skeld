// Does:  Declares the pool of sessions and the lease a caller holds one session through.
// Holds: A lease is released exactly once, with one of three verdicts.

import type { PoolStats } from '../database/types.ts';
import type { Session } from '../session/types.ts';

export interface Lease<S extends Session> {
  readonly session: S;
  readonly signal: AbortSignal;
  release(verdict: 'return' | 'restore' | 'destroy'): void;
}

export interface Pool<S extends Session> {
  open(signal: AbortSignal): Promise<void>;
  acquire(signal: AbortSignal): Promise<Lease<S>>;
  stats(): PoolStats;
  close(closeTimeoutMs: number): Promise<void>;
}
