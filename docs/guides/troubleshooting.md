# Troubleshoot a service

Start with the stage that failed: startup, request admission, application response, client response validation, or log delivery. A status code alone often does not distinguish them; read the structured error code too.

## The server does not start

| Symptom                   | Check                                                 | Correction                                                                                  |
| ------------------------- | ----------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `UNBOUNDED_FIELD`         | The route, part, and field named by `BootError`       | Add the appropriate upper bound, or make a deliberate `unbounded` exception                 |
| `INVALID_BOUND`           | Minimums, maximums, and count values                  | Use valid non-negative integer counts and a minimum no greater than its maximum             |
| `SECRET_IN_RESPONSE`      | The complete response schema, including nested fields | Remove the secret from the response, or explicitly expose it only where the API requires it |
| `NESTED_TOO_DEEP`         | Body and response schema nesting                      | Reduce nesting within the 64-level JSON limit                                               |
| `INVALID_OPTION`          | The option named by the error                         | Fix its value; strict cross-site mode needs `publicOrigin`, for example                     |
| `CODEGEN_UNAVAILABLE`     | Node flags and runtime restrictions                   | Run the server where its startup code generation is permitted                               |
| Package root import fails | Imports such as `from '@skeld/core'`                  | Import the needed subpath, such as `@skeld/core/server`                                     |

An error from a schema builder can occur before `listen()`. A plugin can also fail during startup and trigger rollback. Preserve the original error and inspect any cleanup failure attached to it.

## The request never reaches the handler

| Response                     | Likely boundary                       | What to inspect                                                                             |
| ---------------------------- | ------------------------------------- | ------------------------------------------------------------------------------------------- |
| 400 `VALIDATION`             | Request schema                        | `details` paths, declared fields, JSON types, duplicate declared cookies                    |
| 400 `BAD_REQUEST`            | Parsing or structural refusal         | JSON syntax, nesting, and forbidden object keys                                             |
| 403 `CROSS_ORIGIN`           | Cross-site check or refused preflight | Actual `Origin`, `Sec-Fetch-Site`, `publicOrigin`, and the route's policy                   |
| 404 `NOT_FOUND`              | Routing                               | Method, path, scope prefix, and whether an OPTIONS request is really a configured preflight |
| 413 `PAYLOAD_TOO_LARGE`      | Body cap                              | Schema-derived limit as well as configured `bodyLimit`                                      |
| 415 `UNSUPPORTED_MEDIA_TYPE` | Body media type                       | The route's JSON body and request `Content-Type`                                            |
| 503 `TIMEOUT`                | Request deadline                      | Slow body upload, hooks, downstream work, and cancellation behavior                         |

Inspect these headers locally while debugging; do not dump arbitrary headers or request bodies into production logs. A 403 browser failure is not automatically a CORS configuration problem: reading a response and admitting a mutation are separate policies.

## The handler ran, but the reply became a 500

Check the request's engine error record for a fixed reason such as `response_mismatch`, `undeclared_status`, or `redirect_refused`. Common causes are a string longer than the response permits, a status missing from `responses`, an extra property preventing a union member from matching, or an absolute redirect origin not in `redirectOrigins`.

Return only the intended union member's fields. For an ordinary object response, extra undeclared properties are projected away; that does not make invalid declared values acceptable.

If you enable error disclosure for diagnosis, understand its cost: text and stack frames can contain application-controlled or sensitive material. See [error logging options](../logging/errors.md).

## The client rejects a response that curl shows

Curl displays bytes; the typed client checks declared responses. `INVALID_RESPONSE` can mean the deployed server and client disagree, a proxy returned the wrong body, or JSON was malformed. `RESPONSE_TOO_LARGE` means the byte bound was crossed. Compare the status, content type, contract version, and schema before raising a limit or adding a cast.

## A request ID has no log line

Access logging is off by default. Engine errors and refusals are flood-suppressed; queues can drop records; a failed or hung destination can prevent delivery. Inspect `logStats()` through an independent path and check enabled levels. A response header containing an ID does not promise a retained record for it.

For malformed JSON lines, also check whether another writer shares stdout. For missing error messages or stack frames, check the disclosure defaults before assuming the logger failed.

## Reproduce with the smallest working example

Run the [hello example](../../examples/hello/README.md) to isolate basic routing and contract behavior, the [logging example](../../examples/logging/README.md) for classification, or the [service example](../../examples/service/README.md) for scoped hooks and cleanup. Keep the failing input small and remove credentials before sharing it.

From the repository root, `pnpm run examples-check` exercises those examples against real local HTTP servers and closes the servers it creates. See [test categories](../../tests/README.md) for focused regression checks; performance measurements live separately under [benchmarks](../../benchmarks/README.md).
