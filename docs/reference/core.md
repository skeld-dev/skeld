# Core behavior reference

A TypeScript framework for services on Node with its own engine, modeled on Fastify, Elysia and Hono where each is right. A service is one typed declaration: its routes, their input and output schemas, and their responses by status. The types flow end to end, from the schema to the handler to the client, with no build step that generates types and no hand-kept `.d.ts`.

The engine is everything above `node:http`: the router, the request lifecycle, plugins, body parsing, validation and serialization compiled from the schema, and errors. Node's HTTP server and parser are the floor and are not rewritten. Schemas are built with the package's own builders from `@skeld/core/schema` and compiled once when the server starts listening; nothing from a request is ever compiled.

For a guided introduction, start with the [documentation](../README.md). It covers [your first request](../guides/first-request.md), [contract design](../guides/contracts.md), [browser configuration](../guides/browser-security.md), and the [security boundaries](../concepts/security-boundaries.md). Exact signatures are in the [API reference](../api/README.md).

## Install

Requires an ES module project (`"type": "module"` in your `package.json`).

```sh
npm install @skeld/core
```

The package has no runtime dependency: the server generates its own validators and response serializers from the contract.

### Where each subpath runs

`@skeld/core/schema`, `/secret`, `/redact`, `/json-schema`, `/contract` and `/client` run on Node 22 and later and in browsers, so one contract file serves the server and its clients. `@skeld/core/server` needs Node 26.12 or later: it runs on `node:http` and compiles its validators and serializers by code generation at `listen`, so under `node --disallow-code-generation-from-strings` `listen` rejects with `BootError` code `CODEGEN_UNAVAILABLE`. The package's `engines` field (`node >=26.12.0`) covers the whole package: on an older Node, npm prints an engine warning and installs it anyway unless `engine-strict` is set.

## Subpaths

The package has no root export; import each part from its own subpath. Import the builders as one namespace, `import * as t from '@skeld/core/schema'`, and call them as `t.string(...)`, `t.object(...)`, `t.null()`.

| Import                     | Exports                                                                                                                                                                                                                                  |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@skeld/core/contract`     | `defineContract`, `errorBodySchema`, and the contract types (`RouteDefinition`, `ContractRoutes`, `ErrorBody`, …)                                                                                                                        |
| `@skeld/core/http-error`   | `HttpError`, thrown by handlers, the engine and the client                                                                                                                                                                               |
| `@skeld/core/server`       | `createServer` and the server, scope, handler, hook and plugin types                                                                                                                                                                     |
| `@skeld/core/worker`       | `createWorker` and the `Worker` and `WorkerOptions` types, for a process that runs plugins with no listener; also the `Plugin`, `Scope` and `RegisterOptions` types                                                                      |
| `@skeld/core/boot-error`   | `BootError`, thrown or rejected when a server refuses to start or a worker refuses `start`                                                                                                                                               |
| `@skeld/core/client`       | `createClient` and the client types                                                                                                                                                                                                      |
| `@skeld/core/schema`       | the sixteen builders (`string`, `integer`, `number`, `boolean`, `null`, `literal`, `object`, `array`, `record`, `union`, `optional`, `exposed`, `pick`, `omit`, `partial`, `extend`) and the schema types (`Schema`, `Infer`, `Wire`, …) |
| `@skeld/core/secret`       | `Secret`, the wrapper a handler receives for a `secret` field, and `expose`, which returns its value                                                                                                                                     |
| `@skeld/core/redact`       | `redact`, which copies a value with its `secret` and `personal` fields replaced                                                                                                                                                          |
| `@skeld/core/json-schema`  | `toJsonSchema`, which exports a schema as JSON Schema 2020-12, and the `JsonSchema` type                                                                                                                                                 |
| `@skeld/core/redirect`     | `checkRedirect`, the engine's check of a redirect target, and its result types                                                                                                                                                           |
| `@skeld/core/log`          | `classified`, which pairs a value with a schema for a log field, and the logger types (`LogOptions`, `Logger`, `LogStats`, …)                                                                                                            |
| `@skeld/core/package.json` | the manifest                                                                                                                                                                                                                             |

## Example

`contract.ts`:

```ts
import { defineContract } from '@skeld/core/contract';
import * as t from '@skeld/core/schema';

const Name = t.string({ minLength: 1, maxLength: 64 });
const Greeting = t.object({ message: t.string({ maxLength: 72 }) });

export const helloContract = defineContract({
  greet: {
    method: 'GET',
    path: '/hello/:name',
    params: t.object({ name: Name }),
    query: t.object({ excited: t.optional(t.boolean()) }),
    responses: { 200: Greeting },
  },
  greetInLanguage: {
    method: 'POST',
    path: '/hello',
    body: t.object({ name: Name, language: t.union([t.literal('en'), t.literal('pt')]) }),
    responses: { 200: Greeting },
  },
});
```

`hello.ts`:

```ts
import { once } from 'node:events';
import { createServer } from '@skeld/core/server';
import { helloContract } from './contract.ts';

const server = createServer();
server.routes(helloContract, {
  greet: ({ params, query }) => ({
    status: 200,
    body: { message: `Hello, ${params.name}${query.excited === true ? '!' : ''}` },
  }),
  greetInLanguage: ({ body }) => ({
    status: 200,
    body: { message: `${body.language === 'pt' ? 'Olá' : 'Hello'}, ${body.name}` },
  }),
});

const address = await server.listen({ port: Number(process.env.PORT ?? 3000), host: '127.0.0.1' });
server.log.info('hello listening', { url: address.url });

await Promise.race([once(process, 'SIGINT'), once(process, 'SIGTERM')]);
server.log.info('hello stopping');
await server.close();
```

`client.ts`:

```ts
import { createClient } from '@skeld/core/client';
import { helloContract } from './contract.ts';

const client = createClient(helloContract, { baseUrl: process.env.BASE_URL ?? 'http://127.0.0.1:3000' });

const greeting = await client.greet({ params: { name: 'Ada' }, query: { excited: true } });
const reply = await client.greetInLanguage({ body: { name: 'Ada', language: 'pt' } });

if (greeting.status === 200 && reply.status === 200) {
  process.stdout.write(`${greeting.body.message}\n${reply.body.message}\n`);
} else {
  process.stderr.write(`hello client: unexpected status (greet ${greeting.status}, greetInLanguage ${reply.status})\n`);
  process.exitCode = 1;
}
```

Put the three files in one folder of your project and run the server, then the client in a second shell:

```sh
node hello.ts
node client.ts
```

The server writes its records to stdout as JSON lines: `skeld.server.listening`, then its own `hello listening` record. The client prints:

```text
Hello, Ada!
Olá, Ada
```

Node runs the `.ts` files directly by stripping their types. Stop the server with Ctrl-C; it logs `hello stopping`, finishes in-flight responses and writes `skeld.server.closed`.

`PORT` overrides the server's default port; set the client's `BASE_URL` to match. For runnable examples of logging and a
service organized into a plugin, see the [examples guide](../../examples/README.md).

`message` is bounded at 72: the longest reply the handlers build is `Hello, ` (7 UTF-16 code units) plus a name at its `maxLength` of 64 plus `!` (1). Change a handler to return a body without `message`, or `client.ts` to read `greeting.body.message` without checking `status`, and `tsc` reports a type error: the contract types both sides.

## Schemas

### Bounds and their opt-outs

Every `t.string` declares `maxLength`, every `t.array` `maxItems` and every `t.record` `maxProperties`, or carries `unbounded: '<reason>'` instead. A call with neither does not compile, and a schema that gets past the types makes `listen` reject with `BootError` code `UNBOUNDED_FIELD`, naming the route, the part and the JSON pointer of the field. A minimum above its maximum, or a count that is not a non-negative integer, is `INVALID_BOUND` at `listen`, and an empty reason throws a `TypeError` when the builder is called (`t.string: unbounded needs a reason, got an empty string`). Lengths count UTF-16 code units (`value.length`). Objects are closed: a request with an undeclared key at any depth is refused with 400 `VALIDATION` and a detail at the key's path (`is not allowed`). `t.object(properties, { open: '<reason>' })` accepts undeclared keys and drops them before the handler runs. The roots of `query` and `headers` are the exception: parameters and headers the schema does not declare are ignored and are not handed to the handler.

The bounds also limit each route's body size. At `listen` the route's limit becomes the smaller of `bodyLimit` (default 1,048,576 bytes) and twice the largest JSON encoding its body schema admits plus 1,024 bytes, where every string code unit counts as a six-byte `\uXXXX` escape; a larger body is refused with 413 `PAYLOAD_TOO_LARGE` before it is parsed. For the example's `POST /hello` the limit is 1,866 bytes. One `unbounded` or `open` node anywhere in a body schema removes the derived limit for that route, and `bodyLimit` alone applies.

Arrays and objects in a JSON body nest at most 64 deep. Deeper text is refused with 400 `BAD_REQUEST` (`Request body is nested too deeply`) before it is parsed, brackets inside strings not counted, and a body or response schema whose values could nest deeper makes `listen` reject with `BootError` code `NESTED_TOO_DEEP`. `createClient` throws `TypeError` for such a schema, and a call rejects a JSON response nested deeper with `INVALID_RESPONSE`.

### Secret and personal fields

A schema with `sensitivity: 'secret'` (a password, a token, a key) hands the handler a `Secret<T>` in place of `T`: it is not assignable to `T`, and a template literal, `String()`, `JSON.stringify` and `util.inspect` all give `[secret]`. `expose(value)` from `@skeld/core/secret` returns the raw value. A response schema that reaches a `secret` field makes `listen` reject with `BootError` code `SECRET_IN_RESPONSE`, unless the field is wrapped `t.exposed(field, '<reason>')`; the handler then returns the raw value, so writing a secret into a response takes an `expose` call in the handler and a `t.exposed` in the contract. A schema with `sensitivity: 'personal'` (an email, a name, an address) stays a plain value in the handler and is allowed in responses. A 400 never names a key or item below a field marked either way: a failure inside it is one detail at the field's path (`is not valid` when the failure is further down). `redact(schema, value)` from `@skeld/core/redact` returns a copy of the value with each `secret` field replaced by `[secret]` and each `personal` field by `[personal]`, for logs. `toJsonSchema` exports both classes as `x-sensitivity`, and `secret` also as `writeOnly: true`. A record's key schema cannot carry a class; mark the record.

### Composition

`t.pick(model, keys)`, `t.omit(model, keys)`, `t.partial(model, options)` and `t.extend(model, properties)` derive a new closed object from one you declared, when the builder is called. Every property keeps its bounds and its class, and the result keeps the model's `open` and `sensitivity` options. A key the model does not declare in `pick` or `omit`, or a key it already declares in `extend`, is a compile error and a `TypeError` at declaration (`t.extend: key "name" is already declared; omit it first`); to replace a property, `omit` it and then `extend`. `t.partial` makes the top-level properties optional, and its `minProperties` option refuses an empty PATCH body: `t.partial(t.pick(model, ['name', 'email']), { minProperties: 1 })`. Build response schemas with `pick`, not `omit`: a `personal` field added to the model later passes through an `omit` response unnoticed, while a new `secret` field is refused at `listen`.

### Union responses

An object response drops any key the handler returns that its schema does not declare. A union response (`200: t.union([...])`) does not: the value is matched member by member and object members are closed, so a value with an undeclared key matches no member, and the request is answered with the fixed 500 body below and a `skeld.request.error` record with reason `response_mismatch`. A handler whose response is a union returns only the declared keys, for example by picking them out of a database row.

## Timeouts, client address and headers

`handlerTimeoutMs` in the server options (default 30,000) starts when a request first waits for body data or an application promise. The same deadline covers subsequent waits in `onRequest`, the body read, `preHandler`, the handler, `onSend` and error handling; it does not restart at each stage. Synchronous work before the first wait is not counted, and synchronous work at any stage cannot be interrupted. Past it the request is answered 503 `TIMEOUT` with `connection: close`, `request.signal` (and every hook context's `signal`) is aborted, and whatever the handler returns later is dropped. No `onError` hook or error handler is started for a timeout, and an error path the timeout interrupts calls no further hook or handler; a `skeld.request.error` record with reason `timeout` records it. The check runs every tenth of the shortest limit, and never more often than every 10 ms, so, while the event loop remains available, the check adds at most a tenth of the shortest limit or 10 ms, whichever is greater, plus scheduling delay. Each limit is at most 2,147,483,647 ms, Node's timer maximum, as are `pluginTimeoutMs` and `closeTimeoutMs`. `handlerTimeouts` in the options of `routes` sets a route's own limit, in either direction:

```ts
server.routes(contract, handlers, { handlerTimeouts: { hello: 2_000 } });
```

`request.clientAddress` and `clientAddress` on every hook context is the socket's peer address. Behind a proxy, list the proxy's addresses or CIDR ranges in `trustProxy` (default none): when the peer is on the list, `X-Forwarded-For` is read right to left, trusted entries are skipped, and the first address that is not trusted is the client. An entry that is not a plain IP address ends the walk at the last address read, at most 32 entries are read, and a peer not on the list is used as it is whatever the header says. `createServer` refuses with `INVALID_OPTION` a malformed entry, an entry with a zone id, and a zero-length prefix such as `0.0.0.0/0`, which would trust every peer and so hand the client's own leftmost entry the address.

Every response the engine writes carries `x-content-type-options: nosniff`, `content-security-policy: frame-ancestors 'none'`, `x-frame-options: DENY` and `cache-control: no-store`, unless the handler or a hook set that header itself, in which case its value is sent. An error the engine writes clears the author's headers first, so it always carries all four. `securityHeaders: false` sends none of them. The 400, 408 and 431 that Node writes itself below the engine carry none.

## Redirects and cookies

The engine checks the final `Location` of every 3xx response, whichever of the handler's `headers`, a hook's `setHeader` or a hook's `send` set it. A value that starts with `/` must stay on this service: `//host`, `/\host`, `/<tab>/host` and `/.//host` are refused, as is any value starting with `//`. Any other value must be an absolute `http` or `https` URL with no username or password whose origin is listed in `redirectOrigins`, exactly as `new URL(x).origin` writes it: `https://id.example.com` allows neither `http://id.example.com`, another port nor a subdomain. Whitespace around the value, a control character or a backslash anywhere are refused first. A refused redirect is answered with the fixed 500 body and a `skeld.request.error` record with reason `redirect_refused`; neither holds the target. `publicOrigin` is not a redirect origin: an absolute redirect to the service's own origin needs that origin in `redirectOrigins`, while a local path needs nothing. `redirectOrigins` in the server options applies to every route (default none); in the options of `routes` it replaces the server's list for those routes, never adding to it. A 201's `Location` is not checked. `checkRedirect` from `@skeld/core/redirect` gives the engine's verdict for a value.

`request.rawCookies`, and `rawCookies` on the `onRequest`, `preHandler`, `onSend` and `onError` contexts, reads the `Cookie` header exactly as sent: no percent-decoding, no quote removal, names case-sensitive. `get(name)` returns a value only when the name was sent once, so a second cookie of the same name, such as one a sibling subdomain planted, makes it read as absent; `getAll(name)` returns every value in order. The header is parsed once per request, on first read. A route can also declare `cookies: t.object({ ... })` in its contract: the declared cookies are validated like headers and arrive typed on `request.cookies`, other cookies are ignored, and a declared name sent twice is a 400. A declared name must be an HTTP token. The typed client sends no cookies.

A handler sets cookies with `cookies: [{ name, value }]` in its reply, and a hook with `context.setCookie({ name, value })`. Each is written as its own `Set-Cookie` line with `Path=/`, `HttpOnly`, `Secure` and `SameSite=Lax` unless set otherwise; a later cookie with the same name, path and domain replaces the earlier one, and `maxAge: 0` clears a cookie. A value with a character outside the cookie-octet set (space, `"`, `,`, `;`, `\` or a non-ASCII character) is refused rather than encoded, as are a `__Host-` or `__Secure-` name without what its prefix needs, `SameSite=None` or `partitioned` without `secure`, a `maxAge` that is not a whole number from 0 to 400 days, a `path` that does not start with `/`, a `path` or `domain` over 1,024 bytes, and a name and value over 4,096 bytes: an invalid cookie in a reply is answered with the fixed 500, and `setCookie` throws. `set-cookie` is a reserved header name. Cookies set before a failure are dropped from the error response; an error thrown as `new HttpError(401, 'UNAUTHORIZED', 'Sign in', { cookies: [{ name: 'sid', value: '', maxAge: 0 }] })` carries exactly the cookies it names.

## Browsers on other origins: CORS and the cross-site check

`cors` in the server options says which browser origins may read a route's responses (default none: no `access-control-*` header is ever sent and every `OPTIONS` is a 404). In the options of `routes` it replaces the server's policy for those routes whole, never merging with it, and `cors: false` turns it off for them:

```ts
const server = createServer({
  publicOrigin: 'https://api.example.com',
  cors: { origins: ['https://app.example.com'], credentials: true, exposedHeaders: ['x-request-id'] },
  csrf: { trustedOrigins: ['https://app.example.com'] },
});
server.routes(publicContract, publicHandlers, { cors: { origins: '*' } });
```

Each origin is written exactly as `new URL(x).origin` gives it and compared as an exact string. A request whose `Origin` is on the list gets `access-control-allow-origin` with that origin, `access-control-allow-credentials: true` when `credentials` is set, and `access-control-expose-headers` when `exposedHeaders` is set; under a list every response of the route carries `Origin` in `vary`, added to any `vary` the application set. Under `'*'` every response carries `access-control-allow-origin: *` and no `vary`. An origin that is not allowed gets no grant, and the request still runs: CORS only decides what a page may read. The errors of a routed request (a 400, a thrown 401, a 413, the fixed 500, a 503 timeout) carry the same grant as its success would; a 404 and the refusals before routing carry none. `createServer` and `routes` refuse with `INVALID_OPTION` a malformed origin, an empty list, `'*'` with `credentials`, a header name that is not an HTTP token, and a `maxAgeSeconds` that is not a whole number from 0 to 86,400 (default 600).

A preflight (`OPTIONS` with `Origin` and `Access-Control-Request-Method`) is answered by the route the requested method and path name, before any hook: 204 with the grant, `access-control-allow-methods` set to the requested method, `access-control-allow-headers` set to the route's declared header names, `content-type` when it has a body and the policy's `allowedHeaders`, and `access-control-max-age`. The requested headers are never echoed. An origin the route does not allow is answered 403 `CROSS_ORIGIN`; a path or method with no route, or a route with no policy, is answered 404 as any unrouted request is. The six `access-control-*` response headers are reserved: setting one in a reply, `setHeader` or `send` fails to compile as a literal and throws at runtime in any letter case, with or without a policy.

Every POST, PUT, PATCH and DELETE route is checked for cross-site requests after routing and before the first `onRequest` hook (`csrf.mode` `baseline`, on by default). GET, HEAD and OPTIONS are never checked. The allowed origins are `publicOrigin` plus `csrf.trustedOrigins`; `cors.origins` are not among them, so a browser application on another origin must be listed in both. In order:

| `Origin`                         | `Sec-Fetch-Site`         | Result                                |
| -------------------------------- | ------------------------ | ------------------------------------- |
| an allowed origin                | any                      | passes                                |
| any other value, `null` included | `same-origin`            | passes                                |
| any other value, `null` included | anything else, or absent | 403                                   |
| absent                           | `same-origin` or `none`  | passes                                |
| absent                           | anything else            | 403                                   |
| absent                           | absent                   | passes in `baseline`, 403 in `strict` |

A refusal is a fixed 403 `{"status":403,"code":"CROSS_ORIGIN","message":"Cross-origin request refused"}` with `connection: close`; no hook, error handler or handler runs. When a request is refused because it has `Origin`, no `Sec-Fetch-Site` and no `publicOrigin` is set, one `skeld.config.public_origin` record per server says that origin verification needs `publicOrigin`. `csrf` in the options of `routes` replaces the server's whole, never merged; when the server's mode is `strict`, a group's `csrf` must state its `mode`, or `listen` refuses it with `INVALID_OPTION`, so a group cannot fall back to `baseline` unnoticed. `csrfExempt: ['routeName']` skips the check for those routes (an unknown name is refused). There is no option that turns the check off for the whole server. `mode: 'strict'` without `publicOrigin` is refused with `INVALID_OPTION`.

What this means in practice:

- Browsers send `Sec-Fetch-Site` only to `https` and `localhost`. A page served over plain `http` from another host sends only `Origin`, so it needs `publicOrigin`, for example `publicOrigin: 'http://192.168.1.20:3000'`.
- Behind a reverse proxy that terminates TLS, `publicOrigin` is the public `https` origin, not the address the service listens on.
- A list (`publicOrigin: ['https://example.com', 'https://www.example.com']`) covers a service reached under more than one name.
- Node's `fetch` sends neither header, so `baseline` passes the typed client from Node and `strict` refuses it.
- A webhook sends neither header and passes `baseline`; it still needs its own signature check, or `csrfExempt` and that check under `strict`.

## Errors

Every error the engine sends has one JSON shape, `{ status, code, message, details? }`. A request that fails its schema gets a 400 with one detail per failure (the wire body is one line; it is formatted here):

```sh
curl -s -X POST -H 'content-type: application/json' -d '{"name":"Ada","language":"fr"}' http://127.0.0.1:3000/hello
```

```json
{
  "status": 400,
  "code": "VALIDATION",
  "message": "Request validation failed",
  "details": [{ "path": "/body/language", "message": "must match one of the allowed forms" }]
}
```

No message holds a value the client sent. A JSON body that holds an own `__proto__` key, or a `constructor` key whose value holds an own `prototype` key, at any depth, is refused by the body reader with 400 `BAD_REQUEST` and no `details` before validation runs (`Request body contains a forbidden key: __proto__`). A body schema that declares a property so named can therefore never be satisfied by a request.

An unknown path gets `{"status":404,"code":"NOT_FOUND","message":"Route GET /nope not found"}`. A handler sends its own error by throwing `new HttpError(status, code, message)` from `@skeld/core/http-error`. Anything else a handler throws becomes `{"status":500,"code":"INTERNAL","message":"Internal Server Error"}`; the request's `skeld.request.error` record carries the error's listed class and code, and its message only with the `errorText` log option; nothing of it goes to the client.

The engine's codes are `BAD_REQUEST`, `VALIDATION`, `NOT_FOUND`, `PAYLOAD_TOO_LARGE`, `URI_TOO_LONG`, `UNSUPPORTED_MEDIA_TYPE`, `CROSS_ORIGIN`, `TIMEOUT` and `INTERNAL`. The client rejects with an `HttpError` whose `status` is `null` and whose `code` is `NETWORK` (no response), `INVALID_RESPONSE`, `RESPONSE_TOO_LARGE` or `REDIRECT_NOT_SUPPORTED`. `INVALID_RESPONSE` means, for a status the contract declares with a schema, a body that is missing, not JSON or does not pass the schema, with details under `/body`; for any other status, a JSON body that does not parse. `RESPONSE_TOO_LARGE` means the body passed the call's limit, counted in decoded bytes as it arrives and checked first against `Content-Length`: for a declared status, twice the largest JSON encoding its schema admits plus 1,024 bytes, and 1,048,576 bytes for an `unbounded` or `open` schema or any other status. `maxResponseBytes` in the client options replaces every limit. `REDIRECT_NOT_SUPPORTED` means the server answered 301, 302, 303, 307 or 308: the client never follows a redirect, cancels the body unread, and its message holds the method, origin and declared path but never the `Location` value; in a browser, where the redirect's status is hidden, the message gives no status. A route that declares one of those five statuses therefore cannot be received through the typed client. 304 and every other 3xx status are read like any other response.

## Logging

The server writes structured records as JSON lines to stdout, one per line, or hands them to a `sink` given in the `log` server option. With no option it writes the server's start and stop, the engine's error records and the refusals at `warn`; the access log, inbound correlation headers, the client address and error text each need an option. Every request the engine answers carries an `x-request-id` response header, and the request's records carry the same id. `server.log`, `request.log` and `log` on every hook context and plugin scope are loggers with one method per severity; `server.logStats()` returns the server's record counts. Records can be dropped when the destination falls behind or fails, and every drop is counted.

The reference is in [`docs/logging/`](../logging/logging.md): the options and guarantees, the [record format](../logging/record-format.md), the [events](../logging/events.md), [errors in records](../logging/errors.md) and [ingestion with the OpenTelemetry Collector](../logging/collector.md).

## Plugin resource ownership

Register `scope.onClose(() => resource.close())` immediately after acquiring a resource, before another await. `scope.signal` aborts when shutdown or failed-boot rollback begins. After HTTP draining on a server, and directly on a worker, cleanup runs once in reverse registration order. Each callback has its own `pluginCloseTimeoutMs` deadline (default 10,000 ms, maximum 2,147,483,647). Every callback is attempted; `close()` rejects with an `AggregateError` if any fails or times out. Repeated calls share the completion. Failed startup preserves its original error with rollback failures attached.

Closing during startup prevents subsequent plugins and binding, waits for the current plugin within its boot deadline, and unwinds resources. Plugins and cleanup callbacks must cooperate with cancellation: a timeout cannot terminate arbitrary JavaScript or reclaim resources acquired after a plugin has timed out. Total cleanup time can grow with callback count. Registration after scope sealing is refused.

`scope.closeTimeoutMs` is the time each `onClose` callback has to settle: the server's `pluginCloseTimeoutMs`, read by a cleanup that splits its time into steps. It is not the server option `closeTimeoutMs`, which bounds how long `close` waits for open HTTP connections.

`scope.event(name, severity)` registers a security event and returns its writer, `(log, fields?) => void`, which writes a record in category `security` at that severity through the given logger. A name is two or more lower-case words of letters, digits and `_`, joined by `.`, at most 64 characters, and not starting with `skeld.`; the severity is `debug`, `info`, `warn`, `error` or `fatal`. Registering a name again with the same severity returns the same writer; with another severity, an invalid name, or a 65th name, it throws `TypeError`. A server's scopes share one set of 64 names, apart from a gate's.

`scope.onRoutes(callback)` registers a callback that `listen` calls once, after every plugin and the gate's boot have settled and before any route is bound, with a frozen list of the `RouteInfo` (`name`, `method`, `path`) of every route the scope's hooks reach: its own routes, then its plugins', in registration order. On the server that is every route. A throw or a returned value other than `undefined` makes `listen` reject with `BootError` `PLUGIN_FAILED` and the message `Server failed in onRoutes: <message>`, or `Plugin <name> failed in onRoutes: <message>` on a plugin's scope. Like every registration, `event` and `onRoutes` throw `REGISTRATION_CLOSED` once the scope is sealed. On a [worker](#workers-plugins-without-a-listener), `start` calls each callback once with an empty frozen list.

## Workers: plugins without a listener

`createWorker` from `@skeld/core/worker` runs plugins and a gate in a process that serves no request, such as a migration script or a queue consumer. The framework opens no listening socket for a worker: it constructs no `node:http` server and loads no module that does.

```ts
import { createWorker } from '@skeld/core/worker';

const worker = createWorker();
worker.register(
  (scope) => {
    scope.log.info('plugin booted');
  },
  { name: 'hello' },
);
await worker.start();
try {
  worker.log.info('work runs here');
} finally {
  await worker.close();
}
```

Its stdout holds four records in this order: the plugin's `plugin booted`, `skeld.worker.started`, `work runs here` and `skeld.worker.closed`. The process then exits by itself. A worker never writes a `skeld.server.*` record.

### Options and members

`createWorker` reads five options, each with the type, default and limits of the server option of the same name: `gate`, `log`, `publicOrigin`, `pluginTimeoutMs` and `pluginCloseTimeoutMs`. Another key fails to compile and is ignored at run time. A value `createServer` refuses throws `BootError` `INVALID_OPTION` with the same message, which calls it a server option: `Invalid server option pluginTimeoutMs: must be a positive integer up to 2147483647, got 0`.

A worker has nine members: `signal`, `log`, `closeTimeoutMs`, `event`, `onClose` and `register` behave as on a server's root scope, and `start`, `close` and `logStats` are its own. It has no `routes`, `addHook`, `setErrorHandler`, `onRoutes` or `listen`: a call to one fails to compile, and in JavaScript it throws `TypeError` because the member does not exist. A plugin still receives a full `Scope`, so a plugin written for a server registers on a worker unchanged. Hooks and an error handler that a plugin sets are kept and never run; a route a plugin declares refuses `start`.

### What `start` does

In this order:

1. Seals the worker: `register`, `onClose` and `event` on it now throw `BootError` `REGISTRATION_CLOSED` (`Cannot call register() after start() was called`).
2. Runs the plugins in registration order, each plugin's own plugins after it, each under `pluginTimeoutMs`.
3. Rejects if `close` was called meanwhile.
4. Rejects if any plugin declared a route, naming the first one: a scope's own routes, then each of its plugins', depth-first. The gate has not booted.
5. Boots the gate, when there is one, under `pluginTimeoutMs`. `@skeld/auth`'s gate boots as it does under `listen`.
6. Rejects if `close` was called meanwhile.
7. Calls every `onRoutes` callback once with an empty frozen list.

Then it writes `skeld.worker.started` and resolves with `undefined`. It binds no route and compiles no schema. Once it resolves, the framework holds no timer or handle of its own: the process stays alive only for what your plugins and code hold open, such as a database pool.

### Refusals

| Call                           | When                                                          | Result                                                                                                                                                       |
| ------------------------------ | ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `createWorker`                 | an option out of range, a malformed gate                      | throws `BootError` `INVALID_OPTION`, as `createServer` does                                                                                                  |
| `register`, `onClose`, `event` | after `start` or `close` was called                           | throws `REGISTRATION_CLOSED`                                                                                                                                 |
| `start`                        | a second call                                                 | rejects `ALREADY_STARTED` (`start() was already called`); no plugin runs again                                                                               |
| `start`                        | after `close`                                                 | rejects `SERVER_CLOSED` (`start() was called after close()`)                                                                                                 |
| `start`                        | a plugin throws or passes `pluginTimeoutMs`                   | rejects `PLUGIN_FAILED` or `PLUGIN_TIMEOUT`, with `plugin` set                                                                                               |
| `start`                        | a plugin declared a route                                     | rejects `ROUTE_WITHOUT_LISTENER` (`Route <name> (<METHOD> <path>): registered on a worker, which serves no route`), with `route` and `plugin` set            |
| `start`                        | the gate's boot throws, refuses or passes `pluginTimeoutMs`   | rejects `GATE_FAILED`                                                                                                                                        |
| `start`                        | an `onRoutes` callback throws or returns a value              | rejects `PLUGIN_FAILED`; a `limitRoutes` rule from `@skeld/data/limit` lands here, since a worker serves no route                                            |
| `start`                        | `close` is called while it runs                               | rejects `SERVER_CLOSED` (`Server closed during startup`, or `Server closed during plugin boot` between plugins) once the running plugin settles or times out |
| `close`                        | an `onClose` callback throws or passes `pluginCloseTimeoutMs` | rejects `AggregateError` (`Server shutdown failed`) after every other callback ran                                                                           |

A rejected `start` has already closed the worker, so every `onClose` registered so far has run; when that close fails too, the `BootError` carries both failures in its `cause`, as under `listen`. `ROUTE_WITHOUT_LISTENER` and `ALREADY_STARTED` are a worker's own codes. The other messages say "server" because a worker shares them with a server.

### `close` and the limits

`close` aborts `signal`, waits for a running `start` to settle, runs the `onClose` callbacks in reverse registration order, writes `skeld.worker.closed` with the same counts `skeld.server.closed` carries, and flushes the log for at most `log.flushTimeoutMs`. Every call returns the same promise. There is no transport to drain.

Two limits bound a worker: `pluginTimeoutMs` for each plugin and for the gate's boot, and `pluginCloseTimeoutMs` for each `onClose` callback, each 10,000 ms by default and at most 2,147,483,647. Nothing bounds `start` or `close` as a whole, and nothing is retried: a worker that failed or closed is finished.

The framework adds no listener for SIGTERM, SIGINT, `exit` or `uncaughtException`. A long-running worker wires those signals to `worker.close()` itself, or a SIGTERM ends the process without running any `onClose` callback. See [Run a service](../guides/running-a-service.md#run-a-process-with-no-listener).

## Additional boundary behavior

Static dot segments and backslashes in declared paths are rejected. Handler and route-limit maps use only own properties. Schema builders capture child values once into owned frozen maps; caller-owned maps remain mutable. Widened sensitivity options infer raw-or-Secret values, requiring narrowing. Failed classified unions report a generic union-level issue. Framework error targets use route templates; public request context paths remain concrete. Diagnostic format version 2 uses route ids joined through the run route table, preserving repeated route names.

## License

MIT
