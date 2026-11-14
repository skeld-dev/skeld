# skeld

skeld is a TypeScript framework for services on Node 26: one contract declares each route's schemas, the engine on `node:http` validates and serializes from it, and a typed client calls it.

Start with the [documentation](docs/README.md): run your first request, design a contract, and understand the framework's security boundaries. The [package README](packages/core/README.md) contains installation instructions and a compact feature reference.

## Logging

A server writes structured JSON lines to stdout. The options, the record format, the events and Collector ingestion are documented in [`docs/logging/`](docs/logging/logging.md).

## Repository

A pnpm workspaces monorepo. Source runs unbuilt with `node --conditions=skeld-source`, which resolves `@skeld/core` to `packages/core/src`.

| Workspace       | What                                                                 |
| --------------- | -------------------------------------------------------------------- |
| `packages/core` | `@skeld/core`, the published package                                 |
| `docs/`         | [guides, concepts, API and logging references](docs/README.md)       |
| `examples/`     | runnable [hello, logging and service examples](examples/README.md)   |
| `benchmarks`    | [performance workloads and type-cost fixtures](benchmarks/README.md) |
| `tests`         | [correctness checks organized by behavior](tests/README.md)          |
| `website`       | [Marketing and documentation website](website/)                      |
| `tools`         | repository tools, such as the README example check                   |

## Development

Requires Node 26.13.0 (`.nvmrc`) and pnpm 12.19.0 (pinned in `package.json`). Install that pnpm version with `npm install --global pnpm@12.19.0 --allow-scripts=pnpm` if needed.

```sh
pnpm install
```

Run every command from the repository root. `pnpm-workspace.yaml` defines the workspaces; `pnpm-lock.yaml` is the only dependency lockfile. Use `pnpm install --frozen-lockfile` for CI and reproducible installs. Internal packages use `workspace:*` to require the local checkout.

| Command                                                                                                  | Does                                                                                                     |
| -------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `pnpm exec tsc -b --force`                                                                               | type-checks and builds every project                                                                     |
| `pnpm test`                                                                                              | builds and runs all ordinary correctness checks; `pnpm test security` selects a category                 |
| `pnpm exec biome check .`                                                                                | formats and lints                                                                                        |
| `pnpm exec knip`                                                                                         | finds unused files, exports and dependencies                                                             |
| `semgrep scan --config p/typescript --config p/nodejs --config .semgrep --metrics=off --error --quiet .` | static analysis                                                                                          |
| `pnpm audit --prod`                                                                                      | audits production dependencies across the workspace                                                      |
| `node tools/check-readme-example.ts`                                                                     | checks that the package README's example matches `examples/hello` byte for byte                          |
| `pnpm run examples-check`                                                                                | builds and runs all examples, checking clients, refusals, logging and graceful shutdown                  |
| `pnpm --filter @skeld/core publish --dry-run`                                                            | lists what the package would publish, without publishing                                                 |
| `pnpm run bench`                                                                                         | builds `packages/core` and runs the benchmark, about 11 minutes; run it with nothing else on the machine |

Run the hello example from source, with the client in a second shell:

```sh
pnpm --filter @skeld/example-hello run start
pnpm --filter @skeld/example-hello run call
```

Continue with the [logging example](examples/logging/README.md) for classified fields and request IDs, or the
[service example](examples/service/README.md) for plugins, scoped hooks, declared errors and bounded state.

## Contributing

See [Contributing to skeld](CONTRIBUTING.md) for setup, focused checks, and pull requests. Documentation contributors can follow the [writing guide](docs/maintainers/writing-docs.md).

## License

MIT
