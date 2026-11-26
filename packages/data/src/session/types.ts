// Does:  Declares the session both engines implement, its result, and the engine that opens sessions.
// Holds: Every member that can fail rejects with a DataError, and closed resolves once and never rejects.

import type { TransactionOptions } from '../database/types.ts';
import type { PlaceholderStyle } from '../sql/render.ts';
import type { Parameter } from '../sql/types.ts';

export interface SessionResult {
  readonly command: string;
  readonly rowCount: number | null;
  readonly columns: readonly string[];
  readonly rows: readonly (readonly unknown[])[];
}

export interface Session {
  readonly status: 'idle' | 'transaction' | 'failed' | 'closed';
  readonly reusable: boolean;
  readonly closed: Promise<void>;
  run(text: string, parameters: readonly Parameter[], signal: AbortSignal): Promise<SessionResult>;
  script(text: string, signal: AbortSignal): Promise<void>;
  begin(options: TransactionOptions, signal: AbortSignal): Promise<void>;
  commit(signal: AbortSignal): Promise<'committed' | 'rolled-back'>;
  rollback(signal: AbortSignal): Promise<void>;
  restore(): boolean;
  end(): void;
  destroy(): void;
}

export interface Engine<S extends Session> {
  readonly name: 'postgres' | 'sqlite';
  readonly style: PlaceholderStyle;
  readonly maxSessions: number;
  readonly lifetimeMs: number | null;
  open(signal: AbortSignal): Promise<S>;
}
