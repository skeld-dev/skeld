# Your first request

Run a small service, call it through its contract, then send input the contract refuses. You need the Node version in [`.nvmrc`](../../.nvmrc), pnpm 12.19.0, and a terminal in the repository root.

This walkthrough uses the checkout, so you can follow it before the package is published. For a separate application, see the [package installation instructions](../../packages/core/README.md#install) once the package is available.

## Start the server and client

Install the workspace dependencies and start hello:

```sh
pnpm install
pnpm --filter @skeld/example-hello run start
```

Leave that terminal running. In a second terminal, from the same repository root:

```sh
pnpm --filter @skeld/example-hello run call
```

The client prints:

```text
Hello, Ada!
Olá, Ada
```

The server binds to `127.0.0.1:3000`. It writes structured startup and author records to its own terminal. Successful requests do not produce access records by default; the absence of such a line does not mean the request failed.

## Read the contract before the implementation

Open [contract.ts](../../examples/hello/contract.ts). It declares two named operations:

| Operation         | HTTP request       | Input                                                                                 | Success body                                      |
| ----------------- | ------------------ | ------------------------------------------------------------------------------------- | ------------------------------------------------- |
| `greet`           | `GET /hello/:name` | Required `name` path string, 1–64 UTF-16 code units; optional boolean query `excited` | HTTP 200: `{ message: string }`, at most 72 units |
| `greetInLanguage` | `POST /hello`      | JSON object with required `name` of 1–64 units and `language` equal to `en` or `pt`   | HTTP 200: the same bounded message object         |

The contract describes the accepted shape; it does not implement a greeting. [hello.ts](../../examples/hello/hello.ts) registers handlers under those operation names. [client.ts](../../examples/hello/client.ts) calls the names without repeating the method, URL pattern, or response type.

The response bound is deliberate: `Hello, ` uses 7 units, the name uses at most 64, and `!` uses 1. The handler's longest reply fits 72. A contract should describe what your implementation can actually return.

## Observe a successful request

You can use any HTTP client; sharing the TypeScript contract is optional for callers. With the server still running:

```sh
curl -i 'http://127.0.0.1:3000/hello/Ada?excited=true'
```

Expect HTTP 200, an `x-request-id` header, and:

```json
{ "message": "Hello, Ada!" }
```

The query arrives over HTTP as text. Because the route declares a boolean query field, the handler receives `true`, not the string `"true"`. JSON body fields use their declared JSON types; this does not make a JSON string interchangeable with a boolean.

## Observe a refusal

Send a language outside the declared union:

```sh
curl -i http://127.0.0.1:3000/hello \
  -H 'content-type: application/json' \
  --data '{"name":"Ada","language":"fr"}'
```

Expect HTTP 400 and this body, formatted here for readability:

```json
{
  "status": 400,
  "code": "VALIDATION",
  "message": "Request validation failed",
  "details": [{ "path": "/body/language", "message": "must match one of the allowed forms" }]
}
```

The route was found, but its input was refused before the handler ran. Change `fr` to `pt` and the request succeeds with `{"message":"Olá, Ada"}`. Add an undeclared property such as `"admin":true` and the closed object schema refuses the request again.

## Make one change

In the example client, change `excited: true` to `excited: 'yes'`, then run:

```sh
pnpm run check
```

TypeScript reports that the call disagrees with the contract. Restore the boolean afterward. The compile-time check helps your own callers; the HTTP refusal protects the service from callers that never ran TypeScript.

Stop the server with Ctrl-C. Its shutdown path calls `server.close()` to drain HTTP work and finish the logger's bounded flush. For a different port, use the matching `PORT` and `BASE_URL` commands in the [examples guide](../../examples/README.md#run-from-this-repository).

**Next:** [design a contract](contracts.md), then [call a service and handle errors](client-and-errors.md).
