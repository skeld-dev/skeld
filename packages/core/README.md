# @darkstart/core

A TypeScript framework for services on Node with its own engine, modeled on Fastify, Elysia and Hono where each is right. A service is one typed declaration: its routes, their input and output schemas, and their responses by status. The types flow end to end, from the schema to the handler to the client, with no build step that generates types and no hand-kept `.d.ts`.

The engine is everything above `node:http`: the router, the request lifecycle, plugins, body parsing, validation and serialization compiled from the schema, and errors. Node's HTTP server and parser are the floor and are not rewritten. Schemas are built with the package's own builders from `@darkstart/core/schema` and compiled once when the server starts listening; nothing from a request is ever compiled.

## Install

Requires an ES module project (`"type": "module"` in your `package.json`).

```sh
npm install @darkstart/core
```

The package has no runtime dependency: the server generates its own validators and response serializers from the contract.

### Where each subpath runs

`@darkstart/core/schema`, `/secret`, `/redact`, `/json-schema`, `/contract` and `/client` run on Node 22 and later and in browsers, so one contract file serves the server and its clients. `@darkstart/core/server` needs Node 26.12 or later: it runs on `node:http` and compiles its validators and serializers by code generation at `listen`, so under `node --disallow-code-generation-from-strings` `listen` rejects with `BootError` code `CODEGEN_UNAVAILABLE`. The package's `engines` field (`node >=26.12.0`) covers the whole package: on an older Node, npm prints an engine warning and installs it anyway unless `engine-strict` is set.

## Subpaths

The package has no root export; import each part from its own subpath. Import the builders as one namespace, `import * as t from '@darkstart/core/schema'`, and call them as `t.string(...)`, `t.object(...)`, `t.null()`.

| Import                         | Exports                                                                                                                                                                                                                                  |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@darkstart/core/contract`     | `defineContract`, `errorBodySchema`, and the contract types (`RouteDefinition`, `ContractRoutes`, `ErrorBody`, …)                                                                                                                        |
| `@darkstart/core/http-error`   | `HttpError`, thrown by handlers, the engine and the client                                                                                                                                                                               |
| `@darkstart/core/server`       | `createServer` and the server, scope, handler, hook and plugin types                                                                                                                                                                     |
| `@darkstart/core/boot-error`   | `BootError`, thrown or rejected when a server refuses to start                                                                                                                                                                           |
| `@darkstart/core/client`       | `createClient` and the client types                                                                                                                                                                                                      |
| `@darkstart/core/schema`       | the sixteen builders (`string`, `integer`, `number`, `boolean`, `null`, `literal`, `object`, `array`, `record`, `union`, `optional`, `exposed`, `pick`, `omit`, `partial`, `extend`) and the schema types (`Schema`, `Infer`, `Wire`, …) |
| `@darkstart/core/secret`       | `Secret`, the wrapper a handler receives for a `secret` field, and `expose`, which returns its value                                                                                                                                     |
| `@darkstart/core/redact`       | `redact`, which copies a value with its `secret` and `personal` fields replaced                                                                                                                                                          |
| `@darkstart/core/json-schema`  | `toJsonSchema`, which exports a schema as JSON Schema 2020-12, and the `JsonSchema` type                                                                                                                                                 |
| `@darkstart/core/package.json` | the manifest                                                                                                                                                                                                                             |

## Example

`contract.ts`:

```ts
import { defineContract } from '@darkstart/core/contract';
import * as t from '@darkstart/core/schema';

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
import { createServer } from '@darkstart/core/server';
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

await server.listen({ port: 3000, host: '127.0.0.1' });
process.stdout.write('hello listening on http://127.0.0.1:3000\n');

await Promise.race([once(process, 'SIGINT'), once(process, 'SIGTERM')]);
await server.close();
process.stdout.write('hello stopped\n');
```

`client.ts`:

```ts
import { createClient } from '@darkstart/core/client';
import { helloContract } from './contract.ts';

const client = createClient(helloContract, { baseUrl: 'http://127.0.0.1:3000' });

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

The server prints `hello listening on http://127.0.0.1:3000`. The client prints:

```text
Hello, Ada!
Olá, Ada
```

Node runs the `.ts` files directly by stripping their types. Stop the server with Ctrl-C; it finishes in-flight responses and prints `hello stopped`.

`message` is bounded at 72: the longest reply the handlers build is `Hello, ` (7 UTF-16 code units) plus a name at its `maxLength` of 64 plus `!` (1). Change a handler to return a body without `message`, or `client.ts` to read `greeting.body.message` without checking `status`, and `tsc` reports a type error: the contract types both sides.

## Schemas

### Bounds and their opt-outs

Every `t.string` declares `maxLength`, every `t.array` `maxItems` and every `t.record` `maxProperties`, or carries `unbounded: '<reason>'` instead. A call with neither does not compile, and a schema that gets past the types makes `listen` reject with `BootError` code `UNBOUNDED_FIELD`, naming the route, the part and the JSON pointer of the field. A minimum above its maximum, or a count that is not a non-negative integer, is `INVALID_BOUND` at `listen`, and an empty reason throws a `TypeError` when the builder is called (`t.string: unbounded needs a reason, got an empty string`). Lengths count UTF-16 code units (`value.length`). Objects are closed: a request with an undeclared key at any depth is refused with 400 `VALIDATION` and a detail at the key's path (`is not allowed`). `t.object(properties, { open: '<reason>' })` accepts undeclared keys and drops them before the handler runs. The roots of `query` and `headers` are the exception: parameters and headers the schema does not declare are ignored and are not handed to the handler.

The bounds also limit each route's body size. At `listen` the route's limit becomes the smaller of `bodyLimit` (default 1,048,576 bytes) and twice the largest JSON encoding its body schema admits plus 1,024 bytes, where every string code unit counts as a six-byte `\uXXXX` escape; a larger body is refused with 413 `PAYLOAD_TOO_LARGE` before it is parsed. For the example's `POST /hello` the limit is 1,866 bytes. One `unbounded` or `open` node anywhere in a body schema removes the derived limit for that route, and `bodyLimit` alone applies.

### Secret and personal fields

A schema with `sensitivity: 'secret'` (a password, a token, a key) hands the handler a `Secret<T>` in place of `T`: it is not assignable to `T`, and a template literal, `String()`, `JSON.stringify` and `util.inspect` all give `[secret]`. `expose(value)` from `@darkstart/core/secret` returns the raw value. A response schema that reaches a `secret` field makes `listen` reject with `BootError` code `SECRET_IN_RESPONSE`, unless the field is wrapped `t.exposed(field, '<reason>')`; the handler then returns the raw value, so writing a secret into a response takes an `expose` call in the handler and a `t.exposed` in the contract. A schema with `sensitivity: 'personal'` (an email, a name, an address) stays a plain value in the handler and is allowed in responses. A 400 never names a key or item below a field marked either way: a failure inside it is one detail at the field's path (`is not valid` when the failure is further down). `redact(schema, value)` from `@darkstart/core/redact` returns a copy of the value with each `secret` field replaced by `[secret]` and each `personal` field by `[personal]`, for logs. `toJsonSchema` exports both classes as `x-sensitivity`, and `secret` also as `writeOnly: true`. A record's key schema cannot carry a class; mark the record.

### Composition

`t.pick(model, keys)`, `t.omit(model, keys)`, `t.partial(model, options)` and `t.extend(model, properties)` derive a new closed object from one you declared, when the builder is called. Every property keeps its bounds and its class, and the result keeps the model's `open` and `sensitivity` options. A key the model does not declare in `pick` or `omit`, or a key it already declares in `extend`, is a compile error and a `TypeError` at declaration (`t.extend: key "name" is already declared; omit it first`); to replace a property, `omit` it and then `extend`. `t.partial` makes the top-level properties optional, and its `minProperties` option refuses an empty PATCH body: `t.partial(t.pick(model, ['name', 'email']), { minProperties: 1 })`. Build response schemas with `pick`, not `omit`: a `personal` field added to the model later passes through an `omit` response unnoticed, while a new `secret` field is refused at `listen`.

### Union responses

An object response drops any key the handler returns that its schema does not declare. A union response (`200: t.union([...])`) does not: the value is matched member by member and object members are closed, so a value with an undeclared key matches no member, and the request is answered with the fixed 500 body below and one stderr line. A handler whose response is a union returns only the declared keys, for example by picking them out of a database row.

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

An unknown path gets `{"status":404,"code":"NOT_FOUND","message":"Route GET /nope not found"}`. A handler sends its own error by throwing `new HttpError(status, code, message)` from `@darkstart/core/http-error`. Anything else a handler throws becomes `{"status":500,"code":"INTERNAL","message":"Internal Server Error"}`; the thrown message goes to stderr as one `darkstart: <method> <path> <status> <route>: <message>` line when no `onError` hook is registered, never to the client.

The engine's codes are `BAD_REQUEST`, `VALIDATION`, `NOT_FOUND`, `PAYLOAD_TOO_LARGE`, `URI_TOO_LONG`, `UNSUPPORTED_MEDIA_TYPE` and `INTERNAL`. The client rejects with an `HttpError` whose `status` is `null` and whose `code` is `NETWORK` (no response) or `INVALID_RESPONSE`: for a status the contract declares with a schema, a body that is missing, not JSON or does not pass the schema, with details under `/body`; for any other status, a JSON body that does not parse.

## License

MIT
