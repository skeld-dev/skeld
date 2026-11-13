# Logging

New to the framework? Start with [the documentation home](../README.md). To learn classification by running a request, use the [classification guide](../guides/classification.md) and [logging example](../../examples/logging/README.md).

A Skeld server writes structured records as JSON lines to stdout, or hands them to a `sink` you give it. The engine writes its own records about the server and its requests, and handlers, hooks and plugins get a logger. Every request the engine answers carries a request id in its `x-request-id` response header.

- The line format and its OpenTelemetry mapping are in [record-format.md](record-format.md).
- Every event the engine writes is listed in [events.md](events.md).
- How errors are written, and the three error options, are in [errors.md](errors.md).

## With no options

`createServer()` with no `log` option writes:

- `skeld.server.listening` and `skeld.server.closed`;
- the engine's error records, `skeld.request.error` and `skeld.hook.error`;
- the `security` refusals at `warn`: framing, path, parameter length, body limit, body depth, forbidden key, cross-site and preflight;
- `skeld.log.dropped`, `skeld.log.suppressed` and `skeld.config.public_origin` when they occur;
- every author call at `info` and above.

It does not write the access record, the `info` refusals (validation, not found, media type, invalid JSON), inbound correlation headers, the client's address, or any error text beyond a recognised class name and code.

`log: false` writes no record and makes no sink call; every logger method returns at once and `logStats()` returns zeros. Request ids and the `x-request-id` header stay.

## Options

The `log` option of `createServer` is a `LogOptions` object (from `@skeld/core/log`) or `false`. An unknown key, or a value of the wrong type, throws BootError `INVALID_OPTION` from `createServer`.

| Option                | Type                        | Default      | Effect                                                                                 |
| --------------------- | --------------------------- | ------------ | -------------------------------------------------------------------------------------- |
| `access`              | `boolean`                   | `false`      | one `skeld.request.closed` record per request when its response closes                 |
| `thresholds.boot`     | `Severity`                  | `'info'`     | lowest severity written for server records                                             |
| `thresholds.app`      | `Severity`                  | `'info'`     | lowest severity written for author records and the engine's error records              |
| `thresholds.security` | `Severity`                  | `'warn'`     | lowest severity written for refusals                                                   |
| `correlation`         | `boolean`                   | `false`      | reads `x-request-id` and `traceparent` from requests and writes them when well formed  |
| `clientAddress`       | `boolean`                   | `false`      | writes `client.address` on engine request records                                      |
| `errorIdentifiers`    | `boolean`                   | `false`      | writes an error's unlisted class name and code                                         |
| `errorText`           | `boolean`                   | `false`      | writes an error's message and its cause's message                                      |
| `errorFrames`         | `boolean`                   | `false`      | writes an error's stack frames; runs the process's stack formatter during the log call |
| `sink`                | `LogSink`                   | none: stdout | receives the records instead of stdout                                                 |
| `flushTimeoutMs`      | integer, 1 to 2,147,483,647 | `1000`       | how long `close()` waits for queued records to be written                              |

`Severity` is `'debug' | 'info' | 'warn' | 'error' | 'fatal'`. `fatal` is a severity only: it does not stop the process.

```ts
import { createServer } from '@skeld/core/server';

const server = createServer({ log: { access: true, thresholds: { security: 'info' } } });
server.log.info('cache warmed', { entries: 1200 });
```

## Loggers

| Where                                                       | Logger                                                  | Request id                                                 |
| ----------------------------------------------------------- | ------------------------------------------------------- | ---------------------------------------------------------- |
| `server.log`, and `log` on every plugin's scope             | the server's logger, usable from `createServer` on      | none                                                       |
| `request.log` in a handler, `log` on the five hook contexts | one logger per request, shared by its hooks and handler | the request's id and, with `correlation`, its trace fields |

`request.requestId` and `requestId` on the hook contexts hold the local id, a version 4 UUID. Application code cannot set the `x-request-id` header: it is reserved like the other headers the engine owns, so naming it in a reply is a compile error, and at run time the response is the fixed 500.

A logger has one method per severity, each `(message: string, fields?: LogFields) => void`. It never throws, before `listen` and after `close()` included. A call below the `app` threshold reads nothing of its fields. A call made before `listen` is written like any other, so `server.log` works from `createServer` on. After `close()` was called, a call's record is not written: it is counted as dropped with reason `shutdown`.

A field value is a string, number, boolean, `bigint`, `null`, `undefined`, a `Secret`, a `Classified` or an `Error`. Any other object, or an array, does not compile; at run time it is written `[unclassified]`. How each value is written is in [record-format.md](record-format.md#field-values).

## The redaction boundary

The logger writes what you pass it. A field value is written as given unless it is a `Secret` or a `Classified`; the schema's `secret` and `personal` marks apply only to a value the logger can see a schema for.

```ts
import { defineContract } from '@skeld/core/contract';
import * as t from '@skeld/core/schema';
import { createServer } from '@skeld/core/server';

const contract = defineContract({
  signup: {
    method: 'POST',
    path: '/signup',
    body: t.object({
      email: t.string({ maxLength: 254, sensitivity: 'personal' }),
      plan: t.union([t.literal('free'), t.literal('pro')]),
    }),
    responses: { 200: t.object({ ok: t.boolean() }) },
  },
});

const server = createServer();
server.routes(contract, {
  signup: (request) => {
    request.log.info('signup', { email: request.classified('body', 'email'), plan: request.body.plan });
    request.log.info('signup', { email: request.body.email });
    return { status: 200, body: { ok: true } };
  },
});
```

For a body of `{"email":"ada@example.com","plan":"pro"}`:

| Call                                         | `fields` written                                   |
| -------------------------------------------- | -------------------------------------------------- |
| `email: request.classified('body', 'email')` | `{"email":"[personal]","plan":"pro"}`              |
| `email: request.body.email`                  | `{"email":"ada@example.com"}`: the address in full |

The second call is a disclosure path. Passing a request value directly as a field writes it as it is; the route's schema is not consulted.

`request.classified(part, key)` pairs a part of the request (`'params'`, `'query'`, `'headers'`, `'cookies'` or `'body'`), or one key of it, with the route's own schema. For a value that is not part of a request, `classified` from `@skeld/core/log` pairs any value with a schema you give:

```ts
import { classified } from '@skeld/core/log';
import * as t from '@skeld/core/schema';
import { createServer } from '@skeld/core/server';

const User = t.object({
  id: t.string({ maxLength: 36 }),
  email: t.string({ maxLength: 254, sensitivity: 'personal' }),
});

const server = createServer();
server.log.warn('quota', { user: classified(User, { id: 'u-17', email: 'ada@example.com' }) });
```

The projection is taken inside the log call, so a call below its threshold walks nothing.

## Errors as fields

A caught value is `unknown`. Narrow it with `instanceof Error` before passing it as a field:

```ts
import { createServer } from '@skeld/core/server';

const server = createServer();

async function charge(): Promise<void> {
  throw new RangeError('amount out of range');
}

try {
  await charge();
} catch (err) {
  if (err instanceof Error) {
    server.log.warn('charge failed', { err, attempt: 2 });
  }
}
```

With no option, the field is written `{"type":"RangeError"}`: the nearest listed class and, when it has one, a listed code. [errors.md](errors.md) gives the lists and what each error option adds.

`instanceof Error` misses an error from another realm, such as one made in a `node:vm` context: that value is not narrowed, and the example above does not log it. For such errors, use `Error.isError`, which needs its TypeScript library declaration and a runtime that supports it. Do not cast an unchecked value to `Error`: the compiler accepts any object with a `name` and a `message` as an `Error`, while at run time only `Error.isError` decides how a field is read.

## Where records go

Records go to fd 1, written directly; the logger never reads `process.stdout` or `process.stderr`. With `sink`, each server's records go to its sink instead.

A `LogSink` receives a frozen array of finished lines, each without its newline, at most 65,536 bytes per call. It is called from its own task, never on a request's stack, and the next call waits for the last to settle. A sink that throws or rejects loses that batch, counted as `sink_failed`; the next batch is tried. A sink has no timeout.

```ts
import { appendFile } from 'node:fs/promises';
import { createServer } from '@skeld/core/server';

const server = createServer({
  log: {
    sink: async (records) => {
      await appendFile('app.log', `${records.join('\n')}\n`);
    },
  },
});
server.log.info('started');
```

A log call made inside the sink only queues its record.

## Isolation from requests

On Linux, writing records never blocks the event loop and a failing destination does not change any response: while stdout's reader is stalled or has exited, or a sink throws, rejects, never settles or logs, requests are answered with their normal status, and records past the queue are dropped and counted. On Linux this holds with fd 1 a file, a pipe (read, stalled or closed) or a terminal, blocking or not. It is not stated for other platforms.

Two exceptions:

- **A synchronous sink.** A sink runs on the event loop. Synchronous work inside it blocks every request for as long as it runs; neither a promise nor a `try`/`catch` can isolate it. Keep a sink's work asynchronous and short.
- **`errorFrames`.** Enabling errorFrames permits application stack-formatting code to execute synchronously during logging. Skeld catches formatter exceptions and omits frames for non-string results, but cannot bound execution time or undo side effects. Frame limits bound the output, not the work required to obtain it.

## Queue, flush and shutdown

- Each server has a queue of at most 1 MiB, counting both waiting bytes and bytes handed to a write or sink call. A record that would pass the cap is dropped as `queue_full`. Once 768 KiB are held, a record below `warn` is dropped as `reserve`.
- Queued records are written in batches of whole lines, at most 64 KiB. A queued record never waits for a later request: a timer starts the next batch, 5 ms after a record is queued in this release; that delay is an implementation value, not a guarantee.
- One write to fd 1 is active per process, not per server. Servers in one process take turns, one batch each. A write that fails with any error but `EAGAIN` loses its batch, counted as `write_failed`; the next batch is tried. On `EAGAIN` the same batch is tried again after 10 ms, without limit.
- `close()` closes connections, runs disposers, writes `skeld.server.closed` and pending suppression summaries, then waits for the queue to empty, for at most `flushTimeoutMs`. At the deadline, records still queued are dropped as `shutdown` and `close()` resolves. A batch already handed over stays in flight: the deadline cancels nothing and bounds what `close()` waits for, not the write or the process's exit. `close()` never rejects for a log reason.
- While one write is still active, no other server of the process writes to stdout. Its records wait in its own queue, under its own cap, until that write settles.

## Stats

`server.logStats()` returns this server's counts as a `LogStats`. It never throws, works before and after `close()`, and returns zeros under `log: false`.

| Field                       | Counts                                                                                                         |
| --------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `created`                   | records past their threshold and suppression                                                                   |
| `written`                   | records whose write or sink call completed without error; nothing is known of a reader                         |
| `queued`, `queuedBytes`     | records and bytes waiting in the queue                                                                         |
| `inFlight`, `inFlightBytes` | records and bytes handed to a write or sink call that has not settled                                          |
| `pendingMs`                 | age of the process's active stdout write, whichever server owns it, or of this server's sink call; 0 when none |
| `suppressed`                | records refused by suppression; they were never created                                                        |
| `dropped`                   | records dropped, by reason: `queue_full`, `reserve`, `write_failed`, `sink_failed`, `shutdown`                 |

At every call, `created` equals `written + queued + inFlight` plus every dropped count. A batch that settles after `close()` resolved moves once, to `written`, `write_failed` or `sink_failed`, never to `shutdown`.

```ts
import { createServer } from '@skeld/core/server';

const server = createServer();
await server.listen({ port: 0, host: '127.0.0.1' });
await server.close();

const stats = server.logStats();
process.stderr.write(`dropped at shutdown: ${stats.dropped.shutdown}, in flight: ${stats.inFlight}\n`);
```

## Limits

| Limit                                                    | Value                              |
| -------------------------------------------------------- | ---------------------------------- |
| one record                                               | 8,192 bytes of UTF-8               |
| message, a string field, an error's message or cause     | 1,024 UTF-16 units                 |
| a field name                                             | 64 units                           |
| fields per call                                          | 32                                 |
| nodes of one `Classified` value                          | 256                                |
| errors read per record                                   | 2                                  |
| stack frames per error, and units per frame              | 10, 256                            |
| an unlisted class name or code                           | 128 units                          |
| prototypes walked per error                              | 16                                 |
| queue per server; the part reserved for `warn` and above | 1 MiB; the last 256 KiB            |
| one batch                                                | 64 KiB                             |
| records per event and route in one suppression window    | 20 per 10 s                        |
| retry after `EAGAIN`                                     | 10 ms                              |
| `close()` flush deadline                                 | `flushTimeoutMs`, default 1,000 ms |

## Accepted risks

- **Shared stdout.** Valid JSON serialization does not guarantee intact lines when uncoordinated writers share the pipe. Reserve stdout for structured logs and send incidental output to stderr. Skeld's writer coordination covers its own writes.
- **Hung sink.** Delivery stops for that server's sink until the pending call settles; a permanently pending call requires a restart under this design. Queue limits and drop accounting remain active. `logStats()` needs an independent monitoring path: the broken sink cannot report its own failure reliably.
- **Final record.** `skeld.server.closed` contains a snapshot before flushing, not final delivery totals. Post-close statistics distinguish known discarded records (`dropped.shutdown`) from still-uncertain in-flight delivery (`inFlight`).
