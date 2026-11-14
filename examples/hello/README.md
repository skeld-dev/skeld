# Hello: a contract, a server, a client

This is the [core reference example](../../docs/reference/core.md#example), kept identical by `pnpm run reference-check`.

From the repository root, after `pnpm install`:

```sh
pnpm --filter @skeld/example-hello run start
```

In a second terminal:

```sh
pnpm --filter @skeld/example-hello run call
```

The client prints:

```text
Hello, Ada!
Olá, Ada
```

Read [contract.ts](contract.ts) first: `greet` declares a path parameter and an optional boolean query; `greetInLanguage` declares a JSON body. Both declare the response. [hello.ts](hello.ts) implements those names, and [client.ts](client.ts) uses the same contract and narrows replies by status.

The server uses default logging: boot, shutdown and author records are visible, but successful requests have no access record. Each response still has `x-request-id`. The [logging example](../logging/README.md) shows how to use it.

Try a value outside the declared language union:

```sh
curl -i http://127.0.0.1:3000/hello \
  -H 'content-type: application/json' \
  --data '{"name":"Ada","language":"xx"}'
```

Expect HTTP 400 with code `VALIDATION`. The handler does not receive the invalid input. The bounded strings also establish a maximum response size: `Hello, ` + 64 name characters + `!` fits the declared 72-character greeting.

Stop the server with Ctrl-C. For custom ports and copying the example into another project, see the [examples guide](../README.md).
