# Tests

These scripts check observable behavior: responses on a real connection, emitted log records, rejected inputs,
cleanup after disconnects, and the types an application can use. A script stays only when it would fail on a real
defect in product behaviour that harms confidentiality, integrity or availability. One-time proofs, input matrices,
repeated runs and machine-speed timing windows do not belong here.

## Layout

| Folder       | What belongs here                                                                              |
| ------------ | ---------------------------------------------------------------------------------------------- |
| `security/`  | Adversarial inputs, framing and size limits, disclosure, reserved headers and trust boundaries |
| `browser/`   | Cookies, CORS, CSRF and redirects, including their hostile cases                               |
| `lifecycle/` | Hooks, deadlines, disconnects, shutdown, resource ownership and races                          |
| `contracts/` | Route and client contracts, response projection and derived classes                            |
| `schema/`    | Validation and serialization agreement; shared schema corpora live beside these checks         |
| `logging/`   | Redaction, injection, correlation, suppression, sinks and log shutdown                         |
| `auth/`      | Gate, sessions, grants, credentials, JWT/OIDC, stores, races, bounds and package contents      |
| `support/`   | Shared compiler, wire, child-process and reporting helpers; no standalone tests                |

File a test under the behavior it protects. A CSRF attack belongs in `browser/`; a secret leaking through a
logger belongs in `logging/`. Do not copy it into `security/` as well. Keep meaningful related cases in one script
rather than creating a file per assertion.

Performance workloads live in [`../benchmarks/`](../benchmarks/README.md).

## Run

From the repository root, after `pnpm install`:

```sh
pnpm test quick                # routine checks; SQLite only, no PostgreSQL or browser
pnpm test database             # store integrations on both adapters; requires SKELD_TEST_PG_URL
pnpm test protocol             # JWT/OIDC/TLS, including Chromium; SQLite only
pnpm test extended             # real deadlines, fault injection, failing log destinations; SQLite only
pnpm test tooling              # package artifacts
pnpm test full                 # all scripts, full schema corpora and both-store integrations
pnpm test                      # an alias for full; it does NOT silently skip PostgreSQL
pnpm test diag                 # five core checks under diagnostic instrumentation
node tests/run.ts quick --list # inspect selection without building or running tests
```

The five groups are defined in [`support/suites.ts`](support/suites.ts). `runtime` is an alias for `quick`.
Each script belongs to exactly one group. Discovery only checks that the catalog matches the filesystem;
adding an unregistered script fails the runner.

Every script runs alone in its own process group. A script that runs longer than 90 seconds is stopped and fails:
the runner kills its whole process group, so servers and readers it started die with it, and prints the
script's output. The slowest script takes 15 to 20 seconds on the development host. Processes a script leaves
running after it exits are killed too, and the runner names the script. The runner prints per-script elapsed
time, total time and the ten slowest scripts.

Quick mode runs the two generated-schema checks with `--schemas 200`. Full and the standalone `schema` category
keep 4,000 generated schemas. These selections do not change product configuration or shorten product deadlines.

`database`, `auth` and `full` require `SKELD_TEST_PG_URL`, a PostgreSQL 19 connection string for a role allowed
to create disposable databases. Missing configuration fails before any scripts start. Full runs store-dependent
integrations on both adapters; protocol and callback behavior runs on SQLite once.

For individual auth scripts, `SKELD_TEST_STORES=sqlite|postgres|both` selects adapters explicitly; the default is
`both`. The runner sets it according to its selected mode, so an inherited environment cannot silently downgrade
a full run.

Categories are topic selections, not cost groups: `pnpm test security`, `browser`, `lifecycle`, `contracts`,
`schema`, `logging` or `auth`. The no-codegen check gets its required Node flag. Diagnostic mode gives each
script a fresh directory and removes it afterward.

For a single script, build first, then run it directly:

```sh
pnpm run check
node --conditions=skeld-source tests/security/body-limit.ts
node --conditions=skeld-source --disallow-code-generation-from-strings tests/schema/no-codegen.ts
```

`logging/log-destination.ts` starts one server per failure: a stdout reader that stops reading, one that has
exited, and sinks that throw, reject, never settle or log from inside themselves, plus a healthy sink as the
control. Each gets a burst past the 1 MiB queue, and the script checks that ordinary requests still answer, that
held bytes stay within the queue and that the failure really happened. Logging scripts print one pass or fail line
per case and write no files.

## Keep the checks honest

- State the expected behavior independently of the implementation. Check actual status, body, records or ownership;
  counting how many inputs were intended to fail proves nothing about their responses.
- Pair refusal cases with a valid control. A dead server, broken import or unrelated compiler error must not pass.
  Compiler probes use `support/support-compile.ts`: each negative case marks its intended line and names its
  diagnostic code. Positive controls must compile cleanly.
- Prefer public APIs and real wire behavior. The retention check is a deliberate exception: it inspects internal
  deadline ownership that a response alone cannot expose. Its narrow lint exception allows source imports, so
  the queue and the running engine come from the same implementation.
- When repairing a check that passed incorrectly, show that a deliberate violation makes it fail. Keep such
  mutations temporary; do not add a permanent second implementation just to test the first.
- Do not weaken an expectation to accommodate a failure. Investigate whether the implementation, fixture or
  stated contract is wrong. Document genuine oracle limitations narrowly.
- Reuse setup from `support/`. Add a test for a distinct failure mode, not to restate a function's implementation
  or increase an assertion count.

Tests execute TypeScript source. Their build emits declarations for project-reference checks, not runnable copies
that can silently fall behind the source.
