import type { RouteDefinition, RouteInfo } from '../contract/types.ts';
import type { Router } from '../router/types.ts';
import type { RequestValidators, ResponseSerializers, Serializer } from '../schema/types.ts';
import type {
  ErrorHandler,
  OnErrorHook,
  OnRequestHook,
  OnResponseHook,
  OnSendHook,
  OutgoingHeaders,
  PreHandlerHook,
} from '../server/types.ts';

interface RuntimeRequest {
  readonly route: RouteInfo;
  readonly params: unknown;
  readonly query: unknown;
  readonly headers: unknown;
  readonly body: unknown;
  readonly signal: AbortSignal;
}

export interface RuntimeReply {
  readonly status: number;
  readonly body?: unknown;
  readonly headers?: OutgoingHeaders;
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
}
