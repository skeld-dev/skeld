// Does:  Declares the server's public types: options, handler and hook signatures, contexts and scopes.
// Holds: A handler's request and reply types are derived from its route's schemas, never written by hand.

import type { HttpError } from '../contract/http-error.ts';
import type { ContractRoutes, Empty, RouteDefinition, RouteInfo } from '../contract/types.ts';
import type { Infer, Schema, Wire } from '../schema/types.ts';

/**
 * The options of `createServer`; each one is a positive integer.
 * `createServer` throws BootError `INVALID_OPTION` for any other value, or for a `headersTimeout` above `requestTimeout`.
 */
export interface ServerOptions {
  /**
   * Largest request body accepted, in bytes; a larger one is refused with 413 (default 1 MiB).
   * A route's limit is the smaller of this, or its `bodyLimits` entry, and the cap derived from its body schema.
   */
  readonly bodyLimit?: number;
  /** Longest path parameter accepted, in bytes as received; a longer one is refused with 414 (default 100). */
  readonly maxParamLength?: number;
  /**
   * Time each plugin has to settle at `listen`, in milliseconds (default 10 000).
   * Past it `listen` rejects with BootError `PLUGIN_TIMEOUT`.
   */
  readonly pluginTimeoutMs?: number;
  /** Time `close` waits for open connections, in milliseconds, before closing them forcibly (default 10 000). */
  readonly closeTimeoutMs?: number;
  /** Time an idle keep-alive connection stays open, in milliseconds (default 72 000). */
  readonly keepAliveTimeout?: number;
  /**
   * Time allowed to receive a whole request, in milliseconds (default 300 000).
   * A request still arriving after it is answered 408 and its connection closed, up to a tenth of `headersTimeout` later (at least 1 s, at most 30 s).
   */
  readonly requestTimeout?: number;
  /**
   * Time allowed to receive the request headers, in milliseconds; at most `requestTimeout` (default 60 000).
   * Headers still arriving after it are answered 408 and the connection closed, up to a tenth of it later (at least 1 s, at most 30 s).
   */
  readonly headersTimeout?: number;
  /** Largest request header block accepted, in bytes; a larger one is refused with 431 (default 16 KiB). */
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

/** Request headers by lower-case name, as the HTTP parser gives them. */
export interface RawHeaders {
  readonly [name: string]: string | readonly string[] | undefined;
}

/** A response header name the engine owns: a framing or connection field no author may set. */
export type ReservedHeaderName =
  | 'transfer-encoding'
  | 'content-length'
  | 'connection'
  | 'keep-alive'
  | 'proxy-connection'
  | 'te'
  | 'trailer'
  | 'upgrade';

/** A header name an author may set: the name itself, or a message type naming it when it is a `ReservedHeaderName`. */
export type AuthorHeaderName<N extends string> = N extends unknown
  ? Lowercase<N> extends ReservedHeaderName
    ? `${N} is reserved for the engine`
    : N
  : never;

/**
 * Response headers to set, by name.
 * The engine owns `transfer-encoding`, `content-length`, `connection`, `keep-alive`, `proxy-connection`, `te`, `trailer` and `upgrade`: a lower-case key among them fails to compile, and one in any letter case at runtime is answered with the fixed 500.
 */
export type OutgoingHeaders = { readonly [name: string]: string | number | readonly string[] } & {
  readonly [K in ReservedHeaderName]?: never;
};

/** What a handler receives: the route and its request parts, validated and typed by the contract. */
export interface RouteRequest<R extends RouteDefinition> {
  /** The matched route. */
  readonly route: RouteInfo;
  /** The path parameters, validated and converted to the declared kinds. */
  readonly params: R extends { readonly params: infer S extends Schema } ? Infer<S> : Empty;
  /** The declared query parameters, validated and converted; undeclared keys are left out. */
  readonly query: R extends { readonly query: infer S extends Schema } ? Infer<S> : Empty;
  /** The declared headers, validated; every raw header when the route declares none. */
  readonly headers: R extends { readonly headers: infer S extends Schema } ? Infer<S> : RawHeaders;
  /** The parsed and validated body, with `secret` values wrapped in `Secret`. */
  readonly body: R extends { readonly body: infer S extends Schema } ? Infer<S> : undefined;
  /** Aborted when the connection closes or the request is destroyed, to stop work no client waits for. */
  readonly signal: AbortSignal;
}

/**
 * What a handler returns: a declared status, its body and optional headers.
 * Keys the response schema does not declare are not written; on an error response the engine writes, only the CORS response headers and `vary` in `headers` are kept.
 */
export type RouteReply<R extends RouteDefinition> = {
  [S in keyof R['responses']]: R['responses'][S] extends Schema
    ? {
        readonly status: S;
        readonly body: Wire<R['responses'][S]>;
        /** Headers to set on the reply; a reserved name of `OutgoingHeaders` is answered with the fixed 500. */
        readonly headers?: OutgoingHeaders;
      }
    : {
        readonly status: S;
        /** Headers to set on the reply; a reserved name of `OutgoingHeaders` is answered with the fixed 500. */
        readonly headers?: OutgoingHeaders;
      };
}[keyof R['responses']];

/**
 * The function that serves one route of a contract.
 * A thrown value goes to the scope's error handlers; with none, an `HttpError` is written as its error body and anything else as 500 `INTERNAL`.
 */
export type Handler<C extends ContractRoutes, K extends keyof C> = (
  request: RouteRequest<C[K]>,
) => RouteReply<C[K]> | Promise<RouteReply<C[K]>>;

/** One handler per route name of a contract. */
export type Handlers<C extends ContractRoutes> = { readonly [K in keyof C]: Handler<C, K> };

/** The options of `Scope.routes`. */
export interface RoutesOptions<C extends ContractRoutes> {
  /**
   * Body limits in bytes by route name, each replacing `bodyLimit` for its route.
   * `routes` throws BootError `INVALID_OPTION` for a value that is not a positive integer or a route that declares no body.
   */
  readonly bodyLimits?: { readonly [K in keyof C]?: number };
}

/** A reply a hook sends with `context.send`. */
export interface RawReply {
  /** The HTTP status. */
  readonly status: number;
  /** Headers to set on the reply; a reserved name of `OutgoingHeaders` makes `send` throw `Error` before anything is set. */
  readonly headers?: OutgoingHeaders;
  /** The body, written as given; without it the reply has no body. */
  readonly payload?: string | Uint8Array;
}

/** What an `onRequest` hook receives: the route, the raw request and a way to reply. */
export interface RequestContext {
  /** The matched route. */
  readonly route: RouteInfo;
  /** The request method as received. */
  readonly method: string;
  /** The request path as received, without the query string. */
  readonly path: string;
  /** The raw request headers. */
  readonly headers: RawHeaders;
  /** Aborted when the connection closes or the request is destroyed. */
  readonly signal: AbortSignal;
  /**
   * Sets a header on the response.
   * A reserved name of `OutgoingHeaders` fails to compile as a literal and otherwise throws `Error`; on an error response the engine writes, only the CORS response headers and `vary` are kept.
   */
  setHeader<N extends string>(name: AuthorHeaderName<N>, value: string | number | readonly string[]): void;
  /**
   * Replies at once; later hooks and the handler do not run.
   * A second reply throws `Error` `Response already sent`; `onResponse` hooks do not run for a hook's reply.
   */
  send(reply: RawReply): void;
}

/** What a `preHandler` hook receives: the request context and the validated parts. */
export interface ValidatedContext extends RequestContext {
  /** The validated path parameters. */
  readonly params: unknown;
  /** The validated query parameters. */
  readonly query: unknown;
  /** The validated body. */
  readonly body: unknown;
}

/** What an `onSend` hook receives. */
export interface ResponseContext {
  /** The matched route. */
  readonly route: RouteInfo;
  /** The request method as received. */
  readonly method: string;
  /** The request path as received, without the query string. */
  readonly path: string;
  /** The raw request headers. */
  readonly headers: RawHeaders;
  /** Aborted when the connection closes or the request is destroyed. */
  readonly signal: AbortSignal;
  /** The status being written. */
  readonly status: number;
  /**
   * Sets a header on the response.
   * A reserved name of `OutgoingHeaders` fails to compile as a literal and otherwise throws `Error`; on an error response the engine writes, only the CORS response headers and `vary` are kept.
   */
  setHeader<N extends string>(name: AuthorHeaderName<N>, value: string | number | readonly string[]): void;
}

/** What an `onResponse` hook receives once the response is done or its connection closed. */
export interface CompletedContext {
  /** The matched route. */
  readonly route: RouteInfo;
  /** The request method as received. */
  readonly method: string;
  /** The request path as received, without the query string. */
  readonly path: string;
  /** The status written. */
  readonly status: number;
  /** Whether the whole response was written before the connection closed. */
  readonly completed: boolean;
}

/** What an `onError` hook and an error handler receive. */
export interface ErrorContext {
  /** The matched route. */
  readonly route: RouteInfo;
  /** The request method as received. */
  readonly method: string;
  /** The request path as received, without the query string. */
  readonly path: string;
  /** The raw request headers. */
  readonly headers: RawHeaders;
  /** Aborted when the connection closes or the request is destroyed. */
  readonly signal: AbortSignal;
}

/**
 * A hook run after routing and before the body is read.
 * `context.send` replies and skips the rest of the request; a throw takes the error path.
 */
export type OnRequestHook = (context: RequestContext) => void | Promise<void>;
/**
 * A hook run after every request part is validated and before the handler.
 * It never runs for a refused request; `context.send` replies and skips the handler.
 */
export type PreHandlerHook = (context: ValidatedContext) => void | Promise<void>;
/**
 * A hook that observes the serialized payload before it is written; it can set headers but never change the payload.
 * Its return value is ignored; a throw goes to the error path.
 */
export type OnSendHook = (context: ResponseContext, payload: string) => void | Promise<void>;
/**
 * A hook run once the response is done or its connection closed, to observe the outcome.
 * A throw is written to stderr and changes nothing; it does not run after a hook replied with `send`.
 */
export type OnResponseHook = (context: CompletedContext) => void | Promise<void>;
/**
 * A hook that observes a failed request's error before the error handlers run.
 * It cannot change the reply; a throw is written to stderr.
 */
export type OnErrorHook = (context: ErrorContext, error: unknown) => void | Promise<void>;

/**
 * Turns a thrown value into the `HttpError` written to the client.
 * The nearest scope's handler runs first and a value it throws goes to the parent's; a result that is not an `HttpError` with a status is written as 500 `INTERNAL`.
 */
export type ErrorHandler = (error: unknown, context: ErrorContext) => HttpError | Promise<HttpError>;

/** The hook names `addHook` accepts. */
export type HookName = 'onRequest' | 'preHandler' | 'onSend' | 'onResponse' | 'onError';

/**
 * A place to declare routes, hooks, an error handler and plugins; the server is the root scope.
 * Its methods throw BootError `REGISTRATION_CLOSED` once `listen` is called, or once the plugin that owns it has settled.
 */
export interface Scope {
  /**
   * Adds a contract's routes to this scope, with one handler per route.
   * Throws `TypeError` for a contract that breaks a rule or a route without a handler.
   */
  routes<C extends ContractRoutes>(
    contract: C,
    handlers: NoInfer<Handlers<C>>,
    options?: NoInfer<RoutesOptions<C>>,
  ): void;
  /** Adds a hook to this scope; it runs for this scope's routes and its plugins' routes, after its parents' hooks. */
  addHook(name: 'onRequest', hook: OnRequestHook): void;
  addHook(name: 'preHandler', hook: PreHandlerHook): void;
  addHook(name: 'onSend', hook: OnSendHook): void;
  addHook(name: 'onResponse', hook: OnResponseHook): void;
  addHook(name: 'onError', hook: OnErrorHook): void;
  /**
   * Sets this scope's error handler.
   * Throws BootError `ERROR_HANDLER_ALREADY_SET` on a second call.
   */
  setErrorHandler(handler: ErrorHandler): void;
  /**
   * Adds a plugin, which `listen` runs in order with a child scope of this one.
   * A plugin that throws or rejects makes `listen` reject with BootError `PLUGIN_FAILED`.
   */
  register(plugin: Plugin, options?: RegisterOptions): void;
}

/** A function that declares routes, hooks and plugins on the child scope it is given; it may be async. */
export type Plugin = (scope: Scope) => void | Promise<void>;

/** The options of `Scope.register`. */
export interface RegisterOptions {
  /** The plugin's name in boot errors (default the function's name, or `plugin #<n>` for an anonymous one). */
  readonly name?: string;
}

/** The options of `Server.listen`. */
export interface ListenOptions {
  /**
   * The TCP port, from 0 to 65535; 0 picks a free one.
   * Any other value makes `listen` reject with BootError `INVALID_OPTION`.
   */
  readonly port: number;
  /** The address to bind; an empty string is refused (default `127.0.0.1`). */
  readonly host?: string;
}

/** The address a server listens on. */
export interface ListeningAddress {
  /** The bound address. */
  readonly host: string;
  /** The bound port. */
  readonly port: number;
  /** The base URL, as in `http://127.0.0.1:3000`; an IPv6 host is in brackets. */
  readonly url: string;
}

/** A service: the root scope, with `listen` and `close`. */
export interface Server extends Scope {
  /**
   * Runs the plugins, checks and compiles every route, then listens; resolves with the bound address.
   * Rejects with BootError: `ALREADY_LISTENING` on a second call, `SERVER_CLOSED` after `close`, or the code of the step that failed.
   */
  listen(options: ListenOptions): Promise<ListeningAddress>;
  /**
   * Stops accepting connections and resolves once every open one has closed.
   * Idle connections close at once and the rest are closed forcibly after `closeTimeoutMs`; every call returns the same promise.
   */
  close(): Promise<void>;
}

export interface HttpServerHandle {
  listen(host: string, port: number): Promise<ListeningAddress>;
  close(timeoutMs: number): Promise<void>;
}
