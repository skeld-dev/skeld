// Does:  Declares the logger's public types: options, severities, the logger, its field values and the stats.
// Holds: A field value is a scalar, a Secret, a Classified or an Error; any other object or an array does not compile.

import type { Secret } from '../schema/secret.ts';

/** A record's severity, from least to most severe. */
export type Severity = 'debug' | 'info' | 'warn' | 'error' | 'fatal';

/**
 * A value paired with a schema by `classified`, written through that schema's projection.
 * Only a value made by `classified` or `request.classified` is recognised; a look-alike object is `[unclassified]`.
 */
export interface Classified {
  /** Marks the type; a value carrying it is still `[unclassified]` unless `classified` made it. */
  readonly '~classified': true;
}

/** A value a log call accepts as a field: a scalar, a `Secret`, a `Classified` or an `Error`. */
export type LogValue = string | number | boolean | bigint | null | undefined | Secret<unknown> | Classified | Error;

/** The fields of a log call; at most 32 are written, in key order. */
export interface LogFields {
  /** One field: an `undefined` value leaves the key out, a `Secret` is written `[secret]`. */
  readonly [name: string]: LogValue;
}

/**
 * A logger: one method per severity, each taking a message and optional fields.
 * It never throws, before `listen` and after `close()` too; a call below its threshold reads nothing.
 */
export type Logger = { readonly [S in Severity]: (message: string, fields?: LogFields) => void };

/**
 * A destination that replaces stdout: it receives a frozen array of finished lines, each without its newline.
 * A call holds at most 65,536 bytes of lines; a throw or rejection drops the batch as `sink_failed`.
 */
export type LogSink = (records: readonly string[]) => void | Promise<void>;

/** Why a record was dropped after it was created. */
export type DropReason = 'queue_full' | 'reserve' | 'write_failed' | 'sink_failed' | 'shutdown';

/** The part of a request a route declares a schema for. */
export type RequestPart = 'params' | 'query' | 'headers' | 'cookies' | 'body';

/** A server's record counts; `created` equals `written + queued + inFlight` plus every dropped count. */
export interface LogStats {
  /** Records created: past their threshold and suppression. */
  readonly created: number;
  /** Records whose write or sink call completed without error; nothing is known of a reader. */
  readonly written: number;
  /** Records waiting in the queue. */
  readonly queued: number;
  /** Bytes waiting in the queue, each line counted with its newline. */
  readonly queuedBytes: number;
  /** Records handed to a write or sink call that has not settled. */
  readonly inFlight: number;
  /** Bytes handed to a write or sink call that has not settled, each line counted with its newline. */
  readonly inFlightBytes: number;
  /** Age in milliseconds of the process's active stdout write, or of this server's sink call; 0 when none. */
  readonly pendingMs: number;
  /** Records refused by suppression; they were never created. */
  readonly suppressed: number;
  /** Records dropped, by reason. */
  readonly dropped: { readonly [R in DropReason]: number };
}

/**
 * The `log` option of `createServer`; every boolean defaults to `false`.
 * An unknown key or a value of the wrong type throws BootError `INVALID_OPTION` from `createServer`.
 */
export interface LogOptions {
  /** Writes one access record per request when its response closes. */
  readonly access?: boolean;
  /** The lowest severity written per category (defaults: `boot` and `app` `info`, `security` `warn`). */
  readonly thresholds?: {
    /** Server records: listening, closed, configuration hints and drops. */
    readonly boot?: Severity;
    /** Author records and the engine's error records. */
    readonly app?: Severity;
    /** Refusals of malformed, cross-site or invalid requests. */
    readonly security?: Severity;
  };
  /** Reads `x-request-id` and `traceparent` from requests and writes them when well formed. */
  readonly correlation?: boolean;
  /** Writes the client's address on engine request records. */
  readonly clientAddress?: boolean;
  /** Writes an error's own class name and code when they are not on the recognised lists. */
  readonly errorIdentifiers?: boolean;
  /** Writes an error's message and its cause's message, which may hold unclassified text. */
  readonly errorText?: boolean;
  /** Writes an error's stack frames, which runs the process's stack formatter during the log call. */
  readonly errorFrames?: boolean;
  /** Receives the records instead of stdout. */
  readonly sink?: LogSink;
  /** Time `close()` waits for queued records to be written, in ms, from 1 to 2,147,483,647 (default 1,000). */
  readonly flushTimeoutMs?: number;
}
