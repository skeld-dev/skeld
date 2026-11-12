// Does:  Declares the per-request state every lifecycle stage reads and advances.
// Holds: state leaves 'running' once, for one of the three final states, and never returns: one request, one response.

import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Slot, Token } from '#diag';
import type { CookieEntries } from '../cookie/parse.ts';
import type { RouteParams } from '../router/types.ts';
import type { RawCookies } from '../server/types.ts';
import type { EngineRuntime, RouteRuntime } from './types.ts';

type ExchangeState = 'running' | 'sent-by-hook' | 'written' | 'timed-out';

export interface Exchange {
  readonly runtime: EngineRuntime;
  readonly route: RouteRuntime;
  readonly req: IncomingMessage;
  readonly res: ServerResponse;
  readonly method: string;
  readonly path: string;
  readonly query: string;
  readonly params: RouteParams;
  readonly diag: Slot;
  stage: Token;
  child: Token;
  state: ExchangeState;
  closeConnection: boolean;
  lateSendError: Error | null;
  waiting: Set<Exchange> | null;
  cancelRead: (() => void) | null;
  deadline: number;
  abort: AbortController | null;
  signal: AbortSignal | null;
  clientAddress: string | null;
  cookieEntries: CookieEntries | null;
  rawCookies: RawCookies | null;
  pendingCookies: Map<string, string> | null;
}
