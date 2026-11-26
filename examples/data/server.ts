import { once } from 'node:events';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { startExample } from './app.ts';

// On SQLite the data lives in .data/ beside this file (git-ignored), so it survives a restart.
const dataDir = join(import.meta.dirname, '.data');
mkdirSync(dataDir, { recursive: true, mode: 0o700 });

const example = await startExample({ port: Number(process.env.PORT ?? 3004), sqlitePath: join(dataDir, 'bank.db') });
process.stderr.write(`data example on ${example.url} (${example.engine})\n`);

await Promise.race([once(process, 'SIGINT'), once(process, 'SIGTERM')]);
await example.close();
