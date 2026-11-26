// Does:  Reads the PostgreSQL 19 proof server's variables and builds side connections, URLs and names from them.
// Holds: A missing variable fails by name and no value is ever echoed; each name made here is the proof's own.

import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import pg from 'pg';

export interface Pg19 {
  readonly host: string;
  readonly port: number;
  readonly user: string;
  readonly password: string;
  readonly ca: string;
}

export function pg19(): Pg19 {
  const text = process.env.SKELD_TEST_PG19_URL;
  const caFile = process.env.SKELD_TEST_PG19_CA;
  if (text === undefined || text === '') {
    throw new Error('SKELD_TEST_PG19_URL is not set');
  }
  if (caFile === undefined || caFile === '') {
    throw new Error('SKELD_TEST_PG19_CA is not set');
  }
  const url = new URL(text);
  return {
    host: url.hostname,
    port: Number(url.port),
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    ca: readFileSync(caFile, 'utf8'),
  };
}

// Does:  Connects a pg 8.23.1 side client over verified TLS; it is the observer, never the code under proof.
export async function side(database = 'postgres'): Promise<pg.Client> {
  const server = pg19();
  const client = new pg.Client({
    host: server.host,
    port: server.port,
    user: server.user,
    password: server.password,
    database,
    application_name: 'va_side',
    ssl: { ca: server.ca },
  });
  await client.connect();
  return client;
}

export function uniqueName(prefix: string): string {
  return `${prefix}_${randomBytes(4).toString('hex')}`;
}

export interface UrlParts {
  readonly user: string;
  readonly password?: string;
  readonly host?: string;
  readonly port: number;
  readonly database?: string;
  readonly params?: Readonly<Record<string, string>>;
}

export function urlOf(parts: UrlParts): string {
  const login =
    parts.password === undefined
      ? encodeURIComponent(parts.user)
      : `${encodeURIComponent(parts.user)}:${encodeURIComponent(parts.password)}`;
  const query = new URLSearchParams({ sslmode: 'require', ...(parts.params ?? {}) }).toString();
  return `postgres://${login}@${parts.host ?? '127.0.0.1'}:${parts.port}/${parts.database ?? 'postgres'}?${query}`;
}
