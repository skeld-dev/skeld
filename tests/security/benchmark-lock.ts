// Does:  Proves benchmark locking cannot overwrite a planted symlink and still excludes live runs.
// Holds: Every probe uses a private TMPDIR; the machine's real benchmark lock is never touched.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const directory = mkdtempSync(join(tmpdir(), 'skeld-lock-proof-'));
const moduleUrl = new URL('../../benchmarks/lock.ts', import.meta.url).href;
const probe = `
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { takeLock } from ${JSON.stringify(moduleUrl)};

const folder = tmpdir();
const lockFile = join(folder, 'skeld-bench.lock');
const target = join(folder, 'must-not-change');
const planted = lockFile + '.' + process.pid;
writeFileSync(target, 'preserved');
symlinkSync(target, planted);
const first = takeLock();
assert.equal(readFileSync(target, 'utf8'), 'preserved');
assert.equal(first.replacedPid, null);
assert.equal(statSync(lockFile).mode & 0o777, 0o600);
assert.throws(() => takeLock(), /another benchmark is running/);
assert.equal(readFileSync(target, 'utf8'), 'preserved');
first.release();
first.release();
assert.equal(existsSync(lockFile), false);
unlinkSync(planted);

const dead = spawnSync(process.execPath, ['-e', ''], { encoding: 'utf8' });
assert.equal(dead.status, 0);
writeFileSync(lockFile, JSON.stringify({ pid: dead.pid, startedAt: 'fixture' }));
const replacement = takeLock();
assert.equal(replacement.replacedPid, dead.pid);
replacement.release();
writeFileSync(lockFile, 'not a lock');
assert.throws(() => takeLock(), /not a benchmark lock/);
assert.equal(readFileSync(lockFile, 'utf8'), 'not a lock');
unlinkSync(lockFile);
assert.deepEqual(readdirSync(folder), ['must-not-change']);
`;

try {
  const result = spawnSync(process.execPath, ['--input-type=module', '--eval', probe], {
    env: { ...process.env, TMPDIR: directory, TMP: directory, TEMP: directory },
    encoding: 'utf8',
    timeout: 15_000,
  });
  assert.equal(result.status, 0, `${result.error ?? ''}\n${result.stderr}`);
  process.stdout.write('pass benchmark lock: planted symlink, live exclusion, stale replacement and cleanup\n');
} finally {
  rmSync(directory, { recursive: true, force: true });
}
