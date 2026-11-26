// Does:  Proves a request value never becomes SQL text and a 64-bit integer returns whole, on SQLite.
// Holds: Each value of the criterion's list is read back by the rule it states, and table t outlives all of them.

// biome-ignore-all lint/security/noSecrets: planted hostile text, not credentials
// biome-ignore-all lint/performance/noAwaitInLoops: each value is inserted and read back alone so a failure names it
import * as t from '@skeld/core/schema';
import { createServer } from '@skeld/core/server';
import { DataError } from '@skeld/data/data-error';
import type { BoundDatabase } from '@skeld/data/database';
import { sql } from '@skeld/data/sql';
import { createSqliteDatabase } from '@skeld/data/sqlite';
import { check, createReport } from '../support/support-proof.ts';

interface Case {
  name: string;
  value: string | bigint | boolean | null | Uint8Array | Date;
  same: (read: unknown) => boolean;
}

const rfc3339 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;
const everyByte = Uint8Array.from({ length: 256 }, (_, at) => at);
const megabyte = 'x'.repeat(1_048_575).concat('y');
const instant = new Date(Date.UTC(2026, 10, 26, 9, 30, 0, 123));
const beyondSafe = 9_007_199_254_740_993n;

const equal =
  (expected: unknown) =>
  (read: unknown): boolean =>
    Object.is(read, expected);

const cases: Case[] = [
  { name: 'a single quote', value: "'", same: equal("'") },
  { name: 'a backslash', value: '\\', same: equal('\\') },
  { name: 'a stacked statement', value: "'; drop table t; --", same: equal("'; drop table t; --") },
  { name: 'a placeholder spelling', value: '$1', same: equal('$1') },
  { name: 'a 1 MiB string', value: megabyte, same: equal(megabyte) },
  { name: 'an empty string', value: '', same: equal('') },
  { name: 'null', value: null, same: equal(null) },
  { name: 'an integer beyond 2^53', value: beyondSafe, same: equal(beyondSafe) },
  {
    name: 'all 256 byte values',
    value: everyByte,
    same: (read) => read instanceof Uint8Array && read.length === 256 && read.every((byte, at) => byte === at),
  },
  {
    name: 'a Date as RFC 3339 text of the same instant',
    value: instant,
    same: (read) => typeof read === 'string' && rfc3339.test(read) && Date.parse(read) === instant.getTime(),
  },
  { name: 'true as 1n where no schema is named', value: true, same: equal(1n) },
];

const report = createReport();
const db = createSqliteDatabase({ path: ':memory:' });
const server = createServer();
server.register(db.plugin);
let bound: BoundDatabase | undefined;
server.register((scope) => {
  bound = db.for(scope);
  return Promise.resolve();
});
await server.listen({ port: 0, host: '127.0.0.1' });
const handle = bound;
if (handle === undefined) {
  throw new Error('the registered plugin did not run');
}

async function count(target: BoundDatabase): Promise<unknown> {
  const [row] = await target.query(sql`select count(*) as n from t`);
  return row?.n;
}

async function tableExists(target: BoundDatabase): Promise<boolean> {
  const rows = await target.query(sql`select name from sqlite_master where type = 'table' and name = 't'`);
  return rows.length === 1;
}

try {
  await handle.query(sql`create table t (id integer primary key, v)`);
  let stored = 0n;
  for (const one of cases) {
    const problems: string[] = [];
    const [inserted] = await handle.query(sql`insert into t (v) values (${one.value}) returning id`);
    const id = inserted?.id;
    if (typeof id !== 'bigint') {
      throw new Error(`the insert of ${one.name} returned no id`);
    }
    stored += 1n;
    const [found] = await handle.query(sql`select v from t where id = ${id}`);
    check(problems, found !== undefined && one.same(found.v), `${one.name} did not read back as the rule says`);
    const [echoed] = await handle.query(sql`select ${one.value} as v`);
    check(problems, echoed !== undefined && one.same(echoed.v), `${one.name} did not return from a bare select`);
    check(problems, await tableExists(handle), `table t is gone after ${one.name}`);
    check(problems, (await count(handle)) === stored, `the row count is not ${stored} after ${one.name}`);
    report.result(one.name, problems, 'inserted, selected and compared; table t remains');
  }

  const typed: string[] = [];
  const [flag] = await handle.query(sql`select ${true} as v`, t.object({ v: t.boolean() }));
  check(typed, flag?.v === true, 'true did not return as true where the row schema declares the column boolean');
  report.result('true under a row schema that declares it boolean', typed, 'returned true');

  const injected: string[] = [];
  const hostile = "x' or '1'='1";
  const matched = await handle.query(sql`select id from t where v = ${hostile}`);
  check(injected, matched.length === 0, `a value holding a quote matched ${matched.length} rows`);
  report.result('a quoted value does not widen a where clause', injected, 'matched no row');

  const stacked: string[] = [];
  const before = await count(handle);
  let refused: unknown;
  try {
    await handle.query(sql`insert into t (v) values (${'first'}); insert into t (v) values (${'second'})`);
  } catch (error) {
    refused = error;
  }
  check(
    stacked,
    refused instanceof DataError && refused.code === 'INVALID_QUERY',
    `a two-statement text was not refused as INVALID_QUERY (${refused instanceof DataError ? refused.code : typeof refused})`,
  );
  check(stacked, (await count(handle)) === before, 'a row count changed after a refused two-statement text');
  const named = await handle.query(sql`select id from t where v = ${'first'} or v = ${'second'}`);
  check(stacked, named.length === 0, 'one of the two statements ran');
  report.result(
    'a two-statement text is refused with neither statement run',
    stacked,
    'INVALID_QUERY, counts unchanged',
  );
} finally {
  await server.close();
}
report.finish();
