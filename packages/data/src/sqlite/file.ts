// Does:  Creates a missing SQLite database file owner-only before SQLite opens it.
// Holds: A missing file is created at mode 0600; an existing file is never opened here and its mode never changes.

import { closeSync, openSync } from 'node:fs';

const OWNER_ONLY = 0o600;

export function createDatabaseFile(path: string): void {
  try {
    // Why: The flag wx fails with EEXIST rather than open a file that exists, so its mode is never touched.
    closeSync(openSync(path, 'wx', OWNER_ONLY));
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'EEXIST')) {
      throw error;
    }
  }
}
