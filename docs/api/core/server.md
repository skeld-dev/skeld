# @skeld/core/server

## Empty

The type of a request part the route does not declare: an object with no keys.

```ts
export interface Empty {
  readonly [key: string]: never;
}
```

Source: `packages/core/src/contract/types.ts:137`

## OutgoingCookie

A cookie a response sets, written as one `Set-Cookie` line; unset attributes take the secure defaults.

An invalid cookie is refused, never encoded: a handler's reply becomes the fixed 500, `setCookie` throws `Error`.

```ts
export interface OutgoingCookie {
  readonly name: string;
  readonly value: string;
  readonly path?: string;
  readonly domain?: string;
  readonly maxAge?: number;
  readonly httpOnly?: boolean;
  readonly secure?: boolean;
  readonly sameSite?: 'Strict' | 'Lax' | 'None';
  readonly partitioned?: boolean;
}
```

| Field         | Summary                                                                                                                              |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `name`        | The name, an HTTP token; a `__Host-` name needs `secure`, path `/` and no domain, a `__Secure-` one `secure`.                        |
| `value`       | The value, sent as given: printable ASCII except space, `"`, `,`, `;` and `\`; name and value fit 4,096 bytes.                       |
| `path`        | The path it is sent back on (default `/`): it starts with `/`, is printable ASCII without `;`, at most 1,024 bytes.                  |
| `domain`      | The domain it is sent back to, widening it to subdomains (default this host only); printable ASCII without `;`, at most 1,024 bytes. |
| `maxAge`      | Its lifetime in whole seconds, from 0 to 34,560,000 (400 days); `0` clears it (default: until the browser closes).                   |
| `httpOnly`    | Whether page scripts are denied it (default true).                                                                                   |
| `secure`      | Whether it is sent only over HTTPS (default true); `sameSite: 'None'` and `partitioned` need it.                                     |
| `sameSite`    | Which cross-site requests carry it (default `Lax`).                                                                                  |
| `partitioned` | Whether it is keyed to the top-level site it was set under (default false).                                                          |

Source: `packages/core/src/contract/types.ts:75`

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

Source: `packages/core/src/contract/types.ts:142`

## RequestPart

The part of a request a route declares a schema for.

```ts
export type RequestPart = 'params' | 'query' | 'headers' | 'cookies' | 'body';
```

Source: `packages/core/src/log/types.ts:43`

## AuthorHeaderName

A header name an author may set: the name itself, or a message type naming it when it is a `ReservedHeaderName`.

```ts
export type AuthorHeaderName<N extends string> = N extends unknown
  ? Lowercase<N> extends ReservedHeaderName
    ? Lowercase<N> extends 'set-cookie'
      ? `${N} is reserved for the engine: use setCookie or the reply's cookies`
      : Lowercase<N> extends CorsHeaderName
        ? `${N} is reserved for the engine: use the cors option`
        : `${N} is reserved for the engine`
    : N
  : never;
```

Source: `packages/core/src/server/types.ts:171`

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
  readonly log: Logger;
  readonly requestId: string;
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
| `log`           | The request's logger, shared with its handler and its other hooks; each record carries `requestId`.   |
| `requestId`     | The request's local id, a version 4 UUID, also sent as the `x-request-id` response header.            |

Source: `packages/core/src/server/types.ts:384`

## CorsHeaderName

A CORS response header name, which only the `cors` option sets.

```ts
export type CorsHeaderName =
  | 'access-control-allow-origin'
  | 'access-control-allow-credentials'
  | 'access-control-expose-headers'
  | 'access-control-allow-methods'
  | 'access-control-allow-headers'
  | 'access-control-max-age';
```

Source: `packages/core/src/server/types.ts:148`

## CorsPolicy

Which browser origins may read a route's responses; it never refuses a request, the cross-site check does.

```ts
export interface CorsPolicy {
  readonly origins: '*' | readonly string[];
  readonly credentials?: boolean;
  readonly allowedHeaders?: readonly string[];
  readonly exposedHeaders?: readonly string[];
  readonly maxAgeSeconds?: number;
}
```

```ts
createServer({ cors: { origins: ['https://app.example'], credentials: true } });
```

| Field            | Summary                                                                                                          |
| ---------------- | ---------------------------------------------------------------------------------------------------------------- |
| `origins`        | The allowed origins, each exactly as `new URL(x).origin` writes it, or `'*'` for any origin without credentials. |
| `credentials`    | Whether a granted response lets the page send and read credentials such as cookies (default false).              |
| `allowedHeaders` | Request header names a preflight allows beyond the route's declared headers and `content-type` (default none).   |
| `exposedHeaders` | Response header names a granted page may read beyond the CORS-safelisted ones (default none).                    |
| `maxAgeSeconds`  | How long a browser may cache a preflight answer, in whole seconds from 0 to 86,400 (default 600).                |

Source: `packages/core/src/server/types.ts:92`

## CsrfPolicy

The cross-site check on unsafe methods: `Origin` against the allowed origins, then `Sec-Fetch-Site`.

```ts
export interface CsrfPolicy {
  readonly mode?: 'baseline' | 'strict';
  readonly trustedOrigins?: readonly string[];
}
```

```ts
createServer({ publicOrigin: 'https://api.example', csrf: { mode: 'strict' } });
```

| Field            | Summary                                                                                                                |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `mode`           | `baseline` passes a request with neither `Origin` nor `Sec-Fetch-Site`; `strict` refuses it (default `baseline`).      |
| `trustedOrigins` | Other origins whose pages may send unsafe requests, besides `publicOrigin`; CORS origins are not added (default none). |

Source: `packages/core/src/server/types.ts:109`

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
  readonly rawCookies: RawCookies;
  readonly log: Logger;
  readonly requestId: string;
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
| `rawCookies`    | The request's cookies as sent; the header is parsed on first read.                                    |
| `log`           | The request's logger, shared with its handler and its other hooks; each record carries `requestId`.   |
| `requestId`     | The request's local id, a version 4 UUID, also sent as the `x-request-id` response header.            |

Source: `packages/core/src/server/types.ts:404`

## ErrorHandler

Turns a thrown value into the `HttpError` written to the client.

The nearest scope's handler runs first and a value it throws goes to the parent's; a result that is not an `HttpError` with a status is written as 500 `INTERNAL`.

```ts
export type ErrorHandler = (error: unknown, context: ErrorContext) => HttpError | Promise<HttpError>;
```

Source: `packages/core/src/server/types.ts:455`

## Handler

The function that serves one route of a contract.

A thrown value goes to the scope's error handlers; with none, an `HttpError` is written as its error body and anything else as 500 `INTERNAL`.

```ts
export type Handler<C extends ContractRoutes, K extends keyof C> = (
  request: RouteRequest<C[K]>,
) => RouteReply<C[K]> | Promise<RouteReply<C[K]>>;
```

Source: `packages/core/src/server/types.ts:251`

## Handlers

One handler per route name of a contract.

```ts
export type Handlers<C extends ContractRoutes> = { readonly [K in keyof C]: Handler<C, K> };
```

Source: `packages/core/src/server/types.ts:256`

## HookName

The hook names `addHook` accepts.

```ts
export type HookName = 'onRequest' | 'preHandler' | 'onSend' | 'onResponse' | 'onError';
```

Source: `packages/core/src/server/types.ts:458`

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

Source: `packages/core/src/server/types.ts:523`

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

Source: `packages/core/src/server/types.ts:512`

## OnErrorHook

A hook that observes a failed request's error before the error handlers run.

It cannot change the reply; a throw is logged as `skeld.hook.error`.

```ts
export type OnErrorHook = (context: ErrorContext, error: unknown) => void | Promise<void>;
```

Source: `packages/core/src/server/types.ts:449`

## OnRequestHook

A hook run after routing and before the body is read.

`context.send` replies and skips the rest of the request; a throw takes the error path.

```ts
export type OnRequestHook = (context: RequestContext) => void | Promise<void>;
```

Source: `packages/core/src/server/types.ts:429`

## OnResponseHook

A hook run once the response is done or its connection closed, to observe the outcome.

A throw is logged as `skeld.hook.error` and changes nothing; it does not run after `send` or a cross-site refusal.

```ts
export type OnResponseHook = (context: CompletedContext) => void | Promise<void>;
```

Source: `packages/core/src/server/types.ts:444`

## OnSendHook

A hook that observes the serialized payload before it is written; it can set headers but never change the payload.

Its return value is ignored; a throw goes to the error path.

```ts
export type OnSendHook = (context: ResponseContext, payload: string) => void | Promise<void>;
```

Source: `packages/core/src/server/types.ts:439`

## OutgoingHeaders

Response headers to set, by name.

A `ReservedHeaderName` (framing, connection, `set-cookie`, `access-control-*`, `x-request-id`) fails to compile as a lower-case key; in any letter case at runtime it is answered with the fixed 500.

```ts
export type OutgoingHeaders = { readonly [name: string]: string | number | readonly string[] } & {
  readonly [K in ReservedHeaderName]?: never;
};
```

Source: `packages/core/src/server/types.ts:185`

## PartKey

The string keys of the schema a route declares for one request part; `never` when it declares none.

```ts
export type PartKey<R extends RouteDefinition, P extends RequestPart> = R extends {
  readonly [Q in P]: infer S extends Schema;
}
  ? keyof Infer<S> & string
  : never;
```

Source: `packages/core/src/server/types.ts:190`

## Plugin

A function that declares routes, hooks and plugins on the child scope it is given; it may be async.

```ts
export type Plugin = (scope: Scope) => void | Promise<void>;
```

Source: `packages/core/src/server/types.ts:503`

## PreHandlerHook

A hook run after every request part is validated and before the handler.

It never runs for a refused request; `context.send` replies and skips the handler.

```ts
export type PreHandlerHook = (context: ValidatedContext) => void | Promise<void>;
```

Source: `packages/core/src/server/types.ts:434`

## RawCookies

A request's cookies exactly as sent: no percent-decoding, no quote removal; names are case-sensitive.

```ts
export interface RawCookies {
  get(name: string): string | undefined;
  getAll(name: string): readonly string[];
}
```

| Field    | Summary                                                                                        |
| -------- | ---------------------------------------------------------------------------------------------- |
| `get`    | Returns the value of a cookie sent exactly once; a name sent twice or never gives `undefined`. |
| `getAll` | Returns every value sent under the name, in the order received; empty when it was not sent.    |

Source: `packages/core/src/server/types.ts:140`

## RawHeaders

Request headers by lower-case name, as the HTTP parser gives them.

```ts
export interface RawHeaders {
  readonly [name: string]: string | readonly string[] | undefined;
}
```

Source: `packages/core/src/server/types.ts:135`

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
| `status`  | The HTTP status, an integer from 200 to 599; any other value makes `send` throw `Error` before anything is set.      |
| `headers` | Headers to set on the reply; a reserved name of `OutgoingHeaders` makes `send` throw `Error` before anything is set. |
| `payload` | The body, written as given; without it the reply has no body.                                                        |

Source: `packages/core/src/server/types.ts:293`

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

Source: `packages/core/src/server/types.ts:506`

## ReservedHeaderName

A response header name the engine owns: framing, connection, `set-cookie`, CORS or `x-request-id`.

```ts
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
```

Source: `packages/core/src/server/types.ts:157`

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
  readonly rawCookies: RawCookies;
  readonly log: Logger;
  readonly requestId: string;
  setHeader<N extends string>(name: AuthorHeaderName<N>, value: string | number | readonly string[]): void;
  setCookie(cookie: OutgoingCookie): void;
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
| `rawCookies`    | The request's cookies as sent; the header is parsed on first read.                                    |
| `log`           | The request's logger, shared with its handler and its other hooks; each record carries `requestId`.   |
| `requestId`     | The request's local id, a version 4 UUID, also sent as the `x-request-id` response header.            |
| `setHeader`     | Sets a header on the response.                                                                        |
| `setCookie`     | Sets a cookie on the response, replacing a pending one of the same name, path and domain.             |
| `send`          | Replies at once; later hooks and the handler do not run.                                              |

Source: `packages/core/src/server/types.ts:303`

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
  readonly rawCookies: RawCookies;
  readonly log: Logger;
  readonly requestId: string;
  readonly status: number;
  setHeader<N extends string>(name: AuthorHeaderName<N>, value: string | number | readonly string[]): void;
  setCookie(cookie: OutgoingCookie): void;
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
| `rawCookies`    | The request's cookies as sent; the header is parsed on first read.                                    |
| `log`           | The request's logger, shared with its handler and its other hooks; each record carries `requestId`.   |
| `requestId`     | The request's local id, a version 4 UUID, also sent as the `x-request-id` response header.            |
| `status`        | The status being written.                                                                             |
| `setHeader`     | Sets a header on the response.                                                                        |
| `setCookie`     | Sets a cookie on the response, replacing a pending one of the same name, path and domain.             |

Source: `packages/core/src/server/types.ts:350`

## RouteReply

What a handler returns: a declared status, its body and optional headers.

Keys the response schema does not declare are not written; an error response the engine writes keeps none of `headers`.

```ts
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
```

Source: `packages/core/src/server/types.ts:228`

## RouteRequest

What a handler receives: the route and its request parts, validated and typed by the contract.

```ts
export interface RouteRequest<R extends RouteDefinition> {
  readonly route: RouteInfo;
  readonly params: R extends { readonly params: infer S extends Schema } ? Infer<S> : Empty;
  readonly query: R extends { readonly query: infer S extends Schema } ? Infer<S> : Empty;
  readonly headers: R extends { readonly headers: infer S extends Schema } ? Infer<S> : RawHeaders;
  readonly cookies: R extends { readonly cookies: infer S extends Schema } ? Infer<S> : Empty;
  readonly body: R extends { readonly body: infer S extends Schema } ? Infer<S> : undefined;
  readonly signal: AbortSignal;
  readonly clientAddress: string;
  readonly rawCookies: RawCookies;
  readonly log: Logger;
  readonly requestId: string;
  classified<P extends RequestPart>(part: P, key?: PartKey<R, P>): Classified;
}
```

| Field           | Summary                                                                                                     |
| --------------- | ----------------------------------------------------------------------------------------------------------- |
| `route`         | The matched route.                                                                                          |
| `params`        | The path parameters, validated and converted to the declared kinds.                                         |
| `query`         | The declared query parameters, validated and converted; undeclared keys are left out.                       |
| `headers`       | The declared headers, validated; every raw header when the route declares none.                             |
| `cookies`       | The declared cookies, validated, with `secret` values wrapped; empty when the route declares none.          |
| `body`          | The parsed and validated body, with `secret` values wrapped in `Secret`.                                    |
| `signal`        | Aborted when the connection closes or the request times out, to stop work no client waits for.              |
| `clientAddress` | The client's IP address: the socket peer, or from `X-Forwarded-For` when the peer is in `trustProxy`.       |
| `rawCookies`    | The request's cookies as sent; the header is parsed on first read.                                          |
| `log`           | The request's logger, one per request and shared with its hooks; each record carries `requestId`.           |
| `requestId`     | The request's local id, a version 4 UUID, also sent as the `x-request-id` response header.                  |
| `classified`    | Pairs a request part, or one declared key of it, with the route's own schema for that part, for a log call. |

Source: `packages/core/src/server/types.ts:197`

## RoutesOptions

The options of `Scope.routes`.

```ts
export interface RoutesOptions<C extends ContractRoutes> {
  readonly bodyLimits?: { readonly [K in keyof C]?: number };
  readonly handlerTimeouts?: { readonly [K in keyof C]?: number };
  readonly redirectOrigins?: readonly string[];
  readonly cors?: CorsPolicy | false;
  readonly csrf?: CsrfPolicy;
  readonly csrfExempt?: readonly (keyof C)[];
}
```

| Field             | Summary                                                                                                          |
| ----------------- | ---------------------------------------------------------------------------------------------------------------- |
| `bodyLimits`      | Body limits in bytes by route name, each replacing `bodyLimit` for its route.                                    |
| `handlerTimeouts` | Time limits in milliseconds by route name, each replacing `handlerTimeoutMs` for its route.                      |
| `redirectOrigins` | Origins an absolute redirect from these routes may name, replacing the server's `redirectOrigins`, never merged. |
| `cors`            | The cross-origin policy of these routes, replacing the server's `cors` whole; `false` turns it off for them.     |
| `csrf`            | The cross-site check of these routes, replacing the server's `csrf` whole, never merged.                         |
| `csrfExempt`      | Route names the cross-site check skips, such as a webhook that proves its sender another way.                    |

Source: `packages/core/src/server/types.ts:259`

## Scope

A place to declare routes, hooks, an error handler and plugins; the server is the root scope.

Its methods throw BootError `REGISTRATION_CLOSED` once `listen` is called, or once the plugin that owns it has settled.

```ts
export interface Scope {
  readonly signal: AbortSignal;
  readonly log: Logger;
  onClose(callback: () => void | Promise<void>): void;
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
| `signal`          | Aborted when shutdown or startup rollback begins; plugins must stop their own asynchronous work.              |
| `log`             | The server's logger, the same in every scope, plugins included; its records carry no request id.              |
| `onClose`         | Registers resource disposal in reverse registration order after transport shutdown, also on failed boot.      |
| `routes`          | Adds a contract's routes to this scope, with one handler per route.                                           |
| `addHook`         | Adds a hook to this scope; it runs for this scope's routes and its plugins' routes, after its parents' hooks. |
| `setErrorHandler` | Sets this scope's error handler.                                                                              |
| `register`        | Adds a plugin, which `listen` runs in order with a child scope of this one.                                   |

Source: `packages/core/src/server/types.ts:464`

## Server

A service: the root scope, with `listen` and `close`.

```ts
export interface Server extends Scope {
  listen(options: ListenOptions): Promise<ListeningAddress>;
  close(): Promise<void>;
  logStats(): LogStats;
}
```

| Field      | Summary                                                                                           |
| ---------- | ------------------------------------------------------------------------------------------------- |
| `listen`   | Runs the plugins, checks and compiles every route, then listens; resolves with the bound address. |
| `close`    | Stops accepting connections and resolves once every open one has closed.                          |
| `logStats` | Returns this server's log counts; never throws, before `listen` and after `close` too.            |

Source: `packages/core/src/server/types.ts:533`

## ServerOptions

The options of `createServer`; each number is a positive integer.

`createServer` throws BootError `INVALID_OPTION` for any other value, or for a `headersTimeout` above `requestTimeout`.

```ts
export interface ServerOptions {
  readonly bodyLimit?: number;
  readonly maxParamLength?: number;
  readonly pluginTimeoutMs?: number;
  readonly pluginCloseTimeoutMs?: number;
  readonly closeTimeoutMs?: number;
  readonly keepAliveTimeout?: number;
  readonly requestTimeout?: number;
  readonly headersTimeout?: number;
  readonly maxHeaderSize?: number;
  readonly handlerTimeoutMs?: number;
  readonly trustProxy?: readonly string[];
  readonly securityHeaders?: boolean;
  readonly redirectOrigins?: readonly string[];
  readonly cors?: CorsPolicy | false;
  readonly publicOrigin?: string | readonly string[];
  readonly csrf?: CsrfPolicy;
  readonly log?: LogOptions | false;
}
```

| Field                  | Summary                                                                                                           |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `bodyLimit`            | Largest request body accepted, in bytes; a larger one is refused with 413 (default 1 MiB).                        |
| `maxParamLength`       | Longest path parameter accepted, in bytes as received; a longer one is refused with 414 (default 100).            |
| `pluginTimeoutMs`      | Time each plugin has to settle at `listen`, in milliseconds, at most 2 147 483 647 (default 10 000).              |
| `pluginCloseTimeoutMs` | Time each registered disposer has to settle, in ms, at most 2 147 483 647 (default 10 000).                       |
| `closeTimeoutMs`       | Time `close` waits for open connections before closing them, in ms, at most 2 147 483 647 (default 10 000).       |
| `keepAliveTimeout`     | Time an idle keep-alive connection stays open, in milliseconds (default 72 000).                                  |
| `requestTimeout`       | Time allowed to receive a whole request, in milliseconds (default 300 000).                                       |
| `headersTimeout`       | Time allowed to receive the request headers, in milliseconds; at most `requestTimeout` (default 60 000).          |
| `maxHeaderSize`        | Largest request header block accepted, in bytes; a larger one is refused with 431 (default 16 KiB).               |
| `handlerTimeoutMs`     | Time a request has from its route match to its response, in ms, at most 2 147 483 647 (default 30 000).           |
| `trustProxy`           | Proxy addresses and CIDR ranges whose `X-Forwarded-For` sets `clientAddress` (default none).                      |
| `securityHeaders`      | Whether responses carry `nosniff`, a frame ban and `cache-control: no-store` unless set (default true).           |
| `redirectOrigins`      | Origins an absolute redirect `Location` may name, each exactly as `new URL(x).origin` writes it (default none).   |
| `cors`                 | The cross-origin policy of every route, unless a `routes()` group sets its own (default none: no CORS header).    |
| `publicOrigin`         | The origins the service is reached at, each exactly as `new URL(x).origin` writes it (default none).              |
| `csrf`                 | The cross-site check on POST, PUT, PATCH and DELETE, unless a `routes()` group sets its own (default `baseline`). |
| `log`                  | The structured log on stdout or a sink; `false` writes no record and calls no sink (default: stdout, no options). |

Source: `packages/core/src/server/types.ts:15`

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

Source: `packages/core/src/server/types.ts:340`

## createServer

Creates a server, the root scope of a service; nothing listens until `listen`.

Throws BootError `INVALID_OPTION` for an option out of range or malformed, or `csrf.mode: 'strict'` without `publicOrigin`.

```ts
export function createServer(options: ServerOptions = {}): Server;
```

```ts
const server = createServer({ bodyLimit: 65_536 });
await server.listen({ port: 0 });
await server.close();
```

Source: `packages/core/src/server/server.ts:63`
