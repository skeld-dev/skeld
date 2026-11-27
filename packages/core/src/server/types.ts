// Does:  Declares the server's public types: options, handler and hook signatures, contexts and scopes.
// Holds: A handler's request and reply types are derived from its route's schemas, never written by hand.

import type { HttpError } from '../contract/http-error.ts';
import type { ContractRoutes, Empty, OutgoingCookie, RouteDefinition, RouteInfo } from '../contract/types.ts';
import type { ResolvedCors } from '../cors/policy.ts';
import type { ResolvedCsrf } from '../csrf/policy.ts';
import type { AccessTypes, Gate, NoAccess, SecurityEvent } from '../gate/types.ts';
import type { Classified, Logger, LogOptions, LogStats, RequestPart, Severity } from '../log/types.ts';
import type { Infer, Schema, Wire } from '../schema/types.ts';

/**
 * The options of `createServer`; each number is a positive integer.
 * `createServer` throws BootError `INVALID_OPTION` for any other value, or for a `headersTimeout` above `requestTimeout`.
 */
export interface ServerOptions<A extends AccessTypes = NoAccess> {
  /**
   * The server's access control; with it every route must declare `access` (default none: no route may declare it).
   * `createServer` throws BootError `INVALID_OPTION` for a value that is not an object with `boot` and `bind` functions.
   */
  readonly gate?: Gate<A>;
  /**
   * Largest request body accepted, in bytes; a larger one is refused with 413 (default 1 MiB).
   * A route's limit is the smaller of this, or its `bodyLimits` entry, and the cap derived from its body schema.
   */
  readonly bodyLimit?: number;
  /** Longest path parameter accepted, in bytes as received; a longer one is refused with 414 (default 100). */
  readonly maxParamLength?: number;
  /**
   * Time each plugin has to settle at `listen`, in milliseconds, at most 2 147 483 647 (default 10 000).
   * Past it `listen` rejects with BootError `PLUGIN_TIMEOUT`.
   */
  readonly pluginTimeoutMs?: number;
  /** Time each registered disposer has to settle, in ms, at most 2 147 483 647 (default 10 000). */
  readonly pluginCloseTimeoutMs?: number;
  /** Time `close` waits for open connections before closing them, in ms, at most 2 147 483 647 (default 10 000). */
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
  /**
   * Time from the first asynchronous body or application wait to the response, in ms, at most 2 147 483 647 (default 30 000).
   * Past it: 503 `TIMEOUT` and connection closed when the deadline sweep runs; event-loop stalls can delay expiry.
   */
  readonly handlerTimeoutMs?: number;
  /**
   * Proxy addresses and CIDR ranges whose `X-Forwarded-For` sets `clientAddress` (default none).
   * A malformed entry, a zone id or a zero-length prefix (`0.0.0.0/0`) is refused with BootError `INVALID_OPTION`.
   */
  readonly trustProxy?: readonly string[];
  /**
   * Whether responses carry `nosniff`, a frame ban and `cache-control: no-store` unless set (default true).
   * A header the application set on the response is kept; an error the engine writes always carries all four.
   */
  readonly securityHeaders?: boolean;
  /**
   * Origins an absolute redirect `Location` may name, each exactly as `new URL(x).origin` writes it (default none).
   * Local paths are always allowed; `publicOrigin` is not added; a malformed entry is BootError `INVALID_OPTION`.
   */
  readonly redirectOrigins?: readonly string[];
  /**
   * The cross-origin policy of every route, unless a `routes()` group sets its own (default none: no CORS header).
   * A malformed origin, `'*'` with `credentials`, an empty list or a bad header name is refused with BootError `INVALID_OPTION`.
   */
  readonly cors?: CorsPolicy | false;
  /**
   * The origins the service is reached at, each exactly as `new URL(x).origin` writes it (default none).
   * The cross-site check passes an unsafe request whose `Origin` is one of them; a malformed one is BootError `INVALID_OPTION`.
   */
  readonly publicOrigin?: string | readonly string[];
  /**
   * The cross-site check on POST, PUT, PATCH and DELETE, unless a `routes()` group sets its own (default `baseline`).
   * A refused request is answered 403 `CROSS_ORIGIN`; `strict` without `publicOrigin` is BootError `INVALID_OPTION`.
   */
  readonly csrf?: CsrfPolicy;
  /**
   * The structured log on stdout or a sink; `false` writes no record and calls no sink (default: stdout, no options).
   * `createServer` throws BootError `INVALID_OPTION` for an unknown key or a malformed value.
   */
  readonly log?: LogOptions | false;
}

/**
 * Which browser origins may read a route's responses; it never refuses a request, the cross-site check does.
 * @example createServer({ cors: { origins: ['https://app.example'], credentials: true } })
 */
export interface CorsPolicy {
  /** The allowed origins, each exactly as `new URL(x).origin` writes it, or `'*'` for any origin without credentials. */
  readonly origins: '*' | readonly string[];
  /** Whether a granted response lets the page send and read credentials such as cookies (default false). */
  readonly credentials?: boolean;
  /** Request header names a preflight allows beyond the route's declared headers and `content-type` (default none). */
  readonly allowedHeaders?: readonly string[];
  /** Response header names a granted page may read beyond the CORS-safelisted ones (default none). */
  readonly exposedHeaders?: readonly string[];
  /** How long a browser may cache a preflight answer, in whole seconds from 0 to 86,400 (default 600). */
  readonly maxAgeSeconds?: number;
}

/**
 * The cross-site check on unsafe methods: `Origin` against the allowed origins, then `Sec-Fetch-Site`.
 * @example createServer({ publicOrigin: 'https://api.example', csrf: { mode: 'strict' } })
 */
export interface CsrfPolicy {
  /** `baseline` passes a request with neither `Origin` nor `Sec-Fetch-Site`; `strict` refuses it (default `baseline`). */
  readonly mode?: 'baseline' | 'strict';
  /** Other origins whose pages may send unsafe requests, besides `publicOrigin`; CORS origins are not added (default none). */
  readonly trustedOrigins?: readonly string[];
}

export interface ResolvedServerOptions {
  readonly bodyLimit: number;
  readonly maxParamLength: number;
  readonly pluginTimeoutMs: number;
  readonly pluginCloseTimeoutMs: number;
  readonly closeTimeoutMs: number;
  readonly keepAliveTimeout: number;
  readonly requestTimeout: number;
  readonly headersTimeout: number;
  readonly maxHeaderSize: number;
  readonly handlerTimeoutMs: number;
  readonly securityHeaders: boolean;
  readonly redirectOrigins: readonly string[];
  readonly cors: ResolvedCors | null;
  readonly publicOrigin: readonly string[];
  readonly csrf: ResolvedCsrf;
}

/** Request headers by lower-case name, as the HTTP parser gives them. */
export interface RawHeaders {
  readonly [name: string]: string | readonly string[] | undefined;
}

/** A request's cookies exactly as sent: no percent-decoding, no quote removal; names are case-sensitive. */
export interface RawCookies {
  /** Returns the value of a cookie sent exactly once; a name sent twice or never gives `undefined`. */
  get(name: string): string | undefined;
  /** Returns every value sent under the name, in the order received; empty when it was not sent. */
  getAll(name: string): readonly string[];
}

/** A CORS response header name, which only the `cors` option sets. */
export type CorsHeaderName =
  | 'access-control-allow-origin'
  | 'access-control-allow-credentials'
  | 'access-control-expose-headers'
  | 'access-control-allow-methods'
  | 'access-control-allow-headers'
  | 'access-control-max-age';

/** A response header name the engine owns: framing, connection, `set-cookie`, CORS or `x-request-id`. */
export type ReservedHeaderName =
  | 'transfer-encoding'
  | 'content-length'
  | 'connection'
  | 'keep-alive'
  | 'proxy-connection'
  | 'te'
  | 'trailer'
  | 'upgrade'
  | 'set-cookie'
  | 'x-request-id'
  | CorsHeaderName;

/** A header name an author may set: the name itself, or a message type naming it when it is a `ReservedHeaderName`. */
export type AuthorHeaderName<N extends string> = N extends unknown
  ? Lowercase<N> extends ReservedHeaderName
    ? Lowercase<N> extends 'set-cookie'
      ? `${N} is reserved for the engine: use setCookie or the reply's cookies`
      : Lowercase<N> extends CorsHeaderName
        ? `${N} is reserved for the engine: use the cors option`
        : `${N} is reserved for the engine`
    : N
  : never;

/**
 * Response headers to set, by name.
 * A `ReservedHeaderName` (framing, connection, `set-cookie`, `access-control-*`, `x-request-id`) fails to compile as a lower-case key; in any letter case at runtime it is answered with the fixed 500.
 */
export type OutgoingHeaders = { readonly [name: string]: string | number | readonly string[] } & {
  readonly [K in ReservedHeaderName]?: never;
};

/** The string keys of the schema a route declares for one request part; `never` when it declares none. */
export type PartKey<R extends RouteDefinition, P extends RequestPart> = R extends {
  readonly [Q in P]: infer S extends Schema;
}
  ? keyof Infer<S> & string
  : never;

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
  /** The declared cookies, validated, with `secret` values wrapped; empty when the route declares none. */
  readonly cookies: R extends { readonly cookies: infer S extends Schema } ? Infer<S> : Empty;
  /** The parsed and validated body, with `secret` values wrapped in `Secret`. */
  readonly body: R extends { readonly body: infer S extends Schema } ? Infer<S> : undefined;
  /** Aborted when the connection closes or the request times out, to stop work no client waits for. */
  readonly signal: AbortSignal;
  /** The client's IP address: the socket peer, or from `X-Forwarded-For` when the peer is in `trustProxy`. */
  readonly clientAddress: string;
  /** The request's cookies as sent; the header is parsed on first read. */
  readonly rawCookies: RawCookies;
  /** The request's logger, one per request and shared with its hooks; each record carries `requestId`. */
  readonly log: Logger;
  /** The request's local id, a version 4 UUID, also sent as the `x-request-id` response header. */
  readonly requestId: string;
  /** Pairs a request part, or one declared key of it, with the route's own schema for that part, for a log call. */
  classified<P extends RequestPart>(part: P, key?: PartKey<R, P>): Classified;
}

/**
 * What a handler returns: a declared status, its body and optional headers.
 * Keys the response schema does not declare are not written; an error response the engine writes keeps none of `headers`.
 */
export type RouteReply<R extends RouteDefinition> = {
  [S in keyof R['responses']]: R['responses'][S] extends Schema
    ? {
        readonly status: S;
        readonly body: Wire<R['responses'][S]>;
        /** Headers to set on the reply; a reserved name of `OutgoingHeaders` is answered with the fixed 500. */
        readonly headers?: OutgoingHeaders;
        /** Cookies to set, each as its own `Set-Cookie` line; an invalid one is answered with the fixed 500. */
        readonly cookies?: readonly OutgoingCookie[];
      }
    : {
        readonly status: S;
        /** Headers to set on the reply; a reserved name of `OutgoingHeaders` is answered with the fixed 500. */
        readonly headers?: OutgoingHeaders;
        /** Cookies to set, each as its own `Set-Cookie` line; an invalid one is answered with the fixed 500. */
        readonly cookies?: readonly OutgoingCookie[];
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

type PrincipalOf<X, P> = X extends object ? P : X extends 'optional' ? P | null : undefined;

type GrantOf<X, G> = X extends { readonly policy: infer N extends keyof G; readonly action: infer T }
  ? T extends keyof G[N]
    ? G[N][T]
    : never
  : X extends object
    ? never
    : undefined;

/** What a handler on a server with a gate receives: the route's request, its principal and its grant. */
export interface GatedRequest<R extends RouteDefinition, A extends AccessTypes> extends RouteRequest<R> {
  /** The admitted principal: `undefined` on a `'public'` route, `null` on an `'optional'` one without a credential. */
  readonly principal: PrincipalOf<R['access'], A['principal']>;
  /** The grant of the route's policy action: `undefined` unless the route names a policy, `never` for an unknown name. */
  readonly grant: GrantOf<R['access'], A['grants']>;
}

/**
 * The function that serves one route of a contract on a server with a gate.
 * A `Handler` of the same route is assignable to it.
 */
export type GatedHandler<C extends ContractRoutes, K extends keyof C, A extends AccessTypes> = (
  request: GatedRequest<C[K], A>,
) => RouteReply<C[K]> | Promise<RouteReply<C[K]>>;

/** One handler per route name of a contract, on a server with a gate. */
export type GatedHandlers<C extends ContractRoutes, A extends AccessTypes> = {
  readonly [K in keyof C]: GatedHandler<C, K, A>;
};

/** The options of `Scope.routes`. */
export interface RoutesOptions<C extends ContractRoutes> {
  /**
   * Body limits in bytes by route name, each replacing `bodyLimit` for its route.
   * `routes` throws BootError `INVALID_OPTION` for an unknown name, a value that is not a positive integer or a route that declares no body.
   */
  readonly bodyLimits?: { readonly [K in keyof C]?: number };
  /**
   * Time limits in milliseconds by route name, each replacing `handlerTimeoutMs` for its route.
   * `routes` throws BootError `INVALID_OPTION` for a value not from 1 to 2 147 483 647 or a name not in the contract.
   */
  readonly handlerTimeouts?: { readonly [K in keyof C]?: number };
  /**
   * Origins an absolute redirect from these routes may name, replacing the server's `redirectOrigins`, never merged.
   * `routes` throws BootError `INVALID_OPTION` for an entry that is not exactly an http or https origin.
   */
  readonly redirectOrigins?: readonly string[];
  /**
   * The cross-origin policy of these routes, replacing the server's `cors` whole; `false` turns it off for them.
   * `routes` throws BootError `INVALID_OPTION` for a policy the server option would refuse.
   */
  readonly cors?: CorsPolicy | false;
  /**
   * The cross-site check of these routes, replacing the server's `csrf` whole, never merged.
   * `listen` throws BootError `INVALID_OPTION` for `strict` without `publicOrigin`, or no `mode` under a strict server.
   */
  readonly csrf?: CsrfPolicy;
  /**
   * Route names the cross-site check skips, such as a webhook that proves its sender another way.
   * `routes` throws BootError `INVALID_OPTION` for a name not in the contract.
   */
  readonly csrfExempt?: readonly (keyof C)[];
}

/** A reply a hook sends with `context.send`. */
export interface RawReply {
  /** The HTTP status, an integer from 200 to 599; any other value makes `send` throw `Error` before anything is set. */
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
  /** Aborted when the connection closes or the request times out. */
  readonly signal: AbortSignal;
  /** The client's IP address: the socket peer, or from `X-Forwarded-For` when the peer is in `trustProxy`. */
  readonly clientAddress: string;
  /** The request's cookies as sent; the header is parsed on first read. */
  readonly rawCookies: RawCookies;
  /** The request's logger, shared with its handler and its other hooks; each record carries `requestId`. */
  readonly log: Logger;
  /** The request's local id, a version 4 UUID, also sent as the `x-request-id` response header. */
  readonly requestId: string;
  /**
   * Sets a header on the response.
   * A reserved name of `OutgoingHeaders` fails to compile as a literal and otherwise throws `Error`; an error response the engine writes keeps no header set here.
   */
  setHeader<N extends string>(name: AuthorHeaderName<N>, value: string | number | readonly string[]): void;
  /**
   * Sets a cookie on the response, replacing a pending one of the same name, path and domain.
   * Throws `Error` for an invalid cookie or once the response is sent; an error response drops it.
   */
  setCookie(cookie: OutgoingCookie): void;
  /**
   * Replies at once; later hooks and the handler do not run.
   * Throws `Error` for a status outside 200-599 or a second reply (`Response already sent`); one after a timeout is dropped; `onResponse` skips it.
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
  /** Aborted when the connection closes or the request times out. */
  readonly signal: AbortSignal;
  /** The client's IP address: the socket peer, or from `X-Forwarded-For` when the peer is in `trustProxy`. */
  readonly clientAddress: string;
  /** The request's cookies as sent; the header is parsed on first read. */
  readonly rawCookies: RawCookies;
  /** The request's logger, shared with its handler and its other hooks; each record carries `requestId`. */
  readonly log: Logger;
  /** The request's local id, a version 4 UUID, also sent as the `x-request-id` response header. */
  readonly requestId: string;
  /** The status being written. */
  readonly status: number;
  /**
   * Sets a header on the response.
   * A reserved name of `OutgoingHeaders` fails to compile as a literal and otherwise throws `Error`; an error response the engine writes keeps no header set here.
   */
  setHeader<N extends string>(name: AuthorHeaderName<N>, value: string | number | readonly string[]): void;
  /**
   * Sets a cookie on the response, replacing a pending one of the same name, path and domain.
   * Throws `Error` for an invalid cookie or once the response is sent; an error response drops it.
   */
  setCookie(cookie: OutgoingCookie): void;
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
  /** The client's IP address: the socket peer, or from `X-Forwarded-For` when the peer is in `trustProxy`. */
  readonly clientAddress: string;
  /** The request's logger, shared with its handler and its other hooks; each record carries `requestId`. */
  readonly log: Logger;
  /** The request's local id, a version 4 UUID, also sent as the `x-request-id` response header. */
  readonly requestId: string;
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
  /** Aborted when the connection closes or the request times out. */
  readonly signal: AbortSignal;
  /** The client's IP address: the socket peer, or from `X-Forwarded-For` when the peer is in `trustProxy`. */
  readonly clientAddress: string;
  /** The request's cookies as sent; the header is parsed on first read. */
  readonly rawCookies: RawCookies;
  /** The request's logger, shared with its handler and its other hooks; each record carries `requestId`. */
  readonly log: Logger;
  /** The request's local id, a version 4 UUID, also sent as the `x-request-id` response header. */
  readonly requestId: string;
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
 * A throw is logged as `skeld.hook.error` and changes nothing; it does not run after `send` or a cross-site refusal.
 */
export type OnResponseHook = (context: CompletedContext) => void | Promise<void>;
/**
 * A hook that observes a failed request's error before the error handlers run.
 * It cannot change the reply; a throw is logged as `skeld.hook.error`.
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
 * Its methods throw BootError `REGISTRATION_CLOSED` once `listen` or a worker's `start` is called, or once its plugin settled.
 */
export interface Scope<A extends AccessTypes = NoAccess> {
  /** Aborted when shutdown or startup rollback begins; plugins must stop their own asynchronous work. */
  readonly signal: AbortSignal;
  /** The server's logger, the same in every scope, plugins included; its records carry no request id. */
  readonly log: Logger;
  /** Time each `onClose` callback has to settle, in milliseconds: the server's `pluginCloseTimeoutMs`. */
  readonly closeTimeoutMs: number;
  /**
   * Registers a security event and returns its writer; the scopes share 64 names per server, apart from the gate's.
   * Names follow `GateBoot.event`'s rules; a name repeated with another severity throws `TypeError`.
   * @example const server = createServer(); const denied = server.event('app.denied', 'warn'); denied(server.log);
   */
  event(name: string, severity: Severity): SecurityEvent;
  /**
   * Registers a callback `listen` (before binding) or a worker's `start` calls once with the routes its hooks reach, frozen.
   * A throw or a returned value makes `listen` or `start` reject with BootError `PLUGIN_FAILED`.
   * @example const server = createServer(); server.onRoutes((routes) => console.log(routes.length));
   */
  onRoutes(callback: (routes: readonly RouteInfo[]) => void): void;
  /**
   * Registers resource disposal in reverse registration order after transport shutdown, also on failed boot.
   * Each callback runs once under pluginCloseTimeoutMs; registration after sealing throws REGISTRATION_CLOSED.
   * @example const server = createServer(); server.onClose(() => console.log("closed")); await server.close();
   */
  onClose(callback: () => void | Promise<void>): void;
  /**
   * Adds a contract's routes to this scope, with one handler per route.
   * Throws `TypeError` for a contract that breaks a rule or a route without a handler.
   */
  routes<C extends ContractRoutes>(
    contract: C,
    handlers: NoInfer<[A] extends [NoAccess] ? Handlers<C> : GatedHandlers<C, A>>,
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
   * Adds a plugin, which `listen` or a worker's `start` runs in order with a child scope of this one.
   * A plugin that throws or rejects makes `listen` or `start` reject with BootError `PLUGIN_FAILED`.
   */
  register(plugin: Plugin<A>, options?: RegisterOptions): void;
}

/** A function that declares routes, hooks and plugins on the child scope it is given; it may be async. */
export type Plugin<A extends AccessTypes = NoAccess> = (scope: Scope<A>) => void | Promise<void>;

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
export interface Server<A extends AccessTypes = NoAccess> extends Scope<A> {
  /**
   * Runs the plugins, checks and compiles every route, then listens; resolves with the bound address.
   * Rejects with BootError: `ALREADY_LISTENING` on a second call, `SERVER_CLOSED` after `close`, or the code of the step that failed.
   */
  listen(options: ListenOptions): Promise<ListeningAddress>;
  /**
   * Stops accepting connections and resolves once every open one has closed.
   * Idle connections close at once; others are forced after `closeTimeoutMs`, then disposers run; failures reject AggregateError and every call returns the same promise.
   */
  close(): Promise<void>;
  /**
   * Returns this server's log counts; never throws, before `listen` and after `close` too.
   * @example const server = createServer(); console.log(server.logStats().dropped.queue_full);
   */
  logStats(): LogStats;
}

export interface HttpServerHandle {
  listen(host: string, port: number, signal: AbortSignal): Promise<ListeningAddress>;
  close(timeoutMs: number): Promise<void>;
}
