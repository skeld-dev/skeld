# @darkstart/core

A TypeScript framework for services on Node with its own engine, modeled on Fastify, Elysia and Hono where each is right. A service is one typed declaration: its routes, their input and output schemas, and their responses by status. The types flow end to end, from the schema to the handler to the client, with no codegen and no hand-kept `.d.ts`.

The engine is everything above `node:http`: the router, the request lifecycle, plugins, body parsing, validation and serialization compiled from the schema, and errors. Node's HTTP server and parser are the floor and are not rewritten. Schemas are [TypeBox](https://github.com/sinclairzx81/typebox) values, compiled once when the server starts listening.

## Install

Requires Node 26.12 or later and an ES module project (`"type": "module"` in your `package.json`).

```sh
npm install @darkstart/core typebox@1.4.3
```

`typebox` is a peer dependency pinned at 1.4.3.

## Subpaths

The package has no root export; import each part from its own subpath.

| Import                         | Exports                                                                                                           |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------- |
| `@darkstart/core/contract`     | `defineContract`, `errorBodySchema`, and the contract types (`RouteDefinition`, `ContractRoutes`, `ErrorBody`, …) |
| `@darkstart/core/http-error`   | `HttpError`, thrown by handlers, the engine and the client                                                        |
| `@darkstart/core/server`       | `createServer` and the server, scope, handler, hook and plugin types                                              |
| `@darkstart/core/boot-error`   | `BootError`, thrown or rejected when a server refuses to start                                                    |
| `@darkstart/core/client`       | `createClient` and the client types                                                                               |
| `@darkstart/core/package.json` | the manifest                                                                                                      |

## Example

`contract.ts`:

```ts
import { Type } from 'typebox';
import { defineContract } from '@darkstart/core/contract';

const Name = Type.String({ minLength: 1, maxLength: 64 });
const Greeting = Type.Object({ message: Type.String() });

export const helloContract = defineContract({
  greet: {
    method: 'GET',
    path: '/hello/:name',
    params: Type.Object({ name: Name }),
    query: Type.Object({ excited: Type.Optional(Type.Boolean()) }),
    responses: { 200: Greeting },
  },
  greetInLanguage: {
    method: 'POST',
    path: '/hello',
    body: Type.Object({ name: Name, language: Type.Union([Type.Literal('en'), Type.Literal('pt')]) }),
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

Change a handler to return a body without `message`, or `client.ts` to read `greeting.body.message` without checking `status`, and `tsc` reports a type error: the contract types both sides.

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
  "details": [
    { "path": "/body/language", "message": "must be equal to constant" },
    { "path": "/body/language", "message": "must match a schema in anyOf" }
  ]
}
```

An unknown path gets `{"status":404,"code":"NOT_FOUND","message":"Route GET /nope not found"}`. A handler sends its own error by throwing `new HttpError(status, code, message)` from `@darkstart/core/http-error`. Anything else a handler throws becomes `{"status":500,"code":"INTERNAL","message":"Internal Server Error"}`; the thrown message goes to stderr as one `darkstart: <method> <path> <status> <route>: <message>` line when no `onError` hook is registered, never to the client.

The engine's codes are `BAD_REQUEST`, `VALIDATION`, `NOT_FOUND`, `PAYLOAD_TOO_LARGE`, `URI_TOO_LONG`, `UNSUPPORTED_MEDIA_TYPE` and `INTERNAL`. The client rejects with an `HttpError` whose `status` is `null` and whose `code` is `NETWORK` (no response) or `INVALID_RESPONSE` (a declared status whose body is not JSON).

## License

MIT
