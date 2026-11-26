// Does:  Opens a PostgreSQL connection and runs its cycles, its cancel and its close on one socket.
// Holds: A cycle settles once; a call during one fails with TypeError, other failures are DataErrors without SQL text.

import type { Socket } from 'node:net';
import type { TLSSocket } from 'node:tls';
import { count, end as endSpan, start as startSpan } from '#diag';
import { DataError } from '../data-error/data-error.ts';
import { markReason, type Reason } from '../data-error/reason.ts';
import type { ConnectStage, DatabaseDetail } from '../data-error/types.ts';
import type { TransactionOptions } from '../database/types.ts';
import type { SessionResult } from '../session/types.ts';
import type { Parameter } from '../sql/types.ts';
import type { PostgresConnection } from './connection-types.ts';
import { Breach, dataRowFields, errorFields, Fields, type Frame, MessageReader } from './reader.ts';
import { type Started, StartupFailure, StartupProgress, startSession } from './startup.ts';
import type { PostgresTarget } from './target.ts';
import { openTransport, type Transport, TransportFailure } from './transport.ts';
import { decodeValue } from './values.ts';
import { cancelRequest, cycleBytes, extendedCycle, query, terminate } from './wire.ts';

// Why: Until ReadyForQuery no message may pass 64 KiB, so a server not yet proven cannot make the client buffer more.
const CONNECT_MESSAGE_BYTES = 65_536;
// Why: Bind carries its parameter count in 16 bits (protocol-message-formats, Bind).
const MAX_PARAMETERS = 65_535;
const TRACKED = ['client_encoding', 'DateStyle', 'TimeZone'] as const;

type Status = 'idle' | 'transaction' | 'failed' | 'closed';
type CycleKind = 'extended' | 'simple' | 'script';

function typeOf(letter: string): number {
  return letter.charCodeAt(0);
}

const STATUS: ReadonlyMap<number, Exclude<Status, 'closed'>> = new Map([
  [typeOf('I'), 'idle'],
  [typeOf('T'), 'transaction'],
  [typeOf('E'), 'failed'],
]);

function failed(code: 'CONNECTION_LOST' | 'PROTOCOL_VIOLATION' | 'RESULT_TOO_LARGE' | 'INVALID_QUERY', reason: Reason) {
  return markReason(new DataError(code), reason);
}

function serverDetail(fields: ReadonlyMap<string, string>, sql: string | null): Partial<DatabaseDetail> {
  const pick = (letter: string): string | null => fields.get(letter) ?? null;
  return {
    message: pick('M'),
    detail: pick('D'),
    hint: pick('H'),
    where: pick('W'),
    constraint: pick('n'),
    table: pick('t'),
    column: pick('c'),
    sql,
  };
}

function sqlStateOf(fields: ReadonlyMap<string, string>): { sqlState?: string } {
  const sqlState = fields.get('C');
  return sqlState === undefined ? {} : { sqlState };
}

interface Cycle {
  readonly kind: CycleKind;
  readonly text: string;
  readonly signal: AbortSignal;
  readonly resolve: (result: SessionResult) => void;
  readonly reject: (error: DataError) => void;
  columns: string[];
  types: number[];
  rows: unknown[][];
  current: boolean;
  bytes: number;
  command: string;
  rowCount: number | null;
  error: DataError | null;
}

function commandTag(tag: string): { command: string; rowCount: number | null } {
  const words = tag.split(' ');
  const last = words.at(-1) ?? '';
  return { command: words[0] ?? '', rowCount: words.length > 1 && /^[0-9]+$/.test(last) ? Number(last) : null };
}

class LinkEnded extends Error {
  readonly reason: Reason;

  constructor(reason: Reason) {
    super('link ended');
    this.reason = reason;
  }
}

// Does:  Queues inbound frames during startup, so the sign-in can await each server message in turn.
class Inbox {
  readonly #frames: Frame[] = [];
  #waiter: { resolve: (frame: Frame) => void; reject: (error: LinkEnded) => void } | null = null;
  #ended: LinkEnded | null = null;

  push(frame: Frame): void {
    if (this.#waiter === null) {
      this.#frames.push(frame);
    } else {
      this.#waiter.resolve(frame);
      this.#waiter = null;
    }
  }

  end(reason: Reason): void {
    this.#ended ??= new LinkEnded(reason);
    this.#waiter?.reject(this.#ended);
    this.#waiter = null;
  }

  next(): Promise<Frame> {
    const frame = this.#frames.shift();
    if (frame !== undefined) {
      return Promise.resolve(frame);
    }
    if (this.#ended !== null) {
      return Promise.reject(this.#ended);
    }
    return new Promise((resolve, reject) => {
      this.#waiter = { resolve, reject };
    });
  }

  drain(): Frame[] {
    return this.#frames.splice(0);
  }
}

// Does:  Implements a PostgreSQL connection over an open transport: startup first, then one cycle at a time.
class Connection implements PostgresConnection {
  readonly #target: PostgresTarget;
  readonly #socket: Socket;
  readonly #stream: Socket | TLSSocket;
  readonly #reader = new MessageReader(CONNECT_MESSAGE_BYTES);
  readonly #closing = new AbortController();
  readonly closed: Promise<void>;
  #inbox: Inbox | null = new Inbox();
  #started: Started | null = null;
  #status: Status = 'idle';
  #cycle: Cycle | null = null;
  #doomed = false;
  #drifted = false;
  #cancelling = false;
  #cancelStream: Socket | TLSSocket | null = null;

  constructor(target: PostgresTarget, transport: Transport) {
    this.#target = target;
    this.#socket = transport.socket;
    this.#stream = transport.stream;
    this.closed = new Promise((resolve) => {
      this.#stream.once('close', () => {
        this.#onClose();
        resolve();
      });
    });
    this.#stream.on('data', (chunk: Buffer) => this.#onData(chunk));
  }

  get protocol(): '3.2' | '3.0' {
    return this.#started?.protocol ?? '3.2';
  }

  get status(): Status {
    return this.#status;
  }

  get reusable(): boolean {
    return this.#status === 'idle' && !this.#doomed && !this.#drifted && this.#cycle === null;
  }

  async startup(certificate: TLSSocket | null, progress: StartupProgress): Promise<Started> {
    const inbox = this.#inbox;
    if (inbox === null) {
      throw new TypeError('A PostgreSQL connection starts once');
    }
    const link = { next: () => inbox.next(), write: (data: Buffer) => this.#stream.write(data) };
    const started = await startSession(link, this.#target, certificate, progress);
    this.#started = started;
    this.#inbox = null;
    this.#reader.limit = this.#target.bounds.maxResultBytes;
    for (const frame of inbox.drain()) {
      this.#receive(frame);
    }
    return started;
  }

  run(text: string, parameters: readonly Parameter[], signal: AbortSignal): Promise<SessionResult> {
    if (parameters.length > MAX_PARAMETERS || cycleBytes(text, parameters) > this.#target.bounds.maxParameterBytes) {
      return this.#refuse(signal, 'PARAMETERS_TOO_LARGE');
    }
    return this.#begin('extended', text, signal, () => extendedCycle(text, parameters));
  }

  simple(text: string, signal: AbortSignal): Promise<SessionResult> {
    return this.#scriptLike('simple', text, signal);
  }

  async script(text: string, signal: AbortSignal): Promise<void> {
    await this.#scriptLike('script', text, signal);
  }

  async begin(options: TransactionOptions, signal: AbortSignal): Promise<void> {
    const modes = [
      ...(options.isolation === undefined ? [] : [`isolation level ${options.isolation}`]),
      ...(options.readOnly === true ? ['read only'] : []),
    ];
    await this.run(modes.length === 0 ? 'begin' : `begin ${modes.join(', ')}`, [], signal);
  }

  async commit(signal: AbortSignal): Promise<'committed' | 'rolled-back'> {
    const result = await this.run('commit', [], signal);
    return result.command === 'COMMIT' ? 'committed' : 'rolled-back';
  }

  async rollback(signal: AbortSignal): Promise<void> {
    await this.run('rollback', [], signal);
  }

  restore(): boolean {
    return false;
  }

  end(): void {
    if (this.#status === 'closed') {
      return;
    }
    this.#doomed = true;
    this.#stream.end(terminate(), () => this.destroy());
  }

  destroy(): void {
    this.#doomed = true;
    this.#status = 'closed';
    this.#closing.abort();
    this.#cancelStream?.destroy();
    this.#stream.destroy();
    this.#socket.destroy();
  }

  #scriptLike(kind: 'simple' | 'script', text: string, signal: AbortSignal): Promise<SessionResult> {
    if (Buffer.byteLength(text, 'utf8') > this.#target.bounds.maxParameterBytes) {
      return this.#refuse(signal, 'PARAMETERS_TOO_LARGE');
    }
    return this.#begin(kind, text, signal, () => query(text));
  }

  #refuse(signal: AbortSignal, code: 'PARAMETERS_TOO_LARGE' | 'INVALID_QUERY'): Promise<never> {
    return Promise.reject(new DataError(signal.aborted ? 'CANCELLED' : code));
  }

  #begin(kind: CycleKind, text: string, signal: AbortSignal, encode: () => Buffer): Promise<SessionResult> {
    if (signal.aborted) {
      return Promise.reject(new DataError('CANCELLED'));
    }
    if (this.#cycle !== null) {
      throw new TypeError('A PostgreSQL connection runs one cycle at a time');
    }
    if (this.#status === 'closed' || this.#doomed) {
      return Promise.reject(failed('CONNECTION_LOST', 'lost'));
    }
    // Why: A NUL would end the text field early and the rest would be read as further message fields.
    if (text.includes('\0')) {
      return this.#refuse(signal, 'INVALID_QUERY');
    }
    const bytes = encode();
    return new Promise((resolve, reject) => {
      const cycle: Cycle = {
        kind,
        text,
        signal,
        resolve,
        reject,
        columns: [],
        types: [],
        rows: [],
        current: false,
        bytes: 0,
        command: '',
        rowCount: null,
        error: null,
      };
      this.#cycle = cycle;
      signal.addEventListener('abort', this.#onAbort, { once: true });
      this.#stream.write(bytes);
    });
  }

  #settle(outcome: SessionResult | DataError): void {
    const cycle = this.#cycle;
    if (cycle === null) {
      return;
    }
    this.#cycle = null;
    cycle.signal.removeEventListener('abort', this.#onAbort);
    if (outcome instanceof DataError) {
      cycle.reject(outcome);
    } else {
      cycle.resolve(outcome);
    }
  }

  #fail(error: DataError): void {
    this.#settle(error);
    this.destroy();
  }

  #onData(chunk: Buffer): void {
    const breach = this.#reader.push(chunk, (frame) => {
      if (this.#inbox !== null) {
        this.#inbox.push(frame);
      } else {
        this.#receive(frame);
      }
      return this.#status !== 'closed' && !this.#stream.destroyed;
    });
    if (breach === null) {
      return;
    }
    if (this.#inbox !== null) {
      this.#inbox.end('violation');
      this.destroy();
    } else if (breach === 'long') {
      this.#fail(failed('RESULT_TOO_LARGE', 'result-bound'));
    } else {
      this.#fail(failed('PROTOCOL_VIOLATION', 'violation'));
    }
  }

  #onClose(): void {
    this.#status = 'closed';
    this.#inbox?.end('closed');
    this.#settle(failed('CONNECTION_LOST', 'lost'));
  }

  readonly #onAbort = (): void => {
    const cycle = this.#cycle;
    if (cycle === null) {
      return;
    }
    this.#doomed = true;
    this.#settle(new DataError('CANCELLED'));
    void this.#cancel();
  };

  // Does:  Dials the statement's own peer under the same TLS rules, sends the key as received, then closes the socket.
  // Holds: The statement's socket is destroyed whatever the cancel's outcome, and the cancel is counted once.
  async #cancel(): Promise<void> {
    const started = this.#started;
    const address = this.#socket.remoteAddress;
    const port = this.#socket.remotePort;
    if (this.#cancelling || started === null || address === undefined || port === undefined) {
      this.destroy();
      return;
    }
    this.#cancelling = true;
    const bound = AbortSignal.timeout(this.#target.bounds.connectTimeoutMs);
    const signal = AbortSignal.any([bound, this.#closing.signal]);
    let outcome: 'processed' | 'failed' | 'timeout' = 'failed';
    try {
      const transport = await openTransport(address, port, this.#target, signal);
      this.#cancelStream = transport.stream;
      outcome = await new Promise((resolve) => {
        const abort = (): void => resolve(bound.aborted ? 'timeout' : 'failed');
        if (signal.aborted) {
          abort();
          return;
        }
        signal.addEventListener('abort', abort, { once: true });
        transport.stream.once('close', () => {
          signal.removeEventListener('abort', abort);
          resolve('processed');
        });
        transport.stream.write(cancelRequest(started.processId, started.key));
      });
      transport.stream.destroy();
    } catch (error) {
      if (!(error instanceof TransportFailure)) {
        throw error;
      }
      outcome = bound.aborted ? 'timeout' : 'failed';
    } finally {
      this.#cancelStream = null;
      count('data.pg.cancel', outcome);
      this.destroy();
    }
  }

  #receive(frame: Frame): void {
    if (this.#doomed) {
      return;
    }
    try {
      this.#dispatch(frame);
    } catch (error) {
      if (!(error instanceof Breach)) {
        throw error;
      }
      this.#fail(failed('PROTOCOL_VIOLATION', 'violation'));
    }
  }

  #dispatch(frame: Frame): void {
    const fields = new Fields(frame.body);
    switch (frame.type) {
      case typeOf('N'):
      case typeOf('A'):
        return;
      case typeOf('S'):
        this.#parameterStatus(fields);
        return;
      case typeOf('E'):
        this.#error(errorFields(frame.body));
        return;
      default:
        break;
    }
    const cycle = this.#cycle;
    if (cycle === null) {
      throw new Breach();
    }
    switch (frame.type) {
      case typeOf('1'):
      case typeOf('2'):
      case typeOf('n'):
      case typeOf('I'):
        fields.done();
        return;
      case typeOf('T'):
        this.#rowDescription(cycle, fields);
        return;
      case typeOf('D'):
        this.#dataRow(cycle, frame.body);
        return;
      case typeOf('C'):
        this.#commandComplete(cycle, fields);
        return;
      case typeOf('Z'):
        this.#ready(cycle, fields);
        return;
      case typeOf('G'):
      case typeOf('H'):
      case typeOf('W'):
        // Why: Data speaks no copy sub-protocol, so a copy response leaves the connection in a state it cannot leave.
        this.#fail(failed('INVALID_QUERY', 'copy'));
        return;
      default:
        throw new Breach();
    }
  }

  #parameterStatus(fields: Fields): void {
    const name = fields.string();
    const value = fields.string();
    fields.done();
    const tracked = TRACKED.find((setting) => setting === name);
    if (tracked !== undefined && this.#started?.settings.get(tracked) !== value) {
      this.#drifted = true;
    }
  }

  #error(fields: ReadonlyMap<string, string>): void {
    const severity = fields.get('V');
    const cycle = this.#cycle;
    if (severity === 'ERROR' && cycle !== null) {
      cycle.error ??= new DataError('QUERY_FAILED', {
        ...sqlStateOf(fields),
        detail: serverDetail(fields, cycle.text),
      });
      return;
    }
    if (severity !== 'FATAL' && severity !== 'PANIC' && severity !== 'ERROR') {
      throw new Breach();
    }
    const detail = serverDetail(fields, cycle?.text ?? null);
    // Why: An error while idle or a FATAL ends the session; the server closes it next.
    this.#fail(markReason(new DataError('CONNECTION_LOST', { ...sqlStateOf(fields), detail }), 'server'));
  }

  #rowDescription(cycle: Cycle, fields: Fields): void {
    const total = fields.uint16();
    const columns: string[] = [];
    const types: number[] = [];
    for (let index = 0; index < total; index += 1) {
      columns.push(fields.string());
      fields.int32();
      fields.int16();
      types.push(fields.int32());
      fields.bytes(8);
    }
    fields.done();
    cycle.columns = columns;
    cycle.types = types;
    cycle.rows = [];
    cycle.bytes = 0;
    cycle.current = true;
  }

  #dataRow(cycle: Cycle, body: Buffer): void {
    if (!cycle.current) {
      throw new Breach();
    }
    cycle.bytes += body.length;
    if (cycle.bytes > this.#target.bounds.maxResultBytes) {
      this.#fail(failed('RESULT_TOO_LARGE', 'result-bound'));
      return;
    }
    const values = dataRowFields(body, cycle.columns.length);
    if (cycle.kind === 'script') {
      return;
    }
    cycle.rows.push(
      values.map((value, index) => (value === null ? null : decodeValue(cycle.types[index] ?? 0, value))),
    );
  }

  #commandComplete(cycle: Cycle, fields: Fields): void {
    const tag = commandTag(fields.string());
    fields.done();
    // Why: The result is the last statement's, so a statement that returned no rows leaves no columns and no rows.
    if (!cycle.current) {
      cycle.columns = [];
      cycle.types = [];
      cycle.rows = [];
    }
    cycle.current = false;
    cycle.command = tag.command;
    cycle.rowCount = tag.rowCount;
  }

  #ready(cycle: Cycle, fields: Fields): void {
    const status = STATUS.get(fields.byte());
    fields.done();
    if (status === undefined) {
      throw new Breach();
    }
    this.#status = status;
    if (cycle.error !== null) {
      this.#settle(cycle.error);
      return;
    }
    const columns = Object.freeze(cycle.columns);
    const rows = Object.freeze(cycle.rows.map((row) => Object.freeze(row)));
    this.#settle({ command: cycle.command, rowCount: cycle.rowCount, columns, rows });
  }
}

function connectFailure(error: unknown): DataError {
  if (error instanceof TransportFailure || error instanceof StartupFailure) {
    const fields = error instanceof StartupFailure ? error.fields : null;
    const init = fields === null ? {} : { ...sqlStateOf(fields), detail: serverDetail(fields, null) };
    return markReason(new DataError('CONNECT_FAILED', { stage: error.stage, ...init }), error.reason);
  }
  throw error;
}

function classify(error: unknown, stage: ConnectStage, timedOut: boolean): DataError {
  if (timedOut) {
    const at = error instanceof TransportFailure || error instanceof StartupFailure ? error.stage : stage;
    return markReason(new DataError('CONNECT_FAILED', { stage: at }), 'timeout');
  }
  if (error instanceof LinkEnded) {
    return markReason(new DataError('CONNECT_FAILED', { stage }), error.reason);
  }
  if (error instanceof Breach) {
    return markReason(new DataError('CONNECT_FAILED', { stage }), 'violation');
  }
  return connectFailure(error);
}

export async function openPostgresConnection(target: PostgresTarget, signal: AbortSignal): Promise<PostgresConnection> {
  if (signal.aborted) {
    throw new DataError('CANCELLED');
  }
  const token = startSpan('data.pg.connect');
  const bound = AbortSignal.timeout(target.bounds.connectTimeoutMs);
  const either = AbortSignal.any([signal, bound]);
  const progress = new StartupProgress();
  let connection: Connection | null = null;
  const abort = (): void => connection?.destroy();
  try {
    const transport = await openTransport(target.host, target.port, target, either);
    connection = new Connection(target, transport);
    either.addEventListener('abort', abort, { once: true });
    if (either.aborted) {
      connection.destroy();
    }
    const started = await connection.startup(transport.certificate, progress);
    count('data.pg.protocol', started.protocol);
    count('data.pg.mechanism', started.mechanism);
    count('data.pg.key_bytes', String(started.key.length));
    return connection;
  } catch (error) {
    connection?.destroy();
    if (signal.aborted) {
      throw new DataError('CANCELLED');
    }
    const failure = classify(error, progress.stage, bound.aborted);
    count('data.connect.failed', failure.stage ?? progress.stage);
    throw failure;
  } finally {
    either.removeEventListener('abort', abort);
    endSpan(token);
  }
}
