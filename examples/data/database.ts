import { readFileSync } from 'node:fs';
import { Secret } from '@skeld/core/secret';
import type { Database } from '@skeld/data/database';
import { createPostgresDatabase } from '@skeld/data/postgres';
import { createSqliteDatabase } from '@skeld/data/sqlite';

// DATABASE_URL selects PostgreSQL over verified TLS; DATABASE_CA_FILE names the server's CA certificate (PEM)
// when it is not one of Node's bundled roots. Without DATABASE_URL the service runs on a SQLite file.
export function openDatabase(sqlitePath: string): Database {
  const url = process.env.DATABASE_URL;
  if (url === undefined || url === '') {
    return createSqliteDatabase({ path: sqlitePath });
  }
  const caFile = process.env.DATABASE_CA_FILE;
  return createPostgresDatabase({
    url: new Secret(url),
    ...(caFile === undefined || caFile === '' ? {} : { tls: { ca: readFileSync(caFile, 'utf8') } }),
  });
}
