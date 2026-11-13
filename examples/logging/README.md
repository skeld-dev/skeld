# Logging: see the outcome without copying the input

This small JSON preview endpoint demonstrates a request that succeeds and one the handler rejects. It neither saves the document nor calls an external service. All client data is synthetic; the `apiKey` field demonstrates secret handling, not authentication.

From the repository root, after `pnpm install`:

```sh
pnpm --filter @skeld/example-logging run start
```

In a second terminal:

```sh
pnpm --filter @skeld/example-logging run call
```

Expect these client results, with a different UUID on each line:

```text
Accepted: true; request id: <uuid>
Rejected: INVALID_DOCUMENT; request id: <uuid>
```

## Follow the request

[contract.ts](contract.ts) marks `email` and `document` as personal, and `apiKey` as secret. [server.ts](server.ts) enables access records with `log: { access: true }` and uses the request-bound logger. Find the client's UUID in the server's `skeld.request_id` field: it joins the author records to the terminal `skeld.request.closed` record.

The `preview requested` record has these fields:

```json
{
  "email": "[personal]",
  "apiKey": "[secret]",
  "input": {
    "email": "[personal]",
    "apiKey": "[secret]",
    "document": "[personal]"
  }
}
```

The code deliberately shows three useful forms:

| Expression                            | Why it is masked                                |
| ------------------------------------- | ----------------------------------------------- |
| `request.classified('body', 'email')` | Pairs a personal scalar with the route's schema |
| `request.body.apiKey`                 | Validation wrapped the secret in `Secret`       |
| `request.classified('body')`          | Projects the whole body through its schema      |

A personal string remains a plain string in the handler. Passing `request.body.email` directly as a log field, or interpolating it into a message, would disclose it. Classification is not a global taint tracker. Ordinary objects without a schema are rejected by the logger's field type and become `[unclassified]` at runtime; use `classified` when an object belongs in a record.

## A caught error is still observable

The second call supplies invalid JSON inside `document`. `JSON.parse` throws a `SyntaxError`; its message can contain document text. The handler logs `{ err }` and returns the declared 422 response without echoing that text. The record under `fields.err` includes the recognised type, but no message or stack with default options. This handled 422 is an author warning plus an access record, not an engine 5xx error record.

`errorText`, `errorFrames` and `errorIdentifiers` are separate opt-ins. Leave them off here; [error logging](../../docs/logging/errors.md) explains the disclosure and execution consequences. Never build a log message from `err.message` to recover omitted text.

## Refuse input before the handler

```sh
curl -i http://127.0.0.1:3001/preview \
  -H 'content-type: application/json' \
  --data '{"email":"reader@example.test","apiKey":"demo","document":"{}","extra":true}'
```

Expect HTTP 400 `VALIDATION`, with an access record and request ID but no `preview requested` record for that ID. The object schema is closed, so the undeclared key is refused before the handler runs.

Stop with Ctrl-C to flush the logs. Continue with the [logging reference](../../docs/logging/logging.md) for sinks, thresholds, suppression and delivery counters; defaults do not promise lossless delivery. Custom ports are covered in the [examples guide](../README.md).
