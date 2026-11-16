// Does:  Proves the password helpers' two-slot, 64-waiter bound and that an abandoned computation keeps its slot.
// Holds: Slot cases run in a child whose crypto.argon2 is held by the test; no case is judged by elapsed time.

import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import { syncBuiltinESMExports } from 'node:module';
import { setImmediate as nextTurn } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { hashPassword, verifyPassword } from '@skeld/auth/password';
import { Secret } from '@skeld/core/secret';
import { createReport } from './rig/report.ts';

type Done = (error: Error | null, out?: Buffer) => void;

// Does:  The child: holds every platform computation until the script ends it, and prints what each caller saw.
async function child(): Promise<void> {
  const unhandled: string[] = [];
  process.on('unhandledRejection', (reason) => {
    unhandled.push(String(reason));
  });
  const held: Done[] = [];
  let started = Promise.withResolvers<void>();
  Reflect.set(crypto, 'argon2', (_algorithm: string, _parameters: unknown, done: Done) => {
    held.push(done);
    started.resolve();
  });
  syncBuiltinESMExports();
  const password = await import('@skeld/auth/password');
  const startedNext = async (count: number): Promise<void> => {
    while (held.length < count) {
      started = Promise.withResolvers<void>();
      // biome-ignore lint/performance/noAwaitInLoops: each wait is for the next platform call
      await started.promise;
    }
  };
  const kindOf = (call: Promise<{ kind: string }>): Promise<string> => call.then((answer) => answer.kind);
  const turns = async (count: number): Promise<void> => {
    for (let n = 0; n < count; n++) {
      // biome-ignore lint/performance/noAwaitInLoops: each turn lets the helper's continuations run
      await nextTurn();
    }
  };
  const out: Record<string, unknown> = {};
  const first = new AbortController();
  const second = new AbortController();
  const a = kindOf(password.hashPassword(new Secret('a'), { signal: first.signal }));
  const b = kindOf(password.hashPassword(new Secret('b'), { signal: second.signal }));
  await startedNext(2);
  first.abort();
  second.abort();
  out.abandoned = [await a, await b];
  let thirdAnswer = 'unsettled';
  const third = kindOf(password.hashPassword(new Secret('c'))).then((kind) => {
    thirdAnswer = kind;
    return kind;
  });
  const waiter = new AbortController();
  const waiting = kindOf(password.hashPassword(new Secret('d'), { signal: waiter.signal }));
  await turns(5);
  out.whileHeld = { computations: held.length, third: thirdAnswer };
  waiter.abort();
  out.waiterAborted = await waiting;
  out.computationsAfterWaiterAbort = held.length;
  held[0]?.(null, Buffer.alloc(32, 1));
  await startedNext(3);
  out.thirdStartedAfterOneEnded = held.length;
  held[1]?.(null, Buffer.alloc(32, 2));
  held[2]?.(null, Buffer.alloc(32, 3));
  out.third = await third;
  await turns(5);
  out.unhandled = unhandled;
  process.stdout.write(JSON.stringify(out));
}

async function parent(): Promise<void> {
  const report = createReport(
    'two password computations run at a time and 64 callers wait; the rest are busy before any computation ends; a caller that leaves frees no slot until its computation ends',
  );
  await report.run('queue bound on the platform computation', async () => {
    const base = await hashPassword(new Secret('queue'));
    const record = base.kind === 'hashed' ? base.hash : '';
    const order: string[] = [];
    await Promise.all(
      Array.from({ length: 100 }, () =>
        verifyPassword(new Secret('queue'), record).then((verdict) => void order.push(verdict.kind)),
      ),
    );
    const busy = order.filter((kind) => kind === 'busy').length;
    const lastBusy = order.lastIndexOf('busy');
    report.check(
      '100 simultaneous verifications: 66 match and 34 are busy, every busy answer before the first match',
      order.filter((kind) => kind === 'match').length === 66 && busy === 34 && lastBusy === busy - 1,
      `answers in order of arrival: ${busy} busy, last busy at position ${lastBusy + 1}`,
    );
  });
  const run = spawnSync(process.execPath, ['--conditions=skeld-source', fileURLToPath(import.meta.url), 'child'], {
    encoding: 'utf8',
    timeout: 20_000,
  });
  let seen: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse(run.stdout);
    seen = typeof parsed === 'object' && parsed !== null ? Object.fromEntries(Object.entries(parsed)) : {};
  } catch {
    seen = {};
  }
  const show = (value: unknown): string => JSON.stringify(value);
  report.check(
    'the slot child ran to the end',
    run.status === 0 && 'unhandled' in seen,
    `exit ${String(run.status)} ${run.stderr.slice(0, 200)}`,
  );
  report.check(
    'two callers whose computations are running and who abort are answered busy',
    show(seen.abandoned) === '["busy","busy"]',
    show(seen.abandoned),
  );
  report.check(
    'with both computations still running, a third caller does not start one: still two platform calls, no answer',
    show(seen.whileHeld) === '{"computations":2,"third":"unsettled"}',
    show(seen.whileHeld),
  );
  report.check(
    'a caller that aborts while it waits is answered busy and starts no computation',
    seen.waiterAborted === 'busy' && seen.computationsAfterWaiterAbort === 2,
    `${String(seen.waiterAborted)}; platform calls ${String(seen.computationsAfterWaiterAbort)}`,
  );
  report.check(
    'when one abandoned computation ends its slot is freed: the third starts and hashes',
    seen.thirdStartedAfterOneEnded === 3 && seen.third === 'hashed',
    `platform calls ${String(seen.thirdStartedAfterOneEnded)}; third ${String(seen.third)}`,
  );
  report.check(
    'no unhandled rejection',
    Array.isArray(seen.unhandled) && seen.unhandled.length === 0,
    show(seen.unhandled),
  );
  report.finish();
}

if (process.argv[2] === 'child') {
  await child();
} else {
  await parent();
}
