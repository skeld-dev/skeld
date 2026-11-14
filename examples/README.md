# Learn skeld by running it

Start with hello, then follow one request through the logging example. The service example shows how to give a feature its own contract, handlers and scope.

For a guided walkthrough and the reasoning behind the APIs, use the [documentation](../docs/README.md). These folders contain the complete programs those guides refer to.

| Example                      | Learn                                                                               | Default port |
| ---------------------------- | ----------------------------------------------------------------------------------- | ------------ |
| [hello](hello/README.md)     | Declare routes once; implement a server and call it with a typed client             | 3000         |
| [logging](logging/README.md) | Follow request IDs, classify log fields, and log a caught error without its message | 3001         |
| [service](service/README.md) | Compose a plugin with scoped hooks, bounded state, declared errors and cleanup      | 3002         |

## Run from this repository

Use the Node version in [`.nvmrc`](../.nvmrc), then run `pnpm install` from the repository root. Each example has two commands: `start` in one terminal and `call` in another. The individual READMEs give the exact commands and expected results. Stop a server with Ctrl-C; it closes through skeld and flushes its logger.

All servers bind to `127.0.0.1`. To choose another port, set `PORT` for the server and the matching `BASE_URL` for the client:

```sh
PORT=3101 pnpm --filter @skeld/example-logging run start
```

In a second terminal:

```sh
BASE_URL=http://127.0.0.1:3101 pnpm --filter @skeld/example-logging run call
```

The servers write JSON log lines; clients print human-readable results in their own terminal. Keep those streams separate when piping server logs to a collector. Access records are enabled in logging and service; hello uses the default, with access records off.

## Read, change, observe

1. Read the contract before the handler. It defines the accepted input and each declared response.
2. Run the client and inspect the server's records.
3. Try the invalid requests in each guide. Check the status and whether the handler's record appears.
4. Change a response body or a client call to disagree with the contract, then run `pnpm run check` to see the type error. Restore the change afterward.

These examples use only Node and public `@skeld/core` imports. They require no database, account, credential or external service. The task store is bounded and temporary; the logging example previews JSON syntax and does not authenticate its demonstration key. Neither is a deployed application with identity or durable storage.

## Copy into your project

Use an ES module project (`"type": "module"`) and install `@skeld/core`. Copy the example's TypeScript files, then run `node server.ts` and `node client.ts` (`hello.ts` for hello). The repository's `skeld-source` condition and relative `tsconfig.json` are development wiring; they are not needed with the installed package. See the [package requirements](../packages/core/README.md#install).

## Keep examples working

```sh
pnpm run examples-check
pnpm run readme-check
```

The first command builds the projects, starts each example on an available local port, runs its client, checks refusal and logging behavior, and closes the servers it started. It leaves existing servers alone. The second keeps hello identical to the package README. These are behavior checks, not benchmarks.
