# Skeld

Skeld is a TypeScript framework for services on Node 26: one contract declares each route's schemas, the engine on `node:http` validates and serializes from it, and a typed client calls it.

Start with the [documentation](docs/README.md): run your first request, design a contract, and understand the framework's security boundaries. The [package README](packages/core/README.md) contains installation instructions and a compact feature reference.

## Logging

A server writes structured JSON lines to stdout. The options, the record format, the events and Collector ingestion are documented in [`docs/logging/`](docs/logging/logging.md).

## Repository

An npm workspaces monorepo. Source runs unbuilt with `node --conditions=skeld-source`, which resolves `@skeld/core` to `packages/core/src`.

| Workspace       | What                                                                 |
| --------------- | -------------------------------------------------------------------- |
| `packages/core` | `@skeld/core`, the published package                                 |
| `docs/`         | [guides, concepts, API and logging references](docs/README.md)       |
| `examples/`     | runnable [hello, logging and service examples](examples/README.md)   |
| `benchmarks`    | [performance workloads and type-cost fixtures](benchmarks/README.md) |
| `tests`         | [correctness checks organized by behavior](tests/README.md)          |
| `website`       | [Light website, design system and local preview](website/README.md)  |
| `tools`         | repository tools, such as the README example check                   |

## Development

Requires Node 26.13.0 (`.nvmrc`).

```sh
npm install
```

Run every command from the repository root.

| Command                                                                                                  | Does                                                                                                     |
| -------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `npx tsc -b --force`                                                                                     | type-checks and builds every project                                                                     |
| `npm test`                                                                                               | builds and runs all ordinary correctness checks; `npm test -- security` selects a category               |
| `npx biome check .`                                                                                      | formats and lints                                                                                        |
| `npx knip`                                                                                               | finds unused files, exports and dependencies                                                             |
| `semgrep scan --config p/typescript --config p/nodejs --config .semgrep --metrics=off --error --quiet .` | static analysis                                                                                          |
| `npm audit --omit=dev --workspace @skeld/core`                                                           | audits the published package's dependencies                                                              |
| `node tools/check-readme-example.ts`                                                                     | checks that the package README's example matches `examples/hello` byte for byte                          |
| `npm run examples-check`                                                                                 | builds and runs all examples, checking clients, refusals, logging and graceful shutdown                  |
| `npm publish --dry-run --workspace @skeld/core`                                                          | lists what the package would publish, without publishing                                                 |
| `npm run bench`                                                                                          | builds `packages/core` and runs the benchmark, about 11 minutes; run it with nothing else on the machine |

Run the hello example from source, with the client in a second shell:

```sh
npm run start --workspace @skeld/example-hello
npm run call --workspace @skeld/example-hello
```

Continue with the [logging example](examples/logging/README.md) for classified fields and request IDs, or the
[service example](examples/service/README.md) for plugins, scoped hooks, declared errors and bounded state.

## Contributing

See [Contributing to Skeld](CONTRIBUTING.md) for setup, focused checks, and pull requests. Documentation contributors can follow the [writing guide](docs/maintainers/writing-docs.md).

## License

MIT
