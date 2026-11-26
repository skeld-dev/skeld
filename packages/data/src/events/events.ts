// Does:  Registers data's four security events and builds the fields a failure's record carries.
// Holds: A failure's fields are its code, engine, SQLSTATE, SQLite code, stage and reason, and nothing else.

import type { LogFields } from '@skeld/core/log';
import type { Scope } from '@skeld/core/server';
import type { DataError } from '../data-error/data-error.ts';
import { reasonOf } from '../data-error/reason.ts';
import type { DataEvents } from './types.ts';

export function registerDataEvents(scope: Pick<Scope, 'event'>): DataEvents {
  return Object.freeze({
    connectFailed: scope.event('data.connect.failed', 'error'),
    connectionClosed: scope.event('data.connection.closed', 'warn'),
    statementFailed: scope.event('data.statement.failed', 'error'),
    insecure: scope.event('data.insecure', 'warn'),
  });
}

export function failureFields(error: DataError, engine: 'postgres' | 'sqlite'): LogFields {
  // Why: A log field whose value is undefined is left out of the record, so a failure without one names no key.
  return {
    'data.code': error.code,
    'data.engine': engine,
    'data.sqlstate': error.sqlState ?? undefined,
    'data.sqlite_code': error.sqliteCode ?? undefined,
    'data.stage': error.stage ?? undefined,
    'data.reason': reasonOf(error) ?? undefined,
  };
}
