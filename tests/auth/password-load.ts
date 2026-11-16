// Does:  Proves the password worker's bounded queue and cancellation of a waiting caller under real load.
// Holds: Queued work beyond the bound is busy at once; a waiting caller that aborts is busy without computing.
// biome-ignore-all lint/performance/noAwaitInLoops: each probe finishes before the next so timings are separate

import { hashPassword, verifyPassword } from '@skeld/auth/password';
import { Secret } from '@skeld/core/secret';
import { createReport } from './rig/report.ts';

const report = createReport(
  'v06',
  'password-load',
  'the password worker queue stays bounded and a waiting caller is released on abort',
);
const pw = (text: string): Secret<string> => new Secret(text);
const ms = (since: number): number => Math.round(performance.now() - since);

await report.run('queue and cancellation', async () => {
  const base = await hashPassword(pw('queue'));
  const record = base.kind === 'hashed' ? base.hash : '';
  const burst = await Promise.all(
    Array.from({ length: 100 }, () => {
      const at = performance.now();
      return verifyPassword(pw('queue'), record).then((verdict) => ({ verdict: verdict.kind, took: ms(at) }));
    }),
  );
  const busy = burst.filter((item) => item.verdict === 'busy');
  const done = burst.filter((item) => item.verdict === 'match');
  report.check(
    '100 simultaneous verifications: 2 run, 64 wait, the other 34 are busy at once',
    done.length === 66 && busy.length === 34 && busy.every((item) => item.took < 100),
    `${done.length} matched, ${busy.length} busy (the slowest busy answer after ${Math.max(...busy.map((item) => item.took))} ms)`,
  );
  const heavy = { memoryKiB: 65_536, passes: 8 };
  const heavyHash = await hashPassword(pw('heavy'), { cost: heavy });
  const heavyRecord = heavyHash.kind === 'hashed' ? heavyHash.hash : '';
  const abortWaiting = new AbortController();
  const occupy = [verifyPassword(pw('heavy'), heavyRecord), verifyPassword(pw('heavy'), heavyRecord)];
  const waitingCall = verifyPassword(pw('heavy'), heavyRecord, { signal: abortWaiting.signal });
  const atAbort = performance.now();
  abortWaiting.abort();
  const aborted = await waitingCall;
  report.check(
    'a caller aborted while it waits is busy at once',
    aborted.kind === 'busy' && ms(atAbort) < 50,
    `${aborted.kind} after ${ms(atAbort)} ms`,
  );
  await Promise.all(occupy);
});

report.finish();
