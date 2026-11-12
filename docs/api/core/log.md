# @skeld/core/log

## Classified

A value paired with a schema by `classified`, written through that schema's projection.

Only a value made by `classified` or `request.classified` is recognised; a look-alike object is `[unclassified]`.

```ts
export interface Classified {
  readonly '~classified': true;
}
```

| Field         | Summary                                                                                    |
| ------------- | ------------------------------------------------------------------------------------------ |
| `~classified` | Marks the type; a value carrying it is still `[unclassified]` unless `classified` made it. |

Source: `packages/core/src/log/types.ts:13`

## DropReason

Why a record was dropped after it was created.

```ts
export type DropReason = 'queue_full' | 'reserve' | 'write_failed' | 'sink_failed' | 'shutdown';
```

Source: `packages/core/src/log/types.ts:40`

## LogFields

The fields of a log call; at most 32 are written, in key order.

```ts
export interface LogFields {
  /** One field: an `undefined` value leaves the key out, a `Secret` is written `[secret]`. */
  readonly [name: string]: LogValue;
}
```

Source: `packages/core/src/log/types.ts:22`

## LogOptions

The `log` option of `createServer`; every boolean defaults to `false`.

An unknown key or a value of the wrong type throws BootError `INVALID_OPTION` from `createServer`.

```ts
export interface LogOptions {
  readonly access?: boolean;
  readonly thresholds?: {
    /** Server records: listening, closed, configuration hints and drops. */
    readonly boot?: Severity;
    /** Author records and the engine's error records. */
    readonly app?: Severity;
    /** Refusals of malformed, cross-site or invalid requests. */
    readonly security?: Severity;
  };
  readonly correlation?: boolean;
  readonly clientAddress?: boolean;
  readonly errorIdentifiers?: boolean;
  readonly errorText?: boolean;
  readonly errorFrames?: boolean;
  readonly sink?: LogSink;
  readonly flushTimeoutMs?: number;
}
```

| Field              | Summary                                                                                                |
| ------------------ | ------------------------------------------------------------------------------------------------------ |
| `access`           | Writes one access record per request when its response closes.                                         |
| `thresholds`       | The lowest severity written per category (defaults: `boot` and `app` `info`, `security` `warn`).       |
| `correlation`      | Reads `x-request-id` and `traceparent` from requests and writes them when well formed.                 |
| `clientAddress`    | Writes the client's address on engine request records.                                                 |
| `errorIdentifiers` | Writes an error's own class name and code when they are not on the recognised lists.                   |
| `errorText`        | Writes an error's message and its cause's message, which may hold unclassified text.                   |
| `errorFrames`      | Writes an error's stack frames, which runs the process's stack formatter during the log call.          |
| `sink`             | Receives the records instead of stdout.                                                                |
| `flushTimeoutMs`   | Time `close()` waits for queued records to be written, in ms, from 1 to 2,147,483,647 (default 1,000). |

Source: `packages/core/src/log/types.ts:71`

## LogSink

A destination that replaces stdout: it receives a frozen array of finished lines, each without its newline.

A call holds at most 65,536 bytes of lines; a throw or rejection drops the batch as `sink_failed`.

```ts
export type LogSink = (records: readonly string[]) => void | Promise<void>;
```

Source: `packages/core/src/log/types.ts:37`

## LogStats

A server's record counts; `created` equals `written + queued + inFlight` plus every dropped count.

```ts
export interface LogStats {
  readonly created: number;
  readonly written: number;
  readonly queued: number;
  readonly queuedBytes: number;
  readonly inFlight: number;
  readonly inFlightBytes: number;
  readonly pendingMs: number;
  readonly suppressed: number;
  readonly dropped: { readonly [R in DropReason]: number };
}
```

| Field           | Summary                                                                                               |
| --------------- | ----------------------------------------------------------------------------------------------------- |
| `created`       | Records created: past their threshold and suppression.                                                |
| `written`       | Records whose write or sink call completed without error; nothing is known of a reader.               |
| `queued`        | Records waiting in the queue.                                                                         |
| `queuedBytes`   | Bytes waiting in the queue, each line counted with its newline.                                       |
| `inFlight`      | Records handed to a write or sink call that has not settled.                                          |
| `inFlightBytes` | Bytes handed to a write or sink call that has not settled, each line counted with its newline.        |
| `pendingMs`     | Age in milliseconds of the process's active stdout write, or of this server's sink call; 0 when none. |
| `suppressed`    | Records refused by suppression; they were never created.                                              |
| `dropped`       | Records dropped, by reason.                                                                           |

Source: `packages/core/src/log/types.ts:46`

## LogValue

A value a log call accepts as a field: a scalar, a `Secret`, a `Classified` or an `Error`.

```ts
export type LogValue = string | number | boolean | bigint | null | undefined | Secret<unknown> | Classified | Error;
```

Source: `packages/core/src/log/types.ts:19`

## Logger

A logger: one method per severity, each taking a message and optional fields.

It never throws, before `listen` and after `close()` too; a call below its threshold reads nothing.

```ts
export type Logger = { readonly [S in Severity]: (message: string, fields?: LogFields) => void };
```

Source: `packages/core/src/log/types.ts:31`

## RequestPart

The part of a request a route declares a schema for.

```ts
export type RequestPart = 'params' | 'query' | 'headers' | 'cookies' | 'body';
```

Source: `packages/core/src/log/types.ts:43`

## Severity

A record's severity, from least to most severe.

```ts
export type Severity = 'debug' | 'info' | 'warn' | 'error' | 'fatal';
```

Source: `packages/core/src/log/types.ts:7`

## classified

Pairs a value, a scalar included, with a schema, so a log call writes it through that schema's projection.

Nothing is read until a log call passes its threshold; a first argument that is not a schema is `[unclassified]`.

```ts
export function classified(schema: Schema, value: unknown): Classified;
```

```ts
classified(t.string({ maxLength: 64, sensitivity: 'personal' }), 'ada@example.com');
```

Source: `packages/core/src/log/log.ts:28`
