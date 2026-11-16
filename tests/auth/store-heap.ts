// Does:  Proves the PostgreSQL store retains nothing per finished unit: the heap after 400,000 reads equals the start.
// Holds: The pool is a structural double behind the public PgPool type; the store and its runner are the real ones.

import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createPostgresStore, type PgPool } from '@skeld/auth/postgres';
import { createReport } from './rig/v1-report.ts';

const self = fileURLToPath(import.meta.url);
const UNITS = 400_000;
const LIMIT_BYTES = 4 * 1024 * 1024;

async function child(): Promise<void> {
  const collect = (): number => {
    const gc: unknown = Reflect.get(globalThis, 'gc');
    if (typeof gc !== 'function') {
      throw new Error('run with --expose-gc');
    }
    gc();
    gc();
    return process.memoryUsage().heapUsed;
  };
  const client = {
    query: (text: string) => {
      if (text.includes('to_regclass')) {
        return Promise.resolve({ rows: [{ present: true }], rowCount: 1 });
      }
      if (text.includes('schema_version')) {
        return Promise.resolve({ rows: [{ version: 1 }], rowCount: 1 });
      }
      return Promise.resolve({
        rows: [{ user_id: 'u', created_at: 1, last_seen_at: 1, expires_at: 3, absolute_expires_at: 4, now: 2 }],
        rowCount: 1,
      });
    },
    release: () => undefined,
    on: () => undefined,
    removeListener: () => undefined,
  };
  const pool: PgPool = {
    connect: () => Promise.resolve(client),
    on: () => undefined,
    removeListener: () => undefined,
    options: { max: 8 },
  };
  const store = createPostgresStore({ pool, cleanupIntervalSeconds: 3600 });
  const attached = await store.attach({ onFailure: () => undefined });
  const digest = new Uint8Array(32);
  for (let n = 0; n < 5000; n++) {
    // biome-ignore lint/performance/noAwaitInLoops: units run one after another, as one request after another would
    await store.ops.sessionRead({ digest });
  }
  const start = collect();
  const began = performance.now();
  let answered = 0;
  for (let n = 0; n < UNITS; n++) {
    // biome-ignore lint/performance/noAwaitInLoops: units run one after another, as one request after another would
    const row = await store.ops.sessionRead({ digest });
    answered += row === null ? 0 : 1;
  }
  const seconds = (performance.now() - began) / 1000;
  const end = collect();
  await store.close();
  process.stdout.write(JSON.stringify({ attached: attached.kind, start, end, answered, seconds }));
}

if (process.argv[2] === 'child') {
  await child();
} else {
  const report = createReport(
    'v10/review-fixes',
    'the PostgreSQL store keeps nothing for a unit that has ended: after 400,000 sessionRead units the heap, after a forced collection, is within 4 MB of the start',
  );
  const run = spawnSync(process.execPath, ['--expose-gc', '--conditions=skeld-source', self, 'child'], {
    encoding: 'utf8',
    timeout: 120_000,
  });
  let seen: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse(run.stdout);
    seen = typeof parsed === 'object' && parsed !== null ? Object.fromEntries(Object.entries(parsed)) : {};
  } catch {
    seen = {};
  }
  const start = Number(seen.start);
  const end = Number(seen.end);
  report.check(
    'the child attached the store and ran every unit',
    run.status === 0 && seen.attached === 'attached' && seen.answered === UNITS,
    `exit ${String(run.status)} ${run.stderr.slice(0, 200)}`,
  );
  report.check(
    `the heap after a forced collection grew by at most 4 MB over ${UNITS.toLocaleString('en-US')} units (${(((end - start) / UNITS) * 1).toFixed(2)} bytes a unit; ${(Number(seen.seconds) || 0).toFixed(1)} s)`,
    end - start <= LIMIT_BYTES,
    `start ${(start / 1048576).toFixed(1)} MB, end ${(end / 1048576).toFixed(1)} MB, growth ${((end - start) / 1048576).toFixed(2)} MB`,
  );
  report.check(
    'the whole run fits the 60 s bound',
    Number(seen.seconds) < 60,
    `${(Number(seen.seconds) || 0).toFixed(1)} s`,
  );
  report.finish();
}
