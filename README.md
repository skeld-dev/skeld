# DarkStart

DarkStart is a TypeScript framework for services on Node 26: one contract declares each route's schemas, the engine on `node:http` validates and serializes from it, and a typed client calls it.

The package, its install and its example are documented in [`packages/core/README.md`](packages/core/README.md).

## Repository

An npm workspaces monorepo. Source runs unbuilt with `node --conditions=darkstart-source`, which resolves `@darkstart/core` to `packages/core/src`.

| Workspace        | What                                               |
| ---------------- | -------------------------------------------------- |
| `packages/core`  | `@darkstart/core`, the published package           |
| `examples/hello` | the hello example the package README shows         |
| `benchmarks`     | the benchmark runner and its servers               |
| `tests`          | end-to-end acceptance scripts                      |
| `tools`          | repository tools, such as the README example check |

## Development

Requires Node 26.13.0 (`.nvmrc`).

```sh
npm install
```

Run every command from the repository root.

| Command                                                                                                  | Does                                                                                                     |
| -------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `npx tsc -b --force`                                                                                     | type-checks and builds every project                                                                     |
| `npx biome check .`                                                                                      | formats and lints                                                                                        |
| `npx knip`                                                                                               | finds unused files, exports and dependencies                                                             |
| `semgrep scan --config p/typescript --config p/nodejs --config .semgrep --metrics=off --error --quiet .` | static analysis                                                                                          |
| `npm audit --omit=dev --workspace @darkstart/core`                                                       | audits the published package's dependencies                                                              |
| `node tools/check-readme-example.ts`                                                                     | checks that the package README's example matches `examples/hello` byte for byte                          |
| `npm publish --dry-run --workspace @darkstart/core`                                                      | lists what the package would publish, without publishing                                                 |
| `npm run bench`                                                                                          | builds `packages/core` and runs the benchmark, about 11 minutes; run it with nothing else on the machine |

Run the hello example from source, with the client in a second shell:

```sh
npm run start --workspace @darkstart/example-hello
npm run call --workspace @darkstart/example-hello
```

## License

MIT
