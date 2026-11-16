# Tests

These scripts check observable behavior: responses on a real connection, emitted log records, rejected inputs,
cleanup after disconnects, and the types an application can use. Keep a test when it can explain the bug it catches.

## Layout

| Folder       | What belongs here                                                                                   |
| ------------ | --------------------------------------------------------------------------------------------------- |
| `security/`  | Adversarial inputs, framing and size limits, disclosure, reserved headers and trust boundaries      |
| `browser/`   | Cookies, CORS, CSRF and redirects, including their hostile cases                                    |
| `lifecycle/` | Hooks, deadlines, disconnects, shutdown, resource ownership and races                               |
| `contracts/` | Route and client contracts, response projection, derived classes and package exports                |
| `schema/`    | Validation, serialization and JSON Schema agreement; shared schema corpora live beside these proofs |
| `logging/`   | Redaction, injection, correlation, suppression, sinks and log shutdown                              |
| `auth/`      | Gate, sessions, grants, credentials, JWT/OIDC, stores, races, bounds and package proofs             |
| `support/`   | Shared compiler, wire, child-process, diagnostic and evidence helpers; no standalone tests          |

File a test under the behavior it protects. A CSRF attack belongs in `browser/`; a secret leaking through a
logger belongs in `logging/`. Do not copy it into `security/` as well. Keep meaningful related cases in one script
rather than creating a file per assertion. Historical `audit-` filenames remain searchable.

Performance workloads live in [`../benchmarks/`](../benchmarks/README.md).

## Run

From the repository root, after `pnpm install`:

```sh
pnpm test quick                # routine checks; SQLite only, no PostgreSQL or browser
pnpm test database             # store integrations on both adapters; requires SKELD_TEST_PG_URL
pnpm test protocol             # JWT/OIDC/TLS, including Chromium; SQLite only
pnpm test extended             # real deadlines, fault injection and password load; SQLite only
pnpm test tooling              # package artifacts, Semgrep rules and benchmark-lock checks
pnpm test full                 # all scripts, full schema corpora and both-store integrations
pnpm test exhaustive           # full plus repeated races and both-store behavioral matrices
pnpm test                      # remains an alias for full; it does NOT silently skip PostgreSQL
pnpm test diag                 # seven core checks under diagnostic instrumentation
node tests/run.ts quick --list # inspect selection without building or running tests
```

The five groups are defined in [`support/suites.ts`](support/suites.ts). `runtime` is an alias for `quick`.
Each script belongs to exactly one group. Discovery only checks that the catalog matches the filesystem;
adding an unregistered script fails the runner. Every script runs in a separate process. The runner prints
per-script elapsed time, total time and the ten slowest scripts. Missing scripts, timeouts and nonzero exits fail.

Quick mode runs the three generated-schema proofs with their existing `--schemas 200` option. Full, exhaustive
and the standalone `schema` category keep 4,000 generated schemas. Password queue/load proofs live separately in
`auth/password-load.ts`, in the extended group; functional password checks remain quick. These selections do not
change product configuration or shorten product deadlines.

`database`, `auth`, `full` and `exhaustive` require `SKELD_TEST_PG_URL`, a PostgreSQL 18 connection string for a
role allowed to create disposable databases. Missing configuration fails before any scripts start. The database
group includes diagnostics because each adapter has a distinct hook. Full runs store-dependent integrations on
both adapters. Protocol and callback behavior matrices normally run on SQLite once; exhaustive restores both
adapters, repeated credential-change schedules and the overlapping handoff deadline check. Full therefore has
broader backend/corpus coverage than running each group with its routine profile.

For individual auth scripts, `SKELD_TEST_STORES=sqlite|postgres|both` selects adapters explicitly; the default is
`both`. `SKELD_TEST_PROFILE=exhaustive` restores repeated matrices. The runner sets these variables according to
its selected mode, so an inherited environment cannot silently downgrade a full run. `diag-hooks.ts` needs both
stores to prove all twenty hooks. The conformance kit creates fresh stores and schemas per case, reusing one
owned PostgreSQL database for its serial cases; other database proofs keep their own databases.

Legacy categories still work: `pnpm test security`, `browser`, `lifecycle`, `contracts`, `schema`, `logging`, or
`auth`. They are topic selections, not cost groups. The no-codegen check gets its required Node flag. Diagnostic
mode gives each script a fresh directory and removes it afterward.

The tooling group packs core and auth once each. Marker checks, consumer declaration checks and the installed
consumer all inspect those same artifacts. The standalone `pack-check` and `consumer-check` commands remain
available; avoid running them again after tooling/full. The consumer checker accepts `--packed-dir <directory>`
when artifacts already exist, and the marker checker accepts multiple tarball paths.

For a single script, build first, then run it directly:

```sh
pnpm run check
node --conditions=skeld-source tests/security/body-limit.ts
node --conditions=skeld-source --disallow-code-generation-from-strings tests/schema/no-codegen.ts
```

Two logging integrations are explicit:

```sh
pnpm test collector --collector /absolute/path/to/otelcol-contrib
pnpm test destination
```

The Collector check requires the version pinned in `logging/log-collector.ts` and does not download it.
The destination check includes a latency comparison and needs an exclusive performance window. Neither runs
in the default suite. Some correctness checks exercise real deadlines; their waiting is part of the behavior
being checked, not a throughput benchmark.

## Keep the checks honest

- State the expected behavior independently of the implementation. Check actual status, body, records or ownership;
  counting how many inputs were intended to fail proves nothing about their responses.
- Pair refusal cases with a valid control. A dead server, broken import or unrelated compiler error must not pass.
  Compiler probes use `support/support-compile.ts`: each negative case marks its intended line and names its
  diagnostic code. Positive controls must compile cleanly.
- Prefer public APIs and real wire behavior. The retention proof is a deliberate exception: it inspects internal
  deadline ownership that a response alone cannot expose. Its narrow lint exception allows source imports, so
  the queue and the running engine come from the same implementation.
- When repairing a check that passed incorrectly, show that a deliberate violation makes it fail. Keep such
  mutations temporary; do not add a permanent second implementation just to test the first.
- Do not weaken an expectation to accommodate a failure. Investigate whether the implementation, fixture or
  stated contract is wrong. Document genuine oracle limitations narrowly. The JSON Schema proof adjusts only
  declared-key minimum counting for open objects; its existing Unicode and Ajv key exclusions are reported.
- Reuse setup from `support/`. Add a test for a distinct failure mode, not to restate a function's implementation
  or increase an assertion count.

Tests execute TypeScript source. Their build emits declarations for project-reference checks, not runnable copies
that can silently fall behind the source. No production behavior is changed by this organization.
