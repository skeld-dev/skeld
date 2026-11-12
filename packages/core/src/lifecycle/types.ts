// Does:  Declares the shapes the lifecycle shares: the handler's request and reply, hook chains and route runtime.
// Holds: A route's runtime and hook chains are frozen at listen; a request changes only the route's waiting queue.

import type { BlockList } from 'node:net';
import type { OutgoingCookie, RouteDefinition, RouteInfo } from '../contract/types.ts';
import type { Router } from '../router/types.ts';
import type { RequestValidators, ResponseSerializers, Serializer } from '../compile/types.ts';
import type {
  ErrorHandler,
  OnErrorHook,
  OnRequestHook,
  OnResponseHook,
  OnSendHook,
  OutgoingHeaders,
  PreHandlerHook,
} from '../server/types.ts';
import type { Deadlines } from './deadline.ts';
import type { Exchange } from './exchange.ts';

export interface RuntimeRequest {
  readonly route: RouteInfo;
  readonly params: unknown;
  readonly query: unknown;
  readonly headers: unknown;
  readonly cookies: unknown;
  readonly body: unknown;
  readonly signal: AbortSignal;
}

export interface RuntimeReply {
  readonly status: number;
  readonly body?: unknown;
  readonly headers?: OutgoingHeaders;
  readonly cookies?: readonly OutgoingCookie[];
}

export type RuntimeHandler = (request: RuntimeRequest) => RuntimeReply | Promise<RuntimeReply>;

export interface HookChains {
  readonly onRequest: readonly OnRequestHook[];
  readonly preHandler: readonly PreHandlerHook[];
  readonly onSend: readonly OnSendHook[];
  readonly onResponse: readonly OnResponseHook[];
  readonly onError: readonly OnErrorHook[];
}

export interface RouteRuntime {
  readonly info: RouteInfo;
  readonly definition: RouteDefinition;
  readonly handler: RuntimeHandler;
  readonly validators: RequestValidators;
  readonly serializers: ResponseSerializers;
  readonly bodyLimit: number;
  readonly readsBody: boolean;
  readonly timeoutMs: number;
  readonly redirectOrigins: readonly string[];
  readonly waiting: Set<Exchange>;
  readonly hooks: HookChains;
  readonly errorHandlers: readonly ErrorHandler[];
  readonly hasOnError: boolean;
  readonly scopeName: string;
}

export interface EngineRuntime {
  readonly router: Router<RouteRuntime>;
  readonly maxParamLength: number;
  readonly errorSerializer: Serializer;
  readonly isClosing: () => boolean;
  readonly deadlines: Deadlines;
  readonly trustProxy: BlockList | null;
  readonly securityHeaders: boolean;
}
