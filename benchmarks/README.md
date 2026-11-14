# Benchmarks

These workloads measure cost. Correctness checks live in [`../tests/`](../tests/README.md); the default test
command does not run benchmarks. Use a quiet, exclusive host window for timing comparisons and retain the
configuration, comparator versions and raw results with any claim.

| Location                                | Measures                                                                      |
| --------------------------------------- | ----------------------------------------------------------------------------- |
| `run.ts`, `servers/`                    | Skeld HTTP CPU cost, throughput and latency                                   |
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

The HTTP runner measures skeld on hello and echo, alone unless `--against` names an external server (below).
Reports contain CPU time per request, throughput, p99 latency, per-round samples and environment details, with
no comparison verdict.
A completed HTTP run exits 0; usage, start, measurement and interruption failures retain their error codes.
Use `--check` to verify both routes without collecting timing measurements. `--servers skeld` remains
accepted; other server names are rejected.

### Comparing with an external server

`--against <file>` adds one server that lives outside this repository to an HTTP run. Comparison servers are
kept outside the repository on purpose, so their dependencies are never part of this workspace. The runner
starts the file as `node <file> --port 0` from the file's own folder, without `--conditions`, with
`NODE_ENV=production`, and pinned to the server core like skeld. It passes the same start check, rotates
position with skeld each round, and is measured the same way. The report shows one row per server and route,
then skeld's median CPU µs/req and req/s on each route divided by the external server's. These ratios are
measurements; the run gives no verdict.

The external file must:

- accept `--port <n>` and listen on `127.0.0.1` at that port, where 0 means any free port;
- print one line `{"server":"<name>","port":<n>}` on stdout once it is listening, where the name is lowercase
  letters and hyphens, is not empty and is not `skeld`; the run labels the server by this name;
- answer `GET /` with status 200, media type `application/json` and the body `{"hello":"world"}`;
- answer `POST /` with a JSON body `{"hello":"world"}` by returning that body the same way;
- exit on SIGTERM.

Its folder holds its own `package.json` and `node_modules`. When `node_modules/<name>/package.json` is there,
the report records that package's version.

```sh
node benchmarks/run.ts --check --against ~/.local/share/skeld/bench-compare/fastify/server.mjs
pnpm run bench --against ~/.local/share/skeld/bench-compare/fastify/server.mjs
```

With `--check`, both servers are started and checked and nothing is measured; a passing check ends with
`Check passed: 2 servers answer 2 routes correctly.` A file that does not exist, a path that is not a file, and
`--against` together with `--diag` or `--logging` are usage errors (exit 2).

`--diag` and `--logging` remain skeld-only sessions with their separate overhead assessments and readouts.
Historical reports retain the measurements and comparisons recorded when they were produced.

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
