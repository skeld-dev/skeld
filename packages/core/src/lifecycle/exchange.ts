import type { IncomingMessage, ServerResponse } from 'node:http';
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
  state: ExchangeState;
  closeConnection: boolean;
  lateSendError: Error | null;
}
