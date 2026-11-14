# Benchmarks

These workloads measure cost. Correctness checks live in [`../tests/`](../tests/README.md); the default test
command does not run benchmarks. Use a quiet, exclusive host window for timing comparisons and retain the
configuration, comparator versions and raw results with any claim.

| Location                                | Measures                                                                      |
| --------------------------------------- | ----------------------------------------------------------------------------- |
| `run.ts`, `servers/`                    | HTTP throughput and latency against the configured servers                    |
| `diag/`                                 | Diagnostic instrumentation scenarios                                          |
| `browser-costs.ts`, `browser-server.ts` | Cookie and browser-policy costs                                               |
| `logging/`                              | Logging drivers and fixtures                                                  |
| `schema/speed.ts`                       | Validator cost against installed comparators                                  |
| `schema/serializer-speed.ts`            | Serializer cost against installed comparators                                 |
| `schema/bundle.ts`                      | Client bundle sizes, with behavior checks before comparing                    |
| `schema/listen200.ts`                   | Startup of a 200-route service                                                |
| `type-cost/`                            | TypeScript cost fixtures: 200/500 routes, cookies, derived classes and unions |

Run from the repository root. The HTTP runner builds core itself:

```sh
pnpm run bench
```

The HTTP servers are skeld, Fastify, node:http, Hono and Express. The default run compares the first three;
use `--servers skeld,fastify,node-http,hono,express` to include all five. Use `--check` to verify both routes
without collecting timing measurements.

Schema scripts use the source condition. The comparator directory must already contain the dependencies
expected by that script; moving these scripts did not change their comparator pins or measurement protocol.

```sh
node --conditions=skeld-source benchmarks/schema/speed.ts --comparators /path/to/comparators
node --conditions=skeld-source benchmarks/schema/serializer-speed.ts --comparators /path/to/comparators
node --conditions=skeld-source benchmarks/schema/bundle.ts --comparators /path/to/comparators
node --conditions=skeld-source benchmarks/schema/listen200.ts
```

Type-cost fixtures consume built package types. They stay out of the ordinary solution build to avoid adding
measurement workloads to every developer check. Choose one configuration explicitly:

```sh
pnpm run check
node node_modules/typescript/bin/tsc -p benchmarks/type-cost/tsconfig.json --extendedDiagnostics
```

The neighboring `tsconfig.500.json`, `tsconfig.cookies.json`, `tsconfig.derived.json` and `tsconfig.unions.json`
select the other fixtures. The combined logging destination correctness/latency check remains in
`tests/logging/log-destination.ts` and runs explicitly through `pnpm test destination`.
