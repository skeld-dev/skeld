// Does:  Builds a database's frozen public object and its plugin, and finds the internals behind a database later.
// Holds: Only a database built here has internals, and its plugin sets the events before the pool is opened.

import type { Logger } from '@skeld/core/log';
import { DataError } from '../data-error/data-error.ts';
import { type Reason, reasonOf } from '../data-error/reason.ts';
import type { Database, Owner } from '../database/types.ts';
import { failureFields, registerDataEvents } from '../events/events.ts';
import type { DataEvents } from '../events/types.ts';
import { bindDatabase } from './handle.ts';
import type { DatabaseInternals } from './internals-types.ts';

export interface Booted {
  readonly events: DataEvents | null;
  readonly log: Logger | null;
}

type PluginScope = Parameters<Database['plugin']>[0];

type Build = (booted: Booted, orphan: (failure: DataError) => void) => DatabaseInternals;

const registry = new WeakMap<object, DatabaseInternals>();

const STARTUP_REJECTED = 'the server refused the startup; check the database name and the user';

const REMEDIES: { readonly [R in Reason]?: string } = {
  resolve: "the host name did not resolve; check the URL's host",
  connect: 'nothing accepted the connection; check the host, the port and that the server is running',
  declined: 'the server declined TLS; enable TLS on the server',
  answer: "the answer to the TLS request was not PostgreSQL's; check that the port is a PostgreSQL server",
  certificate: "the server's certificate did not verify; supply the provider's root certificate in tls.ca",
  hostname: "the certificate does not name the URL's host; use the host name the certificate was issued for",
  handshake: "the TLS handshake failed; check the server's TLS versions",
  method:
    'the server asked for a sign-in method other than SCRAM-SHA-256; set the server and pg_hba.conf to scram-sha-256',
  'no-password': 'the server asked for a password and the URL has none',
  'not-asked': 'the server asked for no password although the URL has one; check pg_hba.conf',
  binding: 'channel binding is required and could not be used',
  exchange: 'the SCRAM exchange was malformed',
  iterations: "the server's SCRAM iteration count is outside 1 to 1,000,000",
  signature: 'the server did not prove that it knows the password',
  rejected: 'the server rejected the user or the password',
  version: 'the server offered a protocol version other than 3.2 or 3.0',
  encoding: 'the server did not confirm client_encoding UTF8',
  'no-key': 'the server sent no cancel key',
  timeout: 'the step did not finish within connectTimeoutMs',
  closed: 'the server closed the connection',
  violation: 'the server broke the protocol',
  open: 'the database file could not be opened; check the path and its permissions',
};

// Does:  Turns a failed first connect into the boot error that names its stage, its reason and the remedy.
function bootFailure(failure: DataError): Error {
  const reason = reasonOf(failure);
  if (reason === null) {
    return failure;
  }
  const remedy = reason === 'rejected' && failure.stage === 'startup' ? STARTUP_REJECTED : REMEDIES[reason];
  // Why: A connect failure without a listed reason is no case of the boot table, so it reaches core as it is.
  if (remedy === undefined) {
    return failure;
  }
  const where = failure.stage === null ? `(${reason})` : `at ${failure.stage} (${reason})`;
  return new Error(`Database connection failed ${where}: ${remedy}`, { cause: failure });
}

// Does:  Builds and registers a database around the internals build makes; insecure writes data.insecure at boot.
export function createDatabase(build: Build, insecure: boolean): Database {
  const booted: { events: DataEvents | null; log: Logger | null } = { events: null, log: null };
  const internals = build(booted, (failure) => {
    if (booted.events !== null && booted.log !== null) {
      booted.events.connectFailed(booted.log, failureFields(failure, internals.engine.name));
    }
  });
  const plugin = async (scope: PluginScope): Promise<void> => {
    const events = registerDataEvents(scope);
    booted.events = events;
    booted.log = scope.log;
    if (insecure) {
      events.insecure(scope.log);
    }
    try {
      await internals.pool.open(scope.signal);
    } catch (error) {
      if (error instanceof DataError && error.code === 'CONNECT_FAILED') {
        events.connectFailed(scope.log, failureFields(error, internals.engine.name));
        throw bootFailure(error);
      }
      throw error;
    }
    scope.onClose(() => internals.pool.close(scope.closeTimeoutMs));
  };
  // Why: Core names an unnamed plugin after its function, so a boot message reads postgresDatabase or sqliteDatabase.
  Object.defineProperty(plugin, 'name', { value: `${internals.engine.name}Database` });
  const database: Database = Object.freeze({
    engine: internals.engine.name,
    plugin,
    for: (owner: Owner) => bindDatabase(internals, owner),
    stats: () => internals.pool.stats(),
  });
  registry.set(database, internals);
  return database;
}

export function internalsOf(database: Database): DatabaseInternals {
  const internals = registry.get(database);
  if (internals === undefined) {
    throw new TypeError('Not a database made by createPostgresDatabase or createSqliteDatabase');
  }
  return internals;
}
