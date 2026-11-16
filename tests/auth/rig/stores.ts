// Does:  Gives a proof an installed SQLite or PostgreSQL auth store of its own, with direct row reads and cleanup.
// Holds: Every database or file is the rig's own and is removed by dispose; the connection string is never printed.

import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
// biome-ignore lint/correctness/noUnresolvedImports: Biome's Node module list lacks node:sqlite, which Node 26 ships
import { DatabaseSync } from 'node:sqlite';
import { createPostgresStore } from '@skeld/auth/postgres';
import { createSqliteStore } from '@skeld/auth/sqlite';
import type { AuthStore } from '@skeld/auth/store';
import { Client, Pool } from 'pg';
import { storeKinds } from '../../support/test-profile.ts';
import { pgBase } from '../support-store.ts';

export type Kind = 'sqlite' | 'postgres';
export const kinds = storeKinds;

export interface StoreRig {
  readonly kind: Kind;
  open: () => AuthStore;
  count: (table: string, where?: string, args?: readonly unknown[]) => Promise<number>;
  rows: (sql: string, args?: readonly unknown[]) => Promise<Record<string, unknown>[]>;
  dispose: () => Promise<void>;
}

function pgSql(sql: string): string {
  let n = 0;
  return sql.replace(/\?/g, () => `$${++n}`);
}

function param(value: unknown): number | string | Uint8Array | null {
  if (typeof value === 'number' || typeof value === 'string' || value === null || value instanceof Uint8Array) {
    return value;
  }
  throw new Error(`unsupported parameter ${typeof value}`);
}

export async function makeStoreRig(kind: Kind): Promise<StoreRig> {
  if (kind === 'sqlite') {
    const dir = mkdtempSync(join(tmpdir(), 'skeld-v2-'));
    const path = join(dir, 'auth.db');
    const installer = createSqliteStore({ path });
    await installer.install();
    await installer.close();
    const side = new DatabaseSync(path, { timeout: 5000 });
    const rows = (sql: string, args: readonly unknown[] = []): Promise<Record<string, unknown>[]> =>
      Promise.resolve(
        side
          .prepare(sql)
          .all(...args.map(param))
          .map((row) => ({ ...row })),
      );
    return {
      kind,
      open: () => createSqliteStore({ path }),
      count: async (table, where = '1=1', args = []) =>
        Number((await rows(`SELECT count(*) AS n FROM ${table} WHERE ${where}`, args))[0]?.n),
      rows,
      dispose: () => {
        side.close();
        rmSync(dir, { recursive: true, force: true });
        return Promise.resolve();
      },
    };
  }
  const base = pgBase();
  const name = `v2_${randomBytes(6).toString('hex')}`;
  const admin = new Client({ connectionString: base.toString() });
  await admin.connect();
  await admin.query(`CREATE DATABASE ${name}`);
  await admin.end();
  const target = new URL(base);
  target.pathname = `/${name}`;
  const pool = new Pool({ connectionString: target.toString(), max: 8 });
  pool.on('error', () => undefined);
  await createPostgresStore({ pool }).install();
  const look = new Pool({ connectionString: target.toString(), max: 2, options: '-c search_path=skeld_auth' });
  look.on('error', () => undefined);
  const rows = async (sql: string, args: readonly unknown[] = []): Promise<Record<string, unknown>[]> => {
    const result = await look.query(pgSql(sql), [...args]);
    const out: Record<string, unknown>[] = result.rows;
    return out;
  };
  return {
    kind,
    open: () => createPostgresStore({ pool }),
    count: async (table, where = '1=1', args = []) =>
      Number((await rows(`SELECT count(*) AS n FROM ${table} WHERE ${where}`, args))[0]?.n),
    rows,
    dispose: async () => {
      await look.end();
      await pool.end();
      const drop = new Client({ connectionString: base.toString() });
      await drop.connect();
      await drop.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
      await drop.end();
    },
  };
}
