// Does:  Gives the store proof scripts their rigs, direct database reads and lock holders.
// Holds: Every database a rig makes is its own and is removed by dispose; the connection string is never printed.

import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
// biome-ignore lint/correctness/noUnresolvedImports: Biome's Node module list lacks node:sqlite, which Node 26 ships
import { DatabaseSync } from 'node:sqlite';
import { setTimeout as sleep } from 'node:timers/promises';
import { createPostgresStore } from '@skeld/auth/postgres';
import { createSqliteStore } from '@skeld/auth/sqlite';
import { type AuthStore, type StoreEvent, StoreFailure } from '@skeld/auth/store';
import { Client, Pool } from 'pg';
import { storeKinds } from '../support/test-profile.ts';

export type Kind = 'sqlite' | 'postgres';
export type Table = 'subjects' | 'sessions' | 'api_keys' | 'limit_windows' | 'oidc_attempts';
export type Key = string | Uint8Array;

const keyColumns: Record<Table, string> = {
  subjects: 'user_id',
  sessions: 'digest',
  api_keys: 'key_id',
  limit_windows: 'key',
  oidc_attempts: 'state_digest',
};

export const sleepMs = sleep;

export function fresh(): Uint8Array {
  return new Uint8Array(randomBytes(32));
}

export function hex(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('hex');
}

export function toNumber(value: unknown): number {
  if (typeof value === 'number') {
    return value;
  }
  if (typeof value === 'bigint' || typeof value === 'string') {
    return Number(value);
  }
  throw new Error(`not a number: ${typeof value}`);
}

export type Settled<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: unknown };

export async function settle<T>(promise: Promise<T>): Promise<Settled<T>> {
  try {
    return { ok: true, value: await promise };
  } catch (error) {
    return { ok: false, error };
  }
}

// Does:  Names an outcome without engine text: the result's kind, or a StoreFailure's reason, applied and code.
export function show(outcome: Settled<unknown>): string {
  if (outcome.ok) {
    const value = outcome.value;
    if (typeof value === 'object' && value !== null && 'kind' in value) {
      const reason = 'reason' in value ? `/${String(value.reason)}` : '';
      return `${String(value.kind)}${reason}`;
    }
    return value === null ? 'null' : 'resolved';
  }
  if (outcome.error instanceof StoreFailure) {
    return `StoreFailure ${outcome.error.reason}/${outcome.error.applied}/${outcome.error.code}`;
  }
  return `${outcome.error instanceof Error ? outcome.error.name : typeof outcome.error}`;
}

export function isFailure(
  outcome: Settled<unknown>,
  reason: StoreFailure['reason'],
  applied: StoreFailure['applied'],
): boolean {
  return (
    !outcome.ok &&
    outcome.error instanceof StoreFailure &&
    outcome.error.reason === reason &&
    outcome.error.applied === applied
  );
}

export function failureCode(outcome: Settled<unknown>): string | null | undefined {
  return !outcome.ok && outcome.error instanceof StoreFailure ? outcome.error.code : undefined;
}

// Does:  Reads the PostgreSQL fixture's connection string; the run fails clearly when it is not set.
export function pgBase(): URL {
  const text = process.env.SKELD_TEST_PG_URL;
  if (text === undefined || text === '') {
    throw new Error(
      'SKELD_TEST_PG_URL is not set: a PostgreSQL 19 fixture is required and a missing one fails the run',
    );
  }
  return new URL(text);
}

const created = new Set<string>();
const sqliteDirs = new Set<string>();

export interface PgDatabase {
  readonly name: string;
  url: (port?: number) => string;
  pool: (options: { max: number; application: string; port?: number }) => Pool;
}

export async function createDatabase(): Promise<PgDatabase> {
  const base = pgBase();
  const name = `v_${randomBytes(5).toString('hex')}`;
  const admin = new Client({ connectionString: base.toString() });
  await admin.connect();
  try {
    await admin.query(`CREATE DATABASE ${name}`);
  } finally {
    await admin.end();
  }
  created.add(name);
  const url = (port?: number): string => {
    const target = new URL(base);
    target.pathname = `/${name}`;
    if (port !== undefined) {
      target.port = String(port);
    }
    return target.toString();
  };
  return {
    name,
    url,
    pool: ({ max, application, port }) => {
      const pool = new Pool({ connectionString: url(port), max, application_name: application });
      pool.on('error', () => undefined);
      return pool;
    },
  };
}

export async function dropDatabase(name: string): Promise<void> {
  const admin = new Client({ connectionString: pgBase().toString() });
  await admin.connect();
  try {
    await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
  } finally {
    await admin.end();
  }
  created.delete(name);
}

export function scratchDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'skeld-store-proof-'));
  sqliteDirs.add(dir);
  return dir;
}

// Does:  Drops every database and removes every directory this process made and has not yet disposed of.
export async function cleanAll(): Promise<void> {
  for (const name of [...created]) {
    // biome-ignore lint/performance/noAwaitInLoops: each drop is its own connection and the set is small
    await dropDatabase(name);
  }
  for (const dir of sqliteDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
  sqliteDirs.clear();
}

export interface Rig {
  readonly kind: Kind;
  readonly store: AuthStore;
  readonly events: StoreEvent[];
  readonly path: string;
  readonly database: PgDatabase | null;
  readonly appPool: Pool | null;
  // Does:  Locks a row until the returned release is called or ms pass, whichever comes first.
  hold: (table: Table, key: Key, ms: number) => Promise<() => Promise<void>>;
  query: (sql: string, params?: readonly unknown[]) => Promise<Record<string, unknown>[]>;
  count: (table: Table, column?: string, value?: Key | number) => Promise<number>;
  exists: (table: Table, key: Key) => Promise<boolean>;
  value: (table: Table, key: Key, column: string) => Promise<number | null>;
  dispose: () => Promise<void>;
}

export interface RigOptions {
  // Does:  Names a database the serial conformance fixture owns and resets; the rig closes its pools, never drops it.
  database?: PgDatabase;
  cleanupIntervalSeconds?: number;
  maxClients?: number;
  poolMax?: number;
  attach?: boolean;
  install?: boolean;
}

function pgSql(sql: string): string {
  let n = 0;
  return sql.replace(/\?/g, () => `$${++n}`);
}

function sqlParam(value: unknown): number | string | Uint8Array | null {
  if (typeof value === 'number' || typeof value === 'string' || value === null || value instanceof Uint8Array) {
    return value;
  }
  throw new Error(`unsupported parameter ${typeof value}`);
}

// Does:  Makes a rig: a store of the kind over its own file or database, installed and attached unless told otherwise.
export async function makeRig(kind: Kind, options: RigOptions = {}): Promise<Rig> {
  const { cleanupIntervalSeconds = 3600, maxClients, poolMax = 8, attach = true, install = true } = options;
  const events: StoreEvent[] = [];
  const pending = new Set<Promise<void>>();
  const releasers = new Set<() => void>();
  let rig: Rig;
  if (kind === 'sqlite') {
    const dir = scratchDir();
    const path = join(dir, 'auth.db');
    const store = createSqliteStore({ path, cleanupIntervalSeconds });
    let side: DatabaseSync | null = null;
    const reader = (): DatabaseSync => {
      side ??= new DatabaseSync(path, { timeout: 5000 });
      return side;
    };
    rig = {
      kind,
      store,
      events,
      path,
      database: null,
      appPool: null,
      hold: (_table, _key, ms) => {
        const holder = new DatabaseSync(path, { timeout: 0 });
        holder.exec('BEGIN IMMEDIATE');
        let release = (): void => undefined;
        const released = new Promise<void>((resolve) => {
          let done = false;
          release = (): void => {
            if (done) {
              return;
            }
            done = true;
            releasers.delete(release);
            clearTimeout(timer);
            try {
              holder.exec('ROLLBACK');
            } finally {
              holder.close();
              resolve();
            }
          };
          const timer = setTimeout(release, ms);
          releasers.add(release);
        });
        pending.add(released);
        return Promise.resolve(() => {
          release();
          return released;
        });
      },
      query: (sql, params = []) => {
        const rows = reader()
          .prepare(sql)
          .all(...params.map(sqlParam));
        return Promise.resolve(rows);
      },
      count: async (table, column, value) => {
        const where = column === undefined ? '' : ` WHERE ${column} = ?`;
        const rows = await rig.query(`SELECT count(*) AS n FROM ${table}${where}`, column === undefined ? [] : [value]);
        return toNumber(rows[0]?.n);
      },
      exists: async (table, key) => (await rig.count(table, keyColumns[table], key)) > 0,
      value: async (table, key, column) => {
        const rows = await rig.query(`SELECT ${column} AS v FROM ${table} WHERE ${keyColumns[table]} = ?`, [key]);
        const found = rows[0]?.v;
        return found === undefined || found === null ? null : toNumber(found);
      },
      dispose: async () => {
        for (const release of [...releasers]) {
          release();
        }
        await Promise.all(pending);
        await store.close();
        side?.close();
        rmSync(dir, { recursive: true, force: true });
        sqliteDirs.delete(dir);
      },
    };
  } else {
    const database = options.database ?? (await createDatabase());
    const appPool = database.pool({ max: poolMax, application: 'proof-app' });
    const sidePool = new Pool({
      connectionString: database.url(),
      max: 4,
      application_name: 'proof-side',
      options: '-c search_path=skeld_auth',
    });
    sidePool.on('error', () => undefined);
    const store = createPostgresStore({
      pool: appPool,
      cleanupIntervalSeconds,
      ...(maxClients === undefined ? {} : { maxClients }),
    });
    rig = {
      kind,
      store,
      events,
      path: database.name,
      database,
      appPool,
      hold: async (table, key, ms) => {
        const client = await sidePool.connect();
        try {
          await client.query('BEGIN');
          const locked = await client.query(
            `SELECT 1 FROM skeld_auth.${table} WHERE ${keyColumns[table]} = $1 FOR UPDATE`,
            [key],
          );
          if (locked.rowCount !== 1) {
            throw new Error('row to lock is absent');
          }
        } catch (error) {
          client.release(true);
          throw error;
        }
        let release = (): void => undefined;
        const released = new Promise<void>((resolve) => {
          let done = false;
          release = (): void => {
            if (done) {
              return;
            }
            done = true;
            releasers.delete(release);
            clearTimeout(timer);
            client.query('COMMIT').then(
              () => {
                client.release();
                resolve();
              },
              () => {
                client.release(true);
                resolve();
              },
            );
          };
          const timer = setTimeout(release, ms);
          releasers.add(release);
        });
        pending.add(released);
        return () => {
          release();
          return released;
        };
      },
      query: async (sql, params = []) => {
        const result = await sidePool.query(pgSql(sql), [...params]);
        const rows: Record<string, unknown>[] = result.rows;
        return rows;
      },
      count: async (table, column, value) => {
        const where = column === undefined ? '' : ` WHERE ${column} = $1`;
        const result = await sidePool.query(
          `SELECT count(*)::int AS n FROM skeld_auth.${table}${where}`,
          column === undefined ? [] : [value],
        );
        return toNumber(result.rows[0]?.n);
      },
      exists: async (table, key) => (await rig.count(table, keyColumns[table], key)) > 0,
      value: async (table, key, column) => {
        const result = await sidePool.query(
          `SELECT ${column} AS v FROM skeld_auth.${table} WHERE ${keyColumns[table]} = $1`,
          [key],
        );
        const found: unknown = result.rows[0]?.v;
        return found === undefined || found === null ? null : toNumber(found);
      },
      dispose: async () => {
        for (const release of [...releasers]) {
          release();
        }
        await Promise.all(pending);
        await store.close();
        await appPool.end();
        await sidePool.end();
        if (options.database === undefined) {
          await dropDatabase(database.name);
        }
      },
    };
  }
  const attachConfig = Object.freeze({ onFailure: (event: StoreEvent) => void events.push(event) });
  if (install) {
    const installed = await rig.store.install();
    if (installed.kind !== 'installed') {
      throw new Error(`install answered ${installed.kind}`);
    }
  }
  if (attach) {
    const attached = await rig.store.attach(attachConfig);
    if (attached.kind !== 'attached') {
      throw new Error(`attach answered ${attached.kind}`);
    }
  }
  return rig;
}

export const rigKinds = storeKinds;

// Does:  Waits until a backend of the named application waits on a lock in the rig's database; false after 5 s.
export async function lockWaiting(rig: Rig, application: string): Promise<boolean> {
  const sql = `SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname = current_database() AND application_name = '${application}' AND wait_event_type = 'Lock'`;
  for (let polls = 0; polls < 500; polls++) {
    // biome-ignore lint/performance/noAwaitInLoops: each poll reads the server's state after the last one
    const rows = await rig.query(sql);
    if (toNumber(rows[0]?.n) > 0) {
      return true;
    }
    await sleep(10);
  }
  return false;
}
