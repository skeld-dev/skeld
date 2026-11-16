// Does:  Proves a hashing computation its caller abandoned, and that later fails, leaves no unhandled rejection.
// Holds: The child replaces crypto.argon2 before auth loads and fails each held computation; the parent only judges.

import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import { syncBuiltinESMExports } from 'node:module';
import { setImmediate as nextTurn } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { createReport } from './rig/report.ts';

const self = fileURLToPath(import.meta.url);

type Done = (error: Error | null, out?: Buffer) => void;

async function child(): Promise<void> {
  const unhandled: string[] = [];
  process.on('unhandledRejection', (reason) => {
    unhandled.push(String(reason));
  });
  const held: Done[] = [];
  let computations = 0;
  // Why: Each platform computation is held until the script fails it, as an out-of-memory allocation would.
  Reflect.set(crypto, 'argon2', (_algorithm: string, _parameters: unknown, done: Done) => {
    computations++;
    held.push(done);
  });
  syncBuiltinESMExports();
  const failAll = async (): Promise<void> => {
    for (const done of held.splice(0)) {
      done(new Error('platform allocation failed'));
    }
    for (let turn = 0; turn < 5; turn++) {
      // biome-ignore lint/performance/noAwaitInLoops: each turn lets the helper's continuations and handlers run
      await nextTurn();
    }
  };
  const { hashPassword, verifyPassword } = await import('@skeld/auth/password');
  const { Secret } = await import('@skeld/core/secret');
  const out: Record<string, unknown> = {};
  const settle = (call: Promise<unknown>): Promise<string> =>
    call.then(
      (value) =>
        `resolved ${typeof value === 'object' && value !== null ? String(Reflect.get(value, 'kind')) : String(value)}`,
      (error: unknown) =>
        `rejected ${error instanceof Error ? `${error.name} ${String(Reflect.get(error, 'code'))}` : String(error)}`,
    );

  const control = settle(hashPassword(new Secret('control')));
  await nextTurn();
  await failAll();
  out.control = await control;

  const hashAbort = new AbortController();
  const hashed = settle(hashPassword(new Secret('abandoned'), { signal: hashAbort.signal }));
  queueMicrotask(() => hashAbort.abort());
  out.abandonedHash = await hashed;
  const verifyAbort = new AbortController();
  // biome-ignore lint/security/noSecrets: a published test vector of an Argon2id hash, not a credential
  const hash = '$argon2id$v=19$m=19456,t=2,p=1$sq6p/F+NCx9MMbhP5H+RyA$v9Qea79zKt24VcM7xMpNxSekAOB65j1RAIspflkC+x4';
  const verified = settle(verifyPassword(new Secret('abandoned'), hash, { signal: verifyAbort.signal }));
  queueMicrotask(() => verifyAbort.abort());
  out.abandonedVerify = await verified;
  out.heldWhenAbandoned = held.length;
  const startedBefore = computations;
  await failAll();
  out.computationsAfter = computations - startedBefore;
  out.computationsTotal = computations;
  const after = settle(hashPassword(new Secret('after')));
  await nextTurn();
  await failAll();
  out.afterAbandon = await after;
  out.unhandled = unhandled;
  process.stdout.write(JSON.stringify(out));
}

if (process.argv[2] === 'child') {
  await child();
} else {
  const report = createReport(
    'a hashing or verifying computation abandoned by its caller (answered busy) that later fails on the platform leaves no unhandled rejection and frees its slot',
  );
  const run = spawnSync(process.execPath, ['--conditions=skeld-source', self, 'child'], {
    encoding: 'utf8',
    timeout: 60_000,
  });
  let seen: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse(run.stdout);
    seen = typeof parsed === 'object' && parsed !== null ? Object.fromEntries(Object.entries(parsed)) : {};
  } catch {
    seen = {};
  }
  report.check(
    'the child ran to the end and exited 0',
    run.status === 0 && 'unhandled' in seen,
    `exit ${String(run.status)} ${run.stderr.slice(0, 200)}`,
  );
  report.check(
    'control: a computation whose caller waits and that fails on the platform rejects AuthError UNAVAILABLE',
    seen.control === 'rejected AuthError UNAVAILABLE',
    String(seen.control),
  );
  report.check(
    'a hash abandoned at once by its signal is answered busy',
    seen.abandonedHash === 'resolved busy',
    String(seen.abandonedHash),
  );
  report.check(
    'a verification abandoned at once by its signal is answered busy',
    seen.abandonedVerify === 'resolved busy',
    String(seen.abandonedVerify),
  );
  report.check(
    'both abandoned computations really ran and failed after their callers had left, and neither was retried',
    seen.heldWhenAbandoned === 2 && seen.computationsTotal === 3 && seen.computationsAfter === 0,
    `${String(seen.computationsTotal)} platform calls in all`,
  );
  report.check(
    'no unhandled rejection was raised by either late failure',
    Array.isArray(seen.unhandled) && seen.unhandled.length === 0,
    JSON.stringify(seen.unhandled),
  );
  report.check(
    'the slots were freed when the computations ended: the next call after them is answered by its own failure (rejected UNAVAILABLE), not busy',
    seen.afterAbandon === 'rejected AuthError UNAVAILABLE',
    String(seen.afterAbandon),
  );
  report.finish();
}
