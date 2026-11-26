// Does:  Holds the limiter's statements on either engine and runs the charge and a cleanup pass.
// Holds: Each charge and each pass is one statement on the store's clock, never compared with the process's clock.

import { integer, object } from '@skeld/core/schema';
import { DataError } from '../data-error/data-error.ts';
import type { DataErrorCode } from '../data-error/types.ts';
import type { Database, Owner } from '../database/types.ts';
import { sql } from '../sql/sql.ts';
import type { Query } from '../sql/types.ts';
import type { CheckedRule } from './rules.ts';

type ChargeOutcome =
  | { readonly kind: 'counted'; readonly count: number; readonly waitMs: number }
  | { readonly kind: 'failed'; readonly reason: DataErrorCode | 'TIMEOUT'; readonly error: DataError }
  | { readonly kind: 'aborted' };

const CHARGE_ROW = object({ count: integer(), wait_ms: integer() });

// Why: One value per statement: statement_timestamp() on PostgreSQL, unixepoch('subsec') on SQLite.
const NOW: { readonly [E in Database['engine']]: Query } = {
  postgres: sql`(extract(epoch from statement_timestamp()) * 1000)::bigint`,
  sqlite: sql`cast(round(unixepoch('subsec') * 1000) as integer)`,
};

// Why: A pass on SQLite runs on the main thread, about 30 ms for 100 rows on a file of 1,000,000.
export const BATCH: { readonly [E in Database['engine']]: number } = { postgres: 1_000, sqlite: 100 };

function chargeQuery(engine: Database['engine'], key: Uint8Array, rule: CheckedRule): Query {
  const now = NOW[engine];
  const windowMs = rule.windowSeconds * 1_000;
  const ceiling = rule.max + 1;
  if (engine === 'postgres') {
    return sql`insert into skeld_data.limit_windows as w (key, count, expires_at)
values (${key}, 1, ${now} + ${windowMs}::bigint)
on conflict (key) do update set
  count = case when w.expires_at <= ${now} then 1 else least(w.count + 1, ${ceiling}::integer) end,
  expires_at = case when w.expires_at <= ${now} then ${now} + ${windowMs}::bigint else w.expires_at end
returning w.count as count, w.expires_at - ${now} as wait_ms`;
  }
  return sql`insert into skeld_data_limit_windows (key, count, expires_at)
values (${key}, 1, ${now} + ${windowMs})
on conflict (key) do update set
  count = case when expires_at <= ${now} then 1 else min(count + 1, ${ceiling}) end,
  expires_at = case when expires_at <= ${now} then ${now} + ${windowMs} else expires_at end
returning count, expires_at - ${now} as wait_ms`;
}

// Does:  Charges the key once under an owner that aborts at the request's abort or after timeoutMs, whichever is first.
export async function charge(
  database: Database,
  request: Owner,
  key: Uint8Array,
  rule: CheckedRule,
  timeoutMs: number,
): Promise<ChargeOutcome> {
  const timer = new AbortController();
  const timeout = setTimeout(() => timer.abort(), timeoutMs);
  const owner: Owner = { signal: AbortSignal.any([request.signal, timer.signal]), log: request.log };
  try {
    const [row] = await database.for(owner).query(chargeQuery(database.engine, key, rule), CHARGE_ROW);
    if (row === undefined) {
      return { kind: 'failed', reason: 'ROW_INVALID', error: new DataError('ROW_INVALID') };
    }
    return { kind: 'counted', count: row.count, waitMs: row.wait_ms };
  } catch (error) {
    if (!(error instanceof DataError)) {
      throw error;
    }
    if (request.signal.aborted) {
      return { kind: 'aborted' };
    }
    return { kind: 'failed', reason: timer.signal.aborted ? 'TIMEOUT' : error.code, error };
  } finally {
    clearTimeout(timeout);
  }
}

// Does:  Deletes expired rows up to the engine's batch in one statement and returns how many it removed.
export async function cleanupPass(database: Database, owner: Owner): Promise<number> {
  const now = NOW[database.engine];
  const batch = BATCH[database.engine];
  const query =
    database.engine === 'postgres'
      ? sql`delete from skeld_data.limit_windows where key in (
  select key from skeld_data.limit_windows where expires_at <= ${now} order by expires_at limit ${batch} for update skip locked
) returning 1 as gone`
      : sql`delete from skeld_data_limit_windows where key in (
  select key from skeld_data_limit_windows where expires_at <= ${now} order by expires_at limit ${batch}
) returning 1 as gone`;
  const rows = await database.for(owner).query(query);
  return rows.length;
}

export const INSTALL: {
  readonly [E in Database['engine']]: { readonly schema: Query | null; readonly table: Query; readonly index: Query };
} = {
  postgres: {
    schema: sql`create schema if not exists skeld_data`,
    table: sql`create unlogged table if not exists skeld_data.limit_windows (
  key bytea primary key, count integer not null, expires_at bigint not null
)`,
    index: sql`create index if not exists limit_windows_expires_at on skeld_data.limit_windows (expires_at)`,
  },
  sqlite: {
    schema: null,
    table: sql`create table if not exists skeld_data_limit_windows (
  key blob primary key, count integer not null, expires_at integer not null
) strict, without rowid`,
    index: sql`create index if not exists skeld_data_limit_windows_expires_at on skeld_data_limit_windows (expires_at)`,
  },
};
