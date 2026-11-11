// Does:  Declares the per-request state every lifecycle stage reads and advances.
// Holds: state leaves 'running' once, for 'sent-by-hook' or 'written', and never returns: one request, one response.

import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Slot, Token } from '#diag';
import type { RouteParams } from '../router/types.ts';
import type { EngineRuntime, RouteRuntime } from './types.ts';

type ExchangeState = 'running' | 'sent-by-hook' | 'written';

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
  state: ExchangeState;
  closeConnection: boolean;
  lateSendError: Error | null;
}
