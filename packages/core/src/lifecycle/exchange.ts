// Does:  Declares the per-request state every lifecycle stage reads and advances.
// Holds: state leaves 'running' once, for one of the three final states, and never returns: one request, one response.

import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Slot, Token } from '#diag';
import type { CookieEntries } from '../cookie/parse.ts';
import type { CorsGrant } from '../cors/grant.ts';
import type { GateRequest } from '../gate/types.ts';
import type { RequestErrorReason } from '../log/events.ts';
import type { RequestLog } from '../log/shapes.ts';
import type { Logger } from '../log/types.ts';
import type { RouteParams } from '../router/types.ts';
import type { RawCookies } from '../server/types.ts';
import type { DeadlineQueue } from './deadline.ts';
import type { FaultDetail } from './engine-fault.ts';
import type { EngineRuntime, RouteRuntime } from './types.ts';

// Does:  A request's failure as the engine classified it when it happened, with the value its record may read.
export interface Failure {
  readonly reason: RequestErrorReason;
  readonly value: unknown;
  readonly detail: FaultDetail | null;
}

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
  readonly cors: CorsGrant | null;
  readonly log: RequestLog;
  logger: Logger | null;
  stage: Token;
  child: Token;
  state: ExchangeState;
  closeConnection: boolean;
  lateSendError: Error | null;
  failure: Failure | null;
  waiting: DeadlineQueue | null;
  waitingBefore: Exchange | null;
  waitingAfter: Exchange | null;
  cancelRead: (() => void) | null;
  deadline: number;
  abort: AbortController | null;
  signal: AbortSignal | null;
  clientAddress: string | null;
  cookieEntries: CookieEntries | null;
  rawCookies: RawCookies | null;
  pendingCookies: Map<string, string> | null;
  gateRequest: GateRequest | null;
  principal: unknown;
  grant: unknown;
  release: ((grant: unknown) => unknown) | null;
}
