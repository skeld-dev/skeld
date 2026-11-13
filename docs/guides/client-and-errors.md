# Call a service and handle errors

A client call has two kinds of outcome: it receives an HTTP response, or it cannot produce a usable response. Handle those separately. An HTTP 404 is usually a resolved result; a network failure rejects the call.

The [task client](../../examples/service/client.ts) demonstrates status-based handling against the [task contract](../../examples/service/contract.ts). Run it with the [service example](../../examples/service/README.md).

## Narrow by status before reading the body

`createClient(contract, { baseUrl })` exposes one method per operation name. For a status declared with a schema, it validates the received body before returning it. Checking `result.status` selects the corresponding body type.

| Result                        | What the caller can assume                              |
| ----------------------------- | ------------------------------------------------------- |
| Declared status with a schema | The body passed that response schema                    |
| Declared empty response       | The declared result type has no JSON body               |
| Undeclared status             | The body is `unknown`; narrow or validate it before use |
| Rejected call                 | No usable result was returned; inspect the thrown error |

Do not cast an undeclared body to the success type. A reverse proxy can return an HTML error page, and an older server can have a different contract. The unknown branch is part of using HTTP reliably.

## Distinguish failed calls

Client failures use `HttpError` from `@skeld/core/http-error` with `status: null`:

| Code                 | Meaning                                                                                | Useful next step                                                                   |
| -------------------- | -------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `NETWORK`            | Sending or receiving failed                                                            | Check connectivity and cancellation; decide whether retrying the operation is safe |
| `INVALID_RESPONSE`   | A declared response failed validation, JSON was invalid, or nesting exceeded the limit | Compare deployed contracts and inspect the server or proxy                         |
| `RESPONSE_TOO_LARGE` | The response exceeded the byte limit                                                   | Check whether the schema and operation are appropriately bounded                   |

Response limits apply while reading decoded bytes, not only after buffering a whole body. By default, a bounded declared schema supplies its limit; an open or unbounded schema, or an undeclared status, uses 1 MiB. `maxResponseBytes` replaces every response limit for that client. Raising it is a deliberate resource decision, not a fix for a wrong response shape.

The client does not automatically retry calls. A lost response does not prove a write failed: the server may have committed it before the connection broke. Establish idempotency in the application before retrying mutations.

## Choose what the server exposes

Use a declared reply for a routine application outcome. Throw `HttpError` for an intentional HTTP error path. Its code, message, and permitted details are response content: write them for the caller, without tokens, database diagnostics, or private values.

By default, an arbitrary handler throw becomes the fixed response:

```json
{ "status": 500, "code": "INTERNAL", "message": "Internal Server Error" }
```

The thrown message is not copied into that body. A request that fails input validation instead receives HTTP 400 `VALIDATION`, with paths and descriptions rather than the rejected values. Failures inside classified data have coarser details to avoid revealing its structure.

The contract constrains normal handler replies. It does not turn author-written `HttpError` messages or low-level hook replies into schema-classified content. Review those explicit response paths as carefully as ordinary handlers.

## Follow the request without exposing the failure

Use the response's `x-request-id` when investigating a problem. The engine owns this header; do not set it yourself. Engine request records use the same ID. Request IDs are correlation values, not proof of identity or authorization.

There may be no error record for a particular ID during flood suppression or delivery loss. Access records are opt-in and are not flood-suppressed, but they still use the bounded delivery queue. See [logging delivery and suppression](../logging/logging.md).

When catching an error and continuing, pass the error as a field to the logger instead of interpolating its message. The [logging example](../../examples/logging/server.ts) does this for an expected `SyntaxError`. Default error fields contain recognized identifiers; messages, frames, and unlisted identifiers each require disclosure options. See [errors in log records](../logging/errors.md).

**Next:** [organize a service](plugins-and-lifecycle.md). Reference: [client](../api/core/client.md) and [HttpError](../api/core/http-error.md).
