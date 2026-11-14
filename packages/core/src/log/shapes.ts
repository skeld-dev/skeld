// Does:  Declares the logger's internal shapes shared by its parts and the engine: options, request state, records.
// Holds: Nothing past a ServerLog call holds a request, a schema or a thrown value; records carry only plain data.

import type { Schema } from '../schema/types.ts';
import type { Category, ErrorEvent, HookErrorReason, RefusalEvent, RequestErrorReason } from './events.ts';
import type { LogSink, LogStats, Logger, RequestPart, Severity } from './types.ts';

// Does:  The checked `log` option; `enabled` is false only for `log: false`, and then every flag is false too.
export interface ResolvedLog {
  readonly enabled: boolean;
  readonly access: boolean;
  readonly thresholds: { readonly boot: number; readonly app: number; readonly security: number };
  readonly correlation: boolean;
  readonly clientAddress: boolean;
  readonly errorIdentifiers: boolean;
  readonly errorText: boolean;
  readonly errorFrames: boolean;
  readonly sink: LogSink | null;
  readonly flushTimeoutMs: number;
}

// Does:  One request's log state, made at point.start; route and address are filled in by the engine later.
export interface RequestLog {
  readonly id: string;
  readonly startedAt: number;
  readonly method: string;
  readonly traceId: string | null;
  readonly traceFlags: string | null;
  readonly inboundId: string | null;
  route: string | null;
  address: string | null;
}

export interface ErrorOptions {
  readonly identifiers: boolean;
  readonly text: boolean;
  readonly frames: boolean;
  readonly cwd: string;
}

// Does:  What the error reader read: bounded raw strings, every one null unless kind is error.
export interface ErrorPart {
  readonly kind: 'error' | 'non_error' | 'unreadable';
  readonly type: string | null;
  readonly code: string | null;
  readonly message: string | null;
  readonly cause: string | null;
  readonly frames: string | null;
}

export interface EncodedFields {
  readonly members: readonly string[];
  readonly omitted: number;
}

export interface RecordParts {
  readonly timeMs: number;
  readonly severity: Severity;
  readonly event: string;
  readonly category: Category;
  readonly message: string | null;
  readonly request: RequestLog | null;
  readonly engine: boolean;
  readonly status: number | null;
  readonly errorType: string | null;
  readonly reason: string | null;
  readonly error: ErrorPart | null;
  readonly extra: readonly (readonly [string, string | number])[] | null;
  readonly fields: EncodedFields | null;
}

export type QueueCounts = Omit<LogStats, 'suppressed'>;

export interface Destination {
  // Does:  Queues one line; reserve is whether it may use the last part of the queue kept back from ordinary records.
  enqueue(line: string, reserve: boolean): boolean;
  counts(): QueueCounts;
  close(timeoutMs: number): Promise<void>;
}

export type SuppressedEvent = RefusalEvent | ErrorEvent;

export interface Suppression {
  ready(templates: readonly string[]): void;
  admit(event: SuppressedEvent, route: string | null): boolean;
  suppressed(): number;
  flush(): void;
}

export interface Correlation {
  readonly inboundId: string | null;
  readonly traceId: string | null;
  readonly traceFlags: string | null;
}

export type PartSchemas = {
  readonly [P in RequestPart]: { readonly whole: Schema; readonly keys: ReadonlyMap<string, Schema> | null } | null;
};

export interface ServerLog {
  readonly access: boolean;
  readonly correlation: boolean;
  readonly clientAddress: boolean;
  ready(templates: readonly string[], cwd: string): void;
  listening(address: string, port: number): void;
  publicOriginHint(): void;
  refused(event: RefusalEvent, request: RequestLog, status: number, errorType: string, reason: string | null): void;
  failed(
    event: ErrorEvent,
    request: RequestLog | null,
    status: number | null,
    errorType: string | null,
    reason: RequestErrorReason | HookErrorReason,
    read: boolean,
    value: unknown,
    detail: readonly [string, string | number] | null,
  ): void;
  ended(request: RequestLog, outcome: 'completed' | 'aborted', status: number | null, durationMs: number): void;
  logger(request: RequestLog | null): Logger;
  stats(): LogStats;
  close(): Promise<void>;
}
