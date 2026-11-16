// Does:  Declares the shapes the lifecycle shares: the handler's request and reply, hook chains and route runtime.
// Holds: Route runtimes and hook chains are frozen at listen; a request changes only waiting queues and notices.

import type { BlockList } from 'node:net';
import type { OutgoingCookie, RouteDefinition, RouteInfo } from '../contract/types.ts';
import type { CorsRoute } from '../cors/grant.ts';
import type { CsrfRoute } from '../csrf/check.ts';
import type { GateInput, GateRequest } from '../gate/types.ts';
import type { PartSchemas, ServerLog } from '../log/shapes.ts';
import type { Classified, Logger, RequestPart } from '../log/types.ts';
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
import type { DeadlineQueue, Deadlines } from './deadline.ts';

export interface RuntimeRequest {
  readonly route: RouteInfo;
  readonly params: unknown;
  readonly query: unknown;
  readonly headers: unknown;
  readonly cookies: unknown;
  readonly body: unknown;
  readonly signal: AbortSignal;
  readonly log: Logger;
  readonly requestId: string;
  readonly classified: (part: RequestPart, key?: string) => Classified;
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

// Does:  A route's gate steps as read once at listen; each call's answer is untrusted until the lifecycle reads it.
export interface RouteGateRuntime {
  readonly cookie: boolean;
  readonly identify: (request: GateRequest) => unknown;
  readonly authorize: ((principal: unknown, input: GateInput, request: GateRequest) => unknown) | null;
  readonly release: ((grant: unknown) => unknown) | null;
}

export interface RouteRuntime {
  readonly info: RouteInfo;
  readonly definition: RouteDefinition;
  readonly handler: RuntimeHandler;
  readonly gate: RouteGateRuntime | null;
  readonly gated: boolean;
  readonly validators: RequestValidators;
  readonly serializers: ResponseSerializers;
  readonly bodyLimit: number;
  readonly readsBody: boolean;
  readonly timeoutMs: number;
  readonly redirectOrigins: readonly string[];
  readonly cors: CorsRoute | null;
  readonly csrf: CsrfRoute | null;
  readonly waiting: DeadlineQueue;
  readonly hooks: HookChains;
  readonly errorHandlers: readonly ErrorHandler[];
  readonly scopeName: string;
  readonly partSchemas: PartSchemas;
}

export interface EngineRuntime {
  readonly router: Router<RouteRuntime>;
  readonly maxParamLength: number;
  readonly errorSerializer: Serializer;
  readonly isClosing: () => boolean;
  readonly deadlines: Deadlines;
  readonly trustProxy: BlockList | null;
  readonly securityHeaders: boolean;
  readonly preflight: boolean;
  readonly notices: Notices;
  readonly log: ServerLog;
}

// Does:  The operator notices a server writes once in its life, each marked here once written.
export interface Notices {
  publicOrigin: boolean;
}
