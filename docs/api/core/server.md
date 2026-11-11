# @darkstart/core/server

## Empty

The type of a request part the route does not declare: an object with no keys.

```ts
export interface Empty {
  readonly [key: string]: never;
}
```

Source: `packages/core/src/contract/types.ts:101`

## RouteInfo

A route's name, method and path, as errors and hook contexts report it.

```ts
export interface RouteInfo {
  readonly name: string;
  readonly method: HttpMethod;
  readonly path: string;
}
```

| Field    | Summary                           |
| -------- | --------------------------------- |
| `name`   | The route's name in its contract. |
| `method` | The route's HTTP method.          |
| `path`   | The route's path pattern.         |

Source: `packages/core/src/contract/types.ts:106`

## AuthorHeaderName

A header name an author may set: the name itself, or a message type naming it when it is a `ReservedHeaderName`.

```ts
export type AuthorHeaderName<N extends string> = N extends unknown
  ? Lowercase<N> extends ReservedHeaderName
    ? `${N} is reserved for the engine`
    : N
  : never;
```

Source: `packages/core/src/server/types.ts:88`

## CompletedContext

What an `onResponse` hook receives once the response is done or its connection closed.

```ts
export interface CompletedContext {
  readonly route: RouteInfo;
  readonly method: string;
  readonly path: string;
  readonly status: number;
  readonly completed: boolean;
  readonly clientAddress: string;
}
```

| Field           | Summary                                                                                               |
| --------------- | ----------------------------------------------------------------------------------------------------- |
| `route`         | The matched route.                                                                                    |
| `method`        | The request method as received.                                                                       |
| `path`          | The request path as received, without the query string.                                               |
| `status`        | The status written.                                                                                   |
| `completed`     | Whether the whole response was written before the connection closed.                                  |
| `clientAddress` | The client's IP address: the socket peer, or from `X-Forwarded-For` when the peer is in `trustProxy`. |

Source: `packages/core/src/server/types.ts:234`

## ErrorContext

What an `onError` hook and an error handler receive.

```ts
export interface ErrorContext {
  readonly route: RouteInfo;
  readonly method: string;
  readonly path: string;
  readonly headers: RawHeaders;
  readonly signal: AbortSignal;
  readonly clientAddress: string;
}
```

| Field           | Summary                                                                                               |
| --------------- | ----------------------------------------------------------------------------------------------------- |
| `route`         | The matched route.                                                                                    |
| `method`        | The request method as received.                                                                       |
| `path`          | The request path as received, without the query string.                                               |
| `headers`       | The raw request headers.                                                                              |
| `signal`        | Aborted when the connection closes or the request times out.                                          |
| `clientAddress` | The client's IP address: the socket peer, or from `X-Forwarded-For` when the peer is in `trustProxy`. |

Source: `packages/core/src/server/types.ts:250`

## ErrorHandler

Turns a thrown value into the `HttpError` written to the client.

The nearest scope's handler runs first and a value it throws goes to the parent's; a result that is not an `HttpError` with a status is written as 500 `INTERNAL`.

```ts
export type ErrorHandler = (error: unknown, context: ErrorContext) => HttpError | Promise<HttpError>;
```

Source: `packages/core/src/server/types.ts:295`

## Handler

The function that serves one route of a contract.

A thrown value goes to the scope's error handlers; with none, an `HttpError` is written as its error body and anything else as 500 `INTERNAL`.

```ts
export type Handler<C extends ContractRoutes, K extends keyof C> = (
  request: RouteRequest<C[K]>,
) => RouteReply<C[K]> | Promise<RouteReply<C[K]>>;
```

Source: `packages/core/src/server/types.ts:143`

## Handlers

One handler per route name of a contract.

```ts
export type Handlers<C extends ContractRoutes> = { readonly [K in keyof C]: Handler<C, K> };
```

Source: `packages/core/src/server/types.ts:148`

## HookName

The hook names `addHook` accepts.

```ts
export type HookName = 'onRequest' | 'preHandler' | 'onSend' | 'onResponse' | 'onError';
```

Source: `packages/core/src/server/types.ts:298`

## ListeningAddress

The address a server listens on.

```ts
export interface ListeningAddress {
  readonly host: string;
  readonly port: number;
  readonly url: string;
}
```

| Field  | Summary                                                                   |
| ------ | ------------------------------------------------------------------------- |
| `host` | The bound address.                                                        |
| `port` | The bound port.                                                           |
| `url`  | The base URL, as in `http://127.0.0.1:3000`; an IPv6 host is in brackets. |

Source: `packages/core/src/server/types.ts:353`

## ListenOptions

The options of `Server.listen`.

```ts
export interface ListenOptions {
  readonly port: number;
  readonly host?: string;
}
```

| Field  | Summary                                                                |
| ------ | ---------------------------------------------------------------------- |
| `port` | The TCP port, from 0 to 65535; 0 picks a free one.                     |
| `host` | The address to bind; an empty string is refused (default `127.0.0.1`). |

Source: `packages/core/src/server/types.ts:342`

## OnErrorHook

A hook that observes a failed request's error before the error handlers run.

It cannot change the reply; a throw is written to stderr.

```ts
export type OnErrorHook = (context: ErrorContext, error: unknown) => void | Promise<void>;
```

Source: `packages/core/src/server/types.ts:289`

## OnRequestHook

A hook run after routing and before the body is read.

`context.send` replies and skips the rest of the request; a throw takes the error path.

```ts
export type OnRequestHook = (context: RequestContext) => void | Promise<void>;
```

Source: `packages/core/src/server/types.ts:269`

## OnResponseHook

A hook run once the response is done or its connection closed, to observe the outcome.

A throw is written to stderr and changes nothing; it does not run after a hook replied with `send`.

```ts
export type OnResponseHook = (context: CompletedContext) => void | Promise<void>;
```

Source: `packages/core/src/server/types.ts:284`

## OnSendHook

A hook that observes the serialized payload before it is written; it can set headers but never change the payload.

Its return value is ignored; a throw goes to the error path.

```ts
export type OnSendHook = (context: ResponseContext, payload: string) => void | Promise<void>;
```

Source: `packages/core/src/server/types.ts:279`

## OutgoingHeaders

Response headers to set, by name.

The engine owns `transfer-encoding`, `content-length`, `connection`, `keep-alive`, `proxy-connection`, `te`, `trailer` and `upgrade`: a lower-case key among them fails to compile, and one in any letter case at runtime is answered with the fixed 500.

```ts
export type OutgoingHeaders = { readonly [name: string]: string | number | readonly string[] } & {
  readonly [K in ReservedHeaderName]?: never;
};
```

Source: `packages/core/src/server/types.ts:98`

## Plugin

A function that declares routes, hooks and plugins on the child scope it is given; it may be async.

```ts
export type Plugin = (scope: Scope) => void | Promise<void>;
```

Source: `packages/core/src/server/types.ts:333`

## PreHandlerHook

A hook run after every request part is validated and before the handler.

It never runs for a refused request; `context.send` replies and skips the handler.

```ts
export type PreHandlerHook = (context: ValidatedContext) => void | Promise<void>;
```

Source: `packages/core/src/server/types.ts:274`

## RawHeaders

Request headers by lower-case name, as the HTTP parser gives them.

```ts
export interface RawHeaders {
  readonly [name: string]: string | readonly string[] | undefined;
}
```

Source: `packages/core/src/server/types.ts:72`

## RawReply

A reply a hook sends with `context.send`.

```ts
export interface RawReply {
  readonly status: number;
  readonly headers?: OutgoingHeaders;
  readonly payload?: string | Uint8Array;
}
```

| Field     | Summary                                                                                                              |
| --------- | -------------------------------------------------------------------------------------------------------------------- |
| `status`  | The HTTP status.                                                                                                     |
| `headers` | Headers to set on the reply; a reserved name of `OutgoingHeaders` makes `send` throw `Error` before anything is set. |
| `payload` | The body, written as given; without it the reply has no body.                                                        |

Source: `packages/core/src/server/types.ts:165`

## RegisterOptions

The options of `Scope.register`.

```ts
export interface RegisterOptions {
  readonly name?: string;
}
```

| Field  | Summary                                                                                                |
| ------ | ------------------------------------------------------------------------------------------------------ |
| `name` | The plugin's name in boot errors (default the function's name, or `plugin #<n>` for an anonymous one). |

Source: `packages/core/src/server/types.ts:336`

## ReservedHeaderName

A response header name the engine owns: a framing or connection field no author may set.

```ts
export type ReservedHeaderName =
  | 'transfer-encoding'
  | 'content-length'
  | 'connection'
  | 'keep-alive'
  | 'proxy-connection'
  | 'te'
  | 'trailer'
  | 'upgrade';
```

Source: `packages/core/src/server/types.ts:77`

## RequestContext

What an `onRequest` hook receives: the route, the raw request and a way to reply.

```ts
export interface RequestContext {
  readonly route: RouteInfo;
  readonly method: string;
  readonly path: string;
  readonly headers: RawHeaders;
  readonly signal: AbortSignal;
  readonly clientAddress: string;
  setHeader<N extends string>(name: AuthorHeaderName<N>, value: string | number | readonly string[]): void;
  send(reply: RawReply): void;
}
```

| Field           | Summary                                                                                               |
| --------------- | ----------------------------------------------------------------------------------------------------- |
| `route`         | The matched route.                                                                                    |
| `method`        | The request method as received.                                                                       |
| `path`          | The request path as received, without the query string.                                               |
| `headers`       | The raw request headers.                                                                              |
| `signal`        | Aborted when the connection closes or the request times out.                                          |
| `clientAddress` | The client's IP address: the socket peer, or from `X-Forwarded-For` when the peer is in `trustProxy`. |
| `setHeader`     | Sets a header on the response.                                                                        |
| `send`          | Replies at once; later hooks and the handler do not run.                                              |

Source: `packages/core/src/server/types.ts:175`

## ResponseContext

What an `onSend` hook receives.

```ts
export interface ResponseContext {
  readonly route: RouteInfo;
  readonly method: string;
  readonly path: string;
  readonly headers: RawHeaders;
  readonly signal: AbortSignal;
  readonly clientAddress: string;
  readonly status: number;
  setHeader<N extends string>(name: AuthorHeaderName<N>, value: string | number | readonly string[]): void;
}
```

| Field           | Summary                                                                                               |
| --------------- | ----------------------------------------------------------------------------------------------------- |
| `route`         | The matched route.                                                                                    |
| `method`        | The request method as received.                                                                       |
| `path`          | The request path as received, without the query string.                                               |
| `headers`       | The raw request headers.                                                                              |
| `signal`        | Aborted when the connection closes or the request times out.                                          |
| `clientAddress` | The client's IP address: the socket peer, or from `X-Forwarded-For` when the peer is in `trustProxy`. |
| `status`        | The status being written.                                                                             |
| `setHeader`     | Sets a header on the response.                                                                        |

Source: `packages/core/src/server/types.ts:211`

## RouteReply

What a handler returns: a declared status, its body and optional headers.

Keys the response schema does not declare are not written; on an error response the engine writes, only the CORS response headers and `vary` in `headers` are kept.

```ts
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
```

Source: `packages/core/src/server/types.ts:124`

## RouteRequest

What a handler receives: the route and its request parts, validated and typed by the contract.

```ts
export interface RouteRequest<R extends RouteDefinition> {
  readonly route: RouteInfo;
  readonly params: R extends { readonly params: infer S extends Schema } ? Infer<S> : Empty;
  readonly query: R extends { readonly query: infer S extends Schema } ? Infer<S> : Empty;
  readonly headers: R extends { readonly headers: infer S extends Schema } ? Infer<S> : RawHeaders;
  readonly body: R extends { readonly body: infer S extends Schema } ? Infer<S> : undefined;
  readonly signal: AbortSignal;
  readonly clientAddress: string;
}
```

| Field           | Summary                                                                                               |
| --------------- | ----------------------------------------------------------------------------------------------------- |
| `route`         | The matched route.                                                                                    |
| `params`        | The path parameters, validated and converted to the declared kinds.                                   |
| `query`         | The declared query parameters, validated and converted; undeclared keys are left out.                 |
| `headers`       | The declared headers, validated; every raw header when the route declares none.                       |
| `body`          | The parsed and validated body, with `secret` values wrapped in `Secret`.                              |
| `signal`        | Aborted when the connection closes or the request times out, to stop work no client waits for.        |
| `clientAddress` | The client's IP address: the socket peer, or from `X-Forwarded-For` when the peer is in `trustProxy`. |

Source: `packages/core/src/server/types.ts:103`

## RoutesOptions

The options of `Scope.routes`.

```ts
export interface RoutesOptions<C extends ContractRoutes> {
  readonly bodyLimits?: { readonly [K in keyof C]?: number };
  readonly handlerTimeouts?: { readonly [K in keyof C]?: number };
}
```

| Field             | Summary                                                                                     |
| ----------------- | ------------------------------------------------------------------------------------------- |
| `bodyLimits`      | Body limits in bytes by route name, each replacing `bodyLimit` for its route.               |
| `handlerTimeouts` | Time limits in milliseconds by route name, each replacing `handlerTimeoutMs` for its route. |

Source: `packages/core/src/server/types.ts:151`

## Scope

A place to declare routes, hooks, an error handler and plugins; the server is the root scope.

Its methods throw BootError `REGISTRATION_CLOSED` once `listen` is called, or once the plugin that owns it has settled.

```ts
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
```

| Field             | Summary                                                                                                       |
| ----------------- | ------------------------------------------------------------------------------------------------------------- |
| `routes`          | Adds a contract's routes to this scope, with one handler per route.                                           |
| `addHook`         | Adds a hook to this scope; it runs for this scope's routes and its plugins' routes, after its parents' hooks. |
| `setErrorHandler` | Sets this scope's error handler.                                                                              |
| `register`        | Adds a plugin, which `listen` runs in order with a child scope of this one.                                   |

Source: `packages/core/src/server/types.ts:304`

## Server

A service: the root scope, with `listen` and `close`.

```ts
export interface Server extends Scope {
  listen(options: ListenOptions): Promise<ListeningAddress>;
  close(): Promise<void>;
}
```

| Field    | Summary                                                                                           |
| -------- | ------------------------------------------------------------------------------------------------- |
| `listen` | Runs the plugins, checks and compiles every route, then listens; resolves with the bound address. |
| `close`  | Stops accepting connections and resolves once every open one has closed.                          |

Source: `packages/core/src/server/types.ts:363`

## ServerOptions

The options of `createServer`; each number is a positive integer.

`createServer` throws BootError `INVALID_OPTION` for any other value, or for a `headersTimeout` above `requestTimeout`.

```ts
export interface ServerOptions {
  readonly bodyLimit?: number;
  readonly maxParamLength?: number;
  readonly pluginTimeoutMs?: number;
  readonly closeTimeoutMs?: number;
  readonly keepAliveTimeout?: number;
  readonly requestTimeout?: number;
  readonly headersTimeout?: number;
  readonly maxHeaderSize?: number;
  readonly handlerTimeoutMs?: number;
  readonly trustProxy?: readonly string[];
  readonly securityHeaders?: boolean;
}
```

| Field              | Summary                                                                                                     |
| ------------------ | ----------------------------------------------------------------------------------------------------------- |
| `bodyLimit`        | Largest request body accepted, in bytes; a larger one is refused with 413 (default 1 MiB).                  |
| `maxParamLength`   | Longest path parameter accepted, in bytes as received; a longer one is refused with 414 (default 100).      |
| `pluginTimeoutMs`  | Time each plugin has to settle at `listen`, in milliseconds, at most 2 147 483 647 (default 10 000).        |
| `closeTimeoutMs`   | Time `close` waits for open connections before closing them, in ms, at most 2 147 483 647 (default 10 000). |
| `keepAliveTimeout` | Time an idle keep-alive connection stays open, in milliseconds (default 72 000).                            |
| `requestTimeout`   | Time allowed to receive a whole request, in milliseconds (default 300 000).                                 |
| `headersTimeout`   | Time allowed to receive the request headers, in milliseconds; at most `requestTimeout` (default 60 000).    |
| `maxHeaderSize`    | Largest request header block accepted, in bytes; a larger one is refused with 431 (default 16 KiB).         |
| `handlerTimeoutMs` | Time a request has from its route match to its response, in ms, at most 2 147 483 647 (default 30 000).     |
| `trustProxy`       | Proxy addresses and CIDR ranges whose `X-Forwarded-For` sets `clientAddress` (default none).                |
| `securityHeaders`  | Whether responses carry `nosniff`, a frame ban and `cache-control: no-store` unless set (default true).     |

Source: `packages/core/src/server/types.ts:12`

## ValidatedContext

What a `preHandler` hook receives: the request context and the validated parts.

```ts
export interface ValidatedContext extends RequestContext {
  readonly params: unknown;
  readonly query: unknown;
  readonly body: unknown;
}
```

| Field    | Summary                         |
| -------- | ------------------------------- |
| `params` | The validated path parameters.  |
| `query`  | The validated query parameters. |
| `body`   | The validated body.             |

Source: `packages/core/src/server/types.ts:201`

## createServer

Creates a server, the root scope of a service; nothing listens until `listen`.

Throws BootError `INVALID_OPTION` for an option out of range, a `headersTimeout` above `requestTimeout` or a bad `trustProxy`.

```ts
export function createServer(options: ServerOptions = {}): Server;
```

```ts
const server = createServer({ bodyLimit: 65_536 });
await server.listen({ port: 0 });
await server.close();
```

Source: `packages/core/src/server/server.ts:53`
