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
| `support/`   | Shared compiler, wire, child-process, diagnostic and evidence helpers; no standalone tests          |

File a test under the behavior it protects. A CSRF attack belongs in `browser/`; a secret leaking through a
logger belongs in `logging/`. Do not copy it into `security/` as well. Keep meaningful related cases in one script
rather than creating a file per assertion. Historical `audit-` filenames remain searchable.

Performance workloads live in [`../benchmarks/`](../benchmarks/README.md).

## Run

From the repository root, after `npm install`:

```sh
npm test                         # build/type-check, then all ordinary correctness scripts
npm test -- security             # one category; any folder name above except support works
npm test -- browser
npm test -- schema
npm test -- logging
npm test -- diag                 # the seven base checks under diagnostic instrumentation
```

`tests/run.ts` discovers scripts in each category and runs them in separate processes. The schema corpus and
fixture modules are excluded. An empty category, missing script, timeout or nonzero exit fails the run.
The no-codegen check gets its required Node flag. Diagnostic mode gives each script a fresh directory and removes
it afterward; tests that start multiple servers use their own diagnostic children where appropriate.

For a single script, build first, then run it directly:

```sh
npm run check
node --conditions=skeld-source tests/security/body-limit.ts
node --conditions=skeld-source --disallow-code-generation-from-strings tests/schema/no-codegen.ts
```

Two logging integrations are explicit:

```sh
npm test -- collector --collector /absolute/path/to/otelcol-contrib
npm test -- destination
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
