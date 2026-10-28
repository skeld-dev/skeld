import type { Static, TSchema } from 'typebox';
import type { HttpError } from '../contract/http-error.ts';
import type { ContractRoutes, Empty, RouteDefinition, RouteInfo } from '../contract/types.ts';

export interface ServerOptions {
  readonly bodyLimit?: number;
  readonly maxParamLength?: number;
  readonly pluginTimeoutMs?: number;
  readonly closeTimeoutMs?: number;
  readonly keepAliveTimeout?: number;
  readonly requestTimeout?: number;
  readonly headersTimeout?: number;
  readonly maxHeaderSize?: number;
}

export interface ResolvedServerOptions {
  readonly bodyLimit: number;
  readonly maxParamLength: number;
  readonly pluginTimeoutMs: number;
  readonly closeTimeoutMs: number;
  readonly keepAliveTimeout: number;
  readonly requestTimeout: number;
  readonly headersTimeout: number;
  readonly maxHeaderSize: number;
}

export interface RawHeaders {
  readonly [name: string]: string | readonly string[] | undefined;
}

export interface OutgoingHeaders {
  readonly [name: string]: string | number | readonly string[];
}

export interface RouteRequest<R extends RouteDefinition> {
  readonly route: RouteInfo;
  readonly params: R extends { readonly params: infer S extends TSchema } ? Static<S> : Empty;
  readonly query: R extends { readonly query: infer S extends TSchema } ? Static<S> : Empty;
  readonly headers: R extends { readonly headers: infer S extends TSchema } ? Static<S> : RawHeaders;
  readonly body: R extends { readonly body: infer S extends TSchema } ? Static<S> : undefined;
  readonly signal: AbortSignal;
}

export type RouteReply<R extends RouteDefinition> = {
  [S in keyof R['responses']]: R['responses'][S] extends TSchema
    ? { readonly status: S; readonly body: Static<R['responses'][S]>; readonly headers?: OutgoingHeaders }
    : { readonly status: S; readonly headers?: OutgoingHeaders };
}[keyof R['responses']];

export type Handler<C extends ContractRoutes, K extends keyof C> = (
  request: RouteRequest<C[K]>,
) => RouteReply<C[K]> | Promise<RouteReply<C[K]>>;

export type Handlers<C extends ContractRoutes> = { readonly [K in keyof C]: Handler<C, K> };

export interface RoutesOptions<C extends ContractRoutes> {
  readonly bodyLimits?: { readonly [K in keyof C]?: number };
}

export interface RawReply {
  readonly status: number;
  readonly headers?: OutgoingHeaders;
  readonly payload?: string | Uint8Array;
}

export interface RequestContext {
  readonly route: RouteInfo;
  readonly method: string;
  readonly path: string;
  readonly headers: RawHeaders;
  readonly signal: AbortSignal;
  setHeader(name: string, value: string | number | readonly string[]): void;
  send(reply: RawReply): void;
}

export interface ValidatedContext extends RequestContext {
  readonly params: unknown;
  readonly query: unknown;
  readonly body: unknown;
}

export interface ResponseContext {
  readonly route: RouteInfo;
  readonly method: string;
  readonly path: string;
  readonly headers: RawHeaders;
  readonly signal: AbortSignal;
  readonly status: number;
  setHeader(name: string, value: string | number | readonly string[]): void;
}

export interface CompletedContext {
  readonly route: RouteInfo;
  readonly method: string;
  readonly path: string;
  readonly status: number;
  readonly completed: boolean;
}

export interface ErrorContext {
  readonly route: RouteInfo;
  readonly method: string;
  readonly path: string;
  readonly headers: RawHeaders;
  readonly signal: AbortSignal;
}

export type OnRequestHook = (context: RequestContext) => void | Promise<void>;
export type PreHandlerHook = (context: ValidatedContext) => void | Promise<void>;
export type OnSendHook = (
  context: ResponseContext,
  payload: string | Uint8Array,
) => string | Uint8Array | undefined | Promise<string | Uint8Array | undefined>;
export type OnResponseHook = (context: CompletedContext) => void | Promise<void>;
export type OnErrorHook = (context: ErrorContext, error: unknown) => void | Promise<void>;

export type ErrorHandler = (error: unknown, context: ErrorContext) => HttpError | Promise<HttpError>;

export type HookName = 'onRequest' | 'preHandler' | 'onSend' | 'onResponse' | 'onError';

export interface Scope {
  routes<C extends ContractRoutes>(
    contract: C,
    handlers: NoInfer<Handlers<C>>,
    options?: NoInfer<RoutesOptions<C>>,
  ): void;
  addHook(name: 'onRequest', hook: OnRequestHook): void;
  addHook(name: 'preHandler', hook: PreHandlerHook): void;
  addHook(name: 'onSend', hook: OnSendHook): void;
  addHook(name: 'onResponse', hook: OnResponseHook): void;
  addHook(name: 'onError', hook: OnErrorHook): void;
  setErrorHandler(handler: ErrorHandler): void;
  register(plugin: Plugin, options?: RegisterOptions): void;
}

export type Plugin = (scope: Scope) => void | Promise<void>;

export interface RegisterOptions {
  readonly name?: string;
}

export interface ListenOptions {
  readonly port: number;
  readonly host?: string;
}

export interface ListeningAddress {
  readonly host: string;
  readonly port: number;
  readonly url: string;
}

export interface Server extends Scope {
  listen(options: ListenOptions): Promise<ListeningAddress>;
  close(): Promise<void>;
}

export interface HttpServerHandle {
  listen(host: string, port: number): Promise<ListeningAddress>;
  close(timeoutMs: number): Promise<void>;
}
