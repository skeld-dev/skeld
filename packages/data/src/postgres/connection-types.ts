// Does:  Declares a PostgreSQL connection: a session with its protocol version and a simple-query cycle.
// Holds: The shape names no connection target, so the handle and pool never depend on how a target is made.

import type { Session, SessionResult } from '../session/types.ts';

export interface PostgresConnection extends Session {
  readonly protocol: '3.2' | '3.0';
  simple(text: string, signal: AbortSignal): Promise<SessionResult>;
}
