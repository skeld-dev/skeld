import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { BootError } from '@skeld/core/boot-error';
import { DataError } from '@skeld/data/data-error';
import { migrate } from './migration.ts';

// Runs the schema step once, before the service starts. The worker's JSON log goes to stdout; one line goes to
// stderr. On failure that line holds codes only, never a message or a stack, since an error's text can carry the
// database's own words, a file path or the connection URL into a deploy log. The exit code is 1 on failure.

function dataCodes(error: DataError): string[] {
  return [
    error.code,
    ...(error.stage === null ? [] : [error.stage]),
    ...(error.sqlState === null ? [] : [error.sqlState]),
  ];
}

// The DataError behind a failed plugin: the BootError's cause, or, for a first connect that failed, the cause of
// the Error in which data names the remedy.
function dataCause(error: BootError): DataError | null {
  const { cause } = error;
  if (cause instanceof DataError) {
    return cause;
  }
  return cause instanceof Error && cause.cause instanceof DataError ? cause.cause : null;
}

function failureCodes(error: unknown): string[] {
  if (error instanceof BootError) {
    const cause = dataCause(error);
    return cause === null ? [error.code] : [error.code, ...dataCodes(cause)];
  }
  if (error instanceof DataError) {
    return dataCodes(error);
  }
  return ['UNEXPECTED'];
}

try {
  // On SQLite the data lives in .data/ beside this file (git-ignored), as for server.ts.
  const dataDir = join(import.meta.dirname, '.data');
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const engine = await migrate({ sqlitePath: join(dataDir, 'bank.db') });
  process.stderr.write(`data example migrated (${engine})\n`);
} catch (error) {
  process.stderr.write(`migrate failed: ${failureCodes(error).join(' ')}\n`);
  process.exitCode = 1;
}
