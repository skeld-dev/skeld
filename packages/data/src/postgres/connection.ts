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
import {
  Breach,
  createMessageReader,
  dataRowFields,
  errorFields,
  type Fields,
  type Frame,
  fieldsOf,
  readByte,
  readBytes,
  readDone,
  readInt16,
  readInt32,
  readString,
  readUint16,
} from './reader.ts';
import {
  createStartupProgress,
  type Started,
  StartupFailure,
  type StartupProgress,
  startSession,
  startupStage,
} from './startup.ts';
import type { PostgresTarget } from './target.ts';
import { openTransport, type Transport, TransportFailure } from './transport.ts';
import { ROW_COST, VALUE_COST } from '../session/result-cost.ts';
import { decodeValue } from './values.ts';
import { cancelRequest, cycleBytes, extendedCycle, query, terminate } from './wire.ts';

// Why: Until ReadyForQuery no message may pass 64 KiB, so a server not yet proven cannot make the client buffer more.
const CONNECT_MESSAGE_BYTES = 65_536;
// Why: Bind carries its parameter count in 16 bits (protocol-message-formats, Bind).
const MAX_PARAMETERS = 65_535;
const TRACKED = ['client_encoding', 'DateStyle', 'TimeZone'] as const;

// Why: Begin text is built only from these phrases, so no caller value ever reaches the SQL text.
const ISOLATION: ReadonlyMap<unknown, string> = new Map([
  ['read committed', 'isolation level read committed'],
  ['repeatable read', 'isolation level repeatable read'],
  ['serializable', 'isolation level serializable'],
]);

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

interface Inbox {
  readonly push: (frame: Frame) => void;
  readonly end: (reason: Reason) => void;
  readonly next: () => Promise<Frame>;
  readonly drain: () => Frame[];
}

// Does:  Queues inbound frames during startup, so the sign-in can await each server message in turn.
function createInbox(): Inbox {
  const frames: Frame[] = [];
  let waiter: { resolve: (frame: Frame) => void; reject: (error: LinkEnded) => void } | null = null;
  let ended: LinkEnded | null = null;
  return Object.freeze({
    push: (frame: Frame): void => {
      if (waiter === null) {
        frames.push(frame);
      } else {
        waiter.resolve(frame);
        waiter = null;
      }
    },
    end: (reason: Reason): void => {
      ended ??= new LinkEnded(reason);
      waiter?.reject(ended);
      waiter = null;
    },
    next: (): Promise<Frame> => {
      const frame = frames.shift();
      if (frame !== undefined) {
        return Promise.resolve(frame);
      }
      if (ended !== null) {
        return Promise.reject(ended);
      }
      return new Promise((resolve, reject) => {
        waiter = { resolve, reject };
      });
    },
    drain: (): Frame[] => frames.splice(0),
  });
}

interface Opened {
  readonly connection: PostgresConnection;
  readonly startup: (certificate: TLSSocket | null, progress: StartupProgress) => Promise<Started>;
}

// Does:  Builds a PostgreSQL connection over an open transport: startup first, then one cycle at a time.
function createConnection(target: PostgresTarget, transport: Transport): Opened {
  const socket: Socket = transport.socket;
  const stream: Socket | TLSSocket = transport.stream;
  const reader = createMessageReader(CONNECT_MESSAGE_BYTES);
  const closing = new AbortController();
  let inbox: Inbox | null = createInbox();
  let started: Started | null = null;
  let status: Status = 'idle';
  let cycle: Cycle | null = null;
  let doomed = false;
  let drifted = false;
  let cancelling = false;
  let cancelStream: Socket | TLSSocket | null = null;

  const destroy = (): void => {
    doomed = true;
    status = 'closed';
    closing.abort();
    cancelStream?.destroy();
    stream.destroy();
    socket.destroy();
  };

  const settle = (outcome: SessionResult | DataError): void => {
    const current = cycle;
    if (current === null) {
      return;
    }
    cycle = null;
    current.signal.removeEventListener('abort', onAbort);
    if (outcome instanceof DataError) {
      current.reject(outcome);
    } else {
      current.resolve(outcome);
    }
  };

  const fail = (error: DataError): void => {
    settle(error);
    destroy();
  };

  const refuse = (signal: AbortSignal, code: 'PARAMETERS_TOO_LARGE' | 'INVALID_QUERY'): Promise<never> =>
    Promise.reject(new DataError(signal.aborted ? 'CANCELLED' : code));

  const begin = (kind: CycleKind, text: string, signal: AbortSignal, encode: () => Buffer): Promise<SessionResult> => {
    if (signal.aborted) {
      return Promise.reject(new DataError('CANCELLED'));
    }
    if (cycle !== null) {
      throw new TypeError('A PostgreSQL connection runs one cycle at a time');
    }
    if (status === 'closed' || doomed) {
      return Promise.reject(failed('CONNECTION_LOST', 'lost'));
    }
    // Why: A NUL would end the text field early and the rest would be read as further message fields.
    if (text.includes('\0')) {
      return refuse(signal, 'INVALID_QUERY');
    }
    const bytes = encode();
    return new Promise((resolve, reject) => {
      cycle = {
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
      signal.addEventListener('abort', onAbort, { once: true });
      stream.write(bytes);
    });
  };

  const scriptLike = (kind: 'simple' | 'script', text: string, signal: AbortSignal): Promise<SessionResult> => {
    if (Buffer.byteLength(text, 'utf8') > target.bounds.maxParameterBytes) {
      return refuse(signal, 'PARAMETERS_TOO_LARGE');
    }
    return begin(kind, text, signal, () => query(text));
  };

  const run = (text: string, parameters: readonly Parameter[], signal: AbortSignal): Promise<SessionResult> => {
    if (parameters.length > MAX_PARAMETERS || cycleBytes(text, parameters) > target.bounds.maxParameterBytes) {
      return refuse(signal, 'PARAMETERS_TOO_LARGE');
    }
    return begin('extended', text, signal, () => extendedCycle(text, parameters));
  };

  // Does:  Dials the statement's own peer under the same TLS rules, sends the key as received, then closes the socket.
  // Holds: The statement's socket is destroyed whatever the cancel's outcome, and the cancel is counted once.
  const cancel = async (): Promise<void> => {
    const key = started;
    const address = socket.remoteAddress;
    const port = socket.remotePort;
    if (cancelling || key === null || address === undefined || port === undefined) {
      destroy();
      return;
    }
    cancelling = true;
    const bound = AbortSignal.timeout(target.bounds.connectTimeoutMs);
    const signal = AbortSignal.any([bound, closing.signal]);
    let outcome: 'processed' | 'failed' | 'timeout' = 'failed';
    try {
      const dialled = await openTransport(address, port, target, signal);
      cancelStream = dialled.stream;
      outcome = await new Promise((resolve) => {
        const abort = (): void => resolve(bound.aborted ? 'timeout' : 'failed');
        if (signal.aborted) {
          abort();
          return;
        }
        signal.addEventListener('abort', abort, { once: true });
        dialled.stream.once('close', () => {
          signal.removeEventListener('abort', abort);
          resolve('processed');
        });
        dialled.stream.write(cancelRequest(key.processId, key.key));
      });
      dialled.stream.destroy();
    } catch (error) {
      if (!(error instanceof TransportFailure)) {
        throw error;
      }
      outcome = bound.aborted ? 'timeout' : 'failed';
    } finally {
      cancelStream = null;
      count('data.pg.cancel', outcome);
      destroy();
    }
  };

  const onAbort = (): void => {
    if (cycle === null) {
      return;
    }
    doomed = true;
    settle(new DataError('CANCELLED'));
    void cancel();
  };

  const parameterStatus = (fields: Fields): void => {
    const name = readString(fields);
    const value = readString(fields);
    readDone(fields);
    const tracked = TRACKED.find((setting) => setting === name);
    if (tracked !== undefined && started?.settings.get(tracked) !== value) {
      drifted = true;
    }
  };

  const serverError = (fields: ReadonlyMap<string, string>): void => {
    const severity = fields.get('V');
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
    fail(markReason(new DataError('CONNECTION_LOST', { ...sqlStateOf(fields), detail }), 'server'));
  };

  const rowDescription = (current: Cycle, fields: Fields): void => {
    const total = readUint16(fields);
    const columns: string[] = [];
    const types: number[] = [];
    for (let index = 0; index < total; index += 1) {
      columns.push(readString(fields));
      readInt32(fields);
      readInt16(fields);
      types.push(readInt32(fields));
      readBytes(fields, 8);
    }
    readDone(fields);
    current.columns = columns;
    current.types = types;
    current.rows = [];
    current.bytes = 0;
    current.current = true;
  };

  const dataRow = (current: Cycle, body: Buffer): void => {
    if (!current.current) {
      throw new Breach();
    }
    const values = dataRowFields(body, current.columns.length);
    // Why: A script keeps no row, so only the reader's per-message bound applies to what it receives.
    if (current.kind === 'script') {
      return;
    }
    const columns = current.columns.length;
    // Why: The bound counts a kept row's memory: the row, each value, and the values' bytes without DataRow framing.
    current.bytes += ROW_COST + columns * VALUE_COST + (body.length - 2 - 4 * columns);
    if (current.bytes > target.bounds.maxResultBytes) {
      fail(failed('RESULT_TOO_LARGE', 'result-bound'));
      return;
    }
    current.rows.push(
      values.map((value, index) => (value === null ? null : decodeValue(current.types[index] ?? 0, value))),
    );
  };

  const commandComplete = (current: Cycle, fields: Fields): void => {
    const tag = commandTag(readString(fields));
    readDone(fields);
    // Why: The result is the last statement's, so a statement that returned no rows leaves no columns and no rows.
    if (!current.current) {
      current.columns = [];
      current.types = [];
      current.rows = [];
    }
    current.current = false;
    current.command = tag.command;
    current.rowCount = tag.rowCount;
  };

  const ready = (current: Cycle, fields: Fields): void => {
    const reported = STATUS.get(readByte(fields));
    readDone(fields);
    if (reported === undefined) {
      throw new Breach();
    }
    status = reported;
    if (current.error !== null) {
      settle(current.error);
      return;
    }
    const columns = Object.freeze(current.columns);
    const rows = Object.freeze(current.rows.map((row) => Object.freeze(row)));
    settle({ command: current.command, rowCount: current.rowCount, columns, rows });
  };

  const dispatch = (frame: Frame): void => {
    const fields = fieldsOf(frame.body);
    switch (frame.type) {
      case typeOf('N'):
      case typeOf('A'):
        return;
      case typeOf('S'):
        parameterStatus(fields);
        return;
      case typeOf('E'):
        serverError(errorFields(frame.body));
        return;
      default:
        break;
    }
    const current = cycle;
    if (current === null) {
      throw new Breach();
    }
    switch (frame.type) {
      case typeOf('1'):
      case typeOf('2'):
      case typeOf('n'):
      case typeOf('I'):
        readDone(fields);
        return;
      case typeOf('T'):
        rowDescription(current, fields);
        return;
      case typeOf('D'):
        dataRow(current, frame.body);
        return;
      case typeOf('C'):
        commandComplete(current, fields);
        return;
      case typeOf('Z'):
        ready(current, fields);
        return;
      case typeOf('G'):
      case typeOf('H'):
      case typeOf('W'):
        // Why: Data speaks no copy sub-protocol, so a copy response leaves the connection in a state it cannot leave.
        fail(failed('INVALID_QUERY', 'copy'));
        return;
      default:
        throw new Breach();
    }
  };

  const receive = (frame: Frame): void => {
    if (doomed) {
      return;
    }
    try {
      dispatch(frame);
    } catch (error) {
      if (!(error instanceof Breach)) {
        throw error;
      }
      fail(failed('PROTOCOL_VIOLATION', 'violation'));
    }
  };

  const deliver = (frame: Frame): boolean => {
    if (inbox !== null) {
      inbox.push(frame);
    } else {
      receive(frame);
    }
    return status !== 'closed' && !stream.destroyed;
  };

  const onData = (chunk: Buffer): void => {
    const breach = reader.push(chunk, deliver);
    if (breach === null) {
      return;
    }
    if (inbox !== null) {
      inbox.end('violation');
      destroy();
    } else if (breach === 'long') {
      fail(failed('RESULT_TOO_LARGE', 'result-bound'));
    } else {
      fail(failed('PROTOCOL_VIOLATION', 'violation'));
    }
  };

  const closed = new Promise<void>((resolve) => {
    stream.once('close', () => {
      status = 'closed';
      inbox?.end('closed');
      settle(failed('CONNECTION_LOST', 'lost'));
      resolve();
    });
  });
  stream.on('data', onData);

  const connection: PostgresConnection = Object.freeze({
    get protocol(): '3.2' | '3.0' {
      return started?.protocol ?? '3.2';
    },
    get status(): Status {
      return status;
    },
    get reusable(): boolean {
      return status === 'idle' && !doomed && !drifted && cycle === null;
    },
    closed,
    run,
    simple: (text: string, signal: AbortSignal): Promise<SessionResult> => scriptLike('simple', text, signal),
    script: async (text: string, signal: AbortSignal): Promise<void> => {
      await scriptLike('script', text, signal);
    },
    begin: async (options: TransactionOptions, signal: AbortSignal): Promise<void> => {
      const isolation = options.isolation === undefined ? null : ISOLATION.get(options.isolation);
      if (isolation === undefined) {
        return refuse(signal, 'INVALID_QUERY');
      }
      const modes = [...(isolation === null ? [] : [isolation]), ...(options.readOnly === true ? ['read only'] : [])];
      await run(modes.length === 0 ? 'begin' : `begin ${modes.join(', ')}`, [], signal);
    },
    commit: async (signal: AbortSignal): Promise<'committed' | 'rolled-back'> => {
      const result = await run('commit', [], signal);
      return result.command === 'COMMIT' ? 'committed' : 'rolled-back';
    },
    rollback: async (signal: AbortSignal): Promise<void> => {
      await run('rollback', [], signal);
    },
    restore: (): boolean => false,
    end: (): void => {
      if (status === 'closed') {
        return;
      }
      doomed = true;
      stream.end(terminate(), () => destroy());
    },
    destroy,
  });

  const startup = async (certificate: TLSSocket | null, progress: StartupProgress): Promise<Started> => {
    const queued = inbox;
    if (queued === null) {
      throw new TypeError('A PostgreSQL connection starts once');
    }
    const link = { next: () => queued.next(), write: (data: Buffer) => stream.write(data) };
    const opened = await startSession(link, target, certificate, progress);
    started = opened;
    inbox = null;
    reader.setLimit(target.bounds.maxResultBytes);
    for (const frame of queued.drain()) {
      receive(frame);
    }
    return opened;
  };

  return { connection, startup };
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
  const progress = createStartupProgress();
  let opened: Opened | null = null;
  const abort = (): void => opened?.connection.destroy();
  try {
    const transport = await openTransport(target.host, target.port, target, either);
    opened = createConnection(target, transport);
    either.addEventListener('abort', abort, { once: true });
    if (either.aborted) {
      opened.connection.destroy();
    }
    const started = await opened.startup(transport.certificate, progress);
    count('data.pg.protocol', started.protocol);
    count('data.pg.mechanism', started.mechanism);
    count('data.pg.key_bytes', String(started.key.length));
    return opened.connection;
  } catch (error) {
    opened?.connection.destroy();
    if (signal.aborted) {
      throw new DataError('CANCELLED');
    }
    const failure = classify(error, startupStage(progress), bound.aborted);
    count('data.connect.failed', failure.stage ?? startupStage(progress));
    throw failure;
  } finally {
    either.removeEventListener('abort', abort);
    endSpan(token);
  }
}
