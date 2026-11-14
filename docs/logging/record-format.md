# Record format

Every record is one JSON object on one line, at most 8,192 bytes, ending with a newline on stdout. A `sink` receives the same lines without the newline.

- Key order is unspecified.
- `time` is when the record was created, not when it was written.
- Service identity (`service.name`) is not on the line; set it in your collector's configuration.
- Automatic records carry no `message`: the event name is the meaning. The events are listed in [events.md](events.md).

## Keys

Every key below `trace_flags` maps to an OpenTelemetry log attribute of the same name.

| Line key                                                                                                                               | JSON type                                                                                     | Present                                                          | OpenTelemetry field                                  |
| -------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- | ---------------------------------------------------- |
| `time`                                                                                                                                 | string, `YYYY-MM-DDTHH:mm:ss.sssZ`                                                            | always                                                           | Timestamp                                            |
| `severity_text`                                                                                                                        | `debug`, `info`, `warn`, `error` or `fatal`                                                   | always                                                           | SeverityText                                         |
| `severity_number`                                                                                                                      | 5, 9, 13, 17 or 21, in the order of `severity_text`                                           | always                                                           | SeverityNumber                                       |
| `event_name`                                                                                                                           | string                                                                                        | always                                                           | EventName                                            |
| `message`                                                                                                                              | string                                                                                        | author records only                                              | Body                                                 |
| `trace_id`                                                                                                                             | 32 lowercase hex digits                                                                       | a valid inbound `traceparent`                                    | TraceId                                              |
| `trace_flags`                                                                                                                          | 2 lowercase hex digits                                                                        | with `trace_id`                                                  | TraceFlags                                           |
| `skeld.category`                                                                                                                       | `boot`, `app`, `security` or `access`                                                         | always                                                           | Attributes, same key                                 |
| `skeld.request_id`                                                                                                                     | string                                                                                        | request-scoped records                                           | Attributes, same key                                 |
| `http.request.header.x-request-id`                                                                                                     | array of one string                                                                           | a valid inbound id                                               | Attributes, same key                                 |
| `http.request.method`                                                                                                                  | `GET`, `HEAD`, `POST`, `PUT`, `PATCH`, `DELETE`, `OPTIONS`, `CONNECT`, `TRACE`, else `_OTHER` | engine request records                                           | Attributes, same key                                 |
| `http.route`                                                                                                                           | the route's template                                                                          | a route matched                                                  | Attributes, same key                                 |
| `http.response.status_code`                                                                                                            | number                                                                                        | the engine wrote, or is about to write, a response head          | Attributes, same key                                 |
| `error.type`                                                                                                                           | the code of the error body written; `_OTHER` over 128 characters                              | refusals and errors                                              | Attributes, same key                                 |
| `client.address`                                                                                                                       | string                                                                                        | engine request records, with `clientAddress` on                  | Attributes, same key                                 |
| `skeld.reason`                                                                                                                         | a fixed code                                                                                  | the events that name one                                         | Attributes, same key                                 |
| `skeld.exception.kind`, `exception.type`, `skeld.exception.code`, `exception.message`, `skeld.exception.cause`, `exception.stacktrace` | strings                                                                                       | the events that read an error; see [errors.md](errors.md)        | Attributes, same keys                                |
| `skeld.outcome`                                                                                                                        | `completed` or `aborted`                                                                      | access records                                                   | Attributes, same key                                 |
| `skeld.duration_ms`                                                                                                                    | number of milliseconds, 3 decimals                                                            | access records                                                   | Attributes, same key                                 |
| `fields`                                                                                                                               | object                                                                                        | author records with fields                                       | one map attribute; an error field is a map inside it |
| `skeld.schema_location`                                                                                                                | string, cut at 256 units                                                                      | a `response_mismatch` error record whose mismatch has a location | Attributes, same key                                 |
| `skeld.omitted`                                                                                                                        | number                                                                                        | something did not fit                                            | Attributes, same key                                 |

The request id has two places: `skeld.request_id` is the id skeld minted for the request and sent in its `x-request-id` response header; `http.request.header.x-request-id` is the id the client sent, written only with `correlation` on and only when it is well formed. A trace id is never a request id.

## Inbound correlation headers

Read only with the `correlation` option on. A header sent more than once is ignored.

| Header         | Accepted when                                                                                          | Written as                                                      |
| -------------- | ------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------- |
| `x-request-id` | it matches `^[A-Za-z0-9._:=+/-]{1,128}$`                                                               | `http.request.header.x-request-id`                              |
| `traceparent`  | it is 55 characters matching `^00-[0-9a-f]{32}-[0-9a-f]{16}-[0-9a-f]{2}$`, and neither id is all zeros | `trace_id` and `trace_flags`; the parent span id is not written |

## Field values

A part past its bound is cut or left out, never an error. Lengths are in UTF-16 code units; the record bound is in UTF-8 bytes.

| Value                                               | Written                                                                                |
| --------------------------------------------------- | -------------------------------------------------------------------------------------- |
| message, or a string field                          | escaped, cut at 1,024 units; a lone surrogate becomes U+FFFD                           |
| field name                                          | escaped, cut at 64 units; at most 32 fields per call, the rest left out                |
| number                                              | a JSON number; `NaN` and the infinities as `null`; a `bigint` as its decimal string    |
| `undefined`                                         | the key is left out                                                                    |
| a `Secret`                                          | `[secret]`; the value is never exposed                                                 |
| a `Classified`                                      | its schema's projection, at most 256 nodes; past that `[truncated]`                    |
| an error (what `Error.isError` accepts)             | an object under the field's name, written by the error reader ([errors.md](errors.md)) |
| anything else: an object, array, function or symbol | `[unclassified]`; nothing of it is inspected                                           |

Escaping covers `"`, `\`, U+0000 to U+001F, U+007F to U+009F, U+2028 and U+2029, so a field cannot end its line or its string.

### Projection under a schema

A `Classified` value is read only through own data-property descriptors, each object first checked for being a Proxy, so the projection calls no getter, Proxy trap, `toJSON` or `toString`. What is written is the copy taken at the log call.

| Schema node                                     | Written                                                                                                                       |
| ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| marked `secret` or `personal`, any kind         | `[secret]` or `[personal]`; the value is not read                                                                             |
| a scalar kind                                   | the value when its type fits the kind (a string as above), else `[invalid]`; bounds such as `maxLength` are not checked again |
| object                                          | declared keys only; an undeclared key is left out; a getter, a Proxy or a non-object is `[invalid]`                           |
| array, record                                   | each item or entry by its schema; record keys as field names                                                                  |
| union                                           | the member that accepts the value; when none does, the union's strongest marker, or `[invalid]`                               |
| not a schema; a part the route does not declare | `[unclassified]`                                                                                                              |

## When a record does not fit

A record over 8,192 bytes gives up parts in this order until it fits, and adds one to `skeld.omitted` for each part given up:

1. Field members, from the last.
2. The stack frames.
3. The cause message.
4. The exception message.
5. Finally, `message` is cut.

Fields past the 32nd are counted in `skeld.omitted` the same way.
