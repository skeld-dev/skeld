# skeld

[![npm](https://img.shields.io/npm/v/@skeld/core)](https://www.npmjs.com/package/@skeld/core) [![CI](https://github.com/skeld-dev/skeld/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/skeld-dev/skeld/actions/workflows/ci.yml) [![Node](https://img.shields.io/node/v/@skeld/core)](https://nodejs.org/) [![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/) [![License](https://img.shields.io/npm/l/@skeld/core)](LICENSE)

skeld is a TypeScript framework for HTTP services on Node.js 26. You declare each route's inputs and responses once, in a contract. The server validates requests and serializes responses from that contract, and a typed client calls it. It is built for services that handle sensitive data: with `@skeld/auth` each route says who may call it, and values marked `secret` or `personal` are hidden in logs when you log them together with the schema that marks them.

```ts
import { defineContract } from '@skeld/core/contract';
import * as t from '@skeld/core/schema';

export const contract = defineContract({
  greet: {
    method: 'GET',
    path: '/hello/:name',
    params: t.object({ name: t.string({ maxLength: 64 }) }),
    responses: { 200: t.object({ message: t.string({ maxLength: 72 }) }) },
  },
});
```

## Install

```sh
npm install @skeld/core
```

Requires Node.js 26.12 or later and an ES module project (`"type": "module"` in `package.json`).

[Install skeld](docs/guides/install.md) continues from here: it adds a server and a client for the contract above, runs both, and shows the response to a request the contract refuses.

## Packages

| Package          | Does                                                                        | Install                      |
| ---------------- | --------------------------------------------------------------------------- | ---------------------------- |
| `@skeld/core`    | Contracts, schemas, the server, the typed client and logging                | `npm install @skeld/core`    |
| `@skeld/auth`    | Decides who may call each route: sessions, API keys, JWT and OpenID Connect | `npm install @skeld/auth`    |
| `@skeld/openapi` | Writes an OpenAPI 3.1.2 document from a contract, with no server running    | `npm install @skeld/openapi` |

The three packages share one version and are released together. `@skeld/core` has no runtime dependency; `@skeld/auth` and `@skeld/openapi` need only `@skeld/core`.

With `@skeld/auth`, every route must say who may call it, or the server refuses to start. The caller is identified before the request body is read. `@skeld/openapi` stops with an error that says where when it cannot describe something accurately. When the server enforces a rule that OpenAPI has no way to express, it tells you which one.

## Documentation

The documentation is published at [skeld.dev/docs](https://skeld.dev/docs/) and lives in this repository under [`docs/`](docs/README.md).

- [Guides](docs/README.md#learn-the-model): design a contract, handle errors in the client, classify sensitive data, connect a browser, run a service.
- [Add authentication](docs/guides/auth.md), [the application's obligations](docs/guides/auth-obligations.md) and the [auth behavior reference](docs/reference/auth.md).
- [Publish an OpenAPI document](docs/guides/openapi.md) and the [OpenAPI behavior reference](docs/reference/openapi.md).
- [Security boundaries](docs/concepts/security-boundaries.md) and the [threat model](docs/concepts/threat-model.md): what skeld enforces and what your application must supply.
- [API reference](docs/api/README.md) and [logging reference](docs/logging/logging.md).
- [Examples](examples/README.md): hello, classified logging, a service with plugins, [authentication](examples/auth/README.md) and [OpenAPI generation](examples/openapi/README.md).

## Repository

A pnpm workspace. The published packages are `packages/core`, `packages/auth` and `packages/openapi`.

| Path               | What                                                                              |
| ------------------ | --------------------------------------------------------------------------------- |
| `packages/core`    | `@skeld/core`                                                                     |
| `packages/auth`    | `@skeld/auth`                                                                     |
| `packages/openapi` | `@skeld/openapi`                                                                  |
| `docs/`            | [guides, concepts, API and logging references](docs/README.md)                    |
| `examples/`        | runnable [hello, logging, service, auth and openapi examples](examples/README.md) |
| `tests/`           | [correctness checks organized by behavior](tests/README.md)                       |
| `benchmarks/`      | [performance workloads and type-cost fixtures](benchmarks/README.md)              |
| `website/`         | the source of skeld.dev                                                           |
| `tools/`           | repository checks, such as the documentation example checks                       |

## Development

You need Node.js 26.13.0 (the version in `.nvmrc`) and pnpm 12.19.0 (pinned in `package.json`). If you do not have that pnpm version, install it with `npm install --global pnpm@12.19.0 --allow-scripts=pnpm`.

From the repository root:

```sh
pnpm install
pnpm run check
pnpm test
```

`pnpm run check` type-checks and builds every workspace. `pnpm test` builds and runs the correctness checks; `pnpm test security` runs one category.

Source runs without a build step: `node --conditions=skeld-source` resolves each `@skeld` package to its `src` folder, such as `@skeld/core` to `packages/core/src`. To run the hello example that way, start the server in one terminal and the client in a second:

```sh
pnpm --filter @skeld/example-hello run start
pnpm --filter @skeld/example-hello run call
```

Before you open a pull request, also run:

| Command                   | Does                                                |
| ------------------------- | --------------------------------------------------- |
| `pnpm run lint`           | checks formatting and lint rules with Biome         |
| `pnpm run knip`           | finds unused files, exports and dependencies        |
| `pnpm run examples-check` | builds and runs every example against a real server |

[Contributing to skeld](CONTRIBUTING.md) covers focused checks, documentation changes and pull requests. Benchmarks need a quiet machine and have their own [guide](benchmarks/README.md).

## License

[MIT](LICENSE)
