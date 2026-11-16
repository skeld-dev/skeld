// Does:  Proves the password worker concurrency, bounded queue, deadline and cancellation under real load.
// Holds: Running work retains its slot after caller cancellation; queued work expires or aborts without computing.
// biome-ignore-all lint/performance/noAwaitInLoops: each probe finishes before the next so timings are separate

import { hashPassword, verifyPassword } from '@skeld/auth/password';
import { Secret } from '@skeld/core/secret';
import { createReport } from './rig/report.ts';
import { sleep } from './rig/util.ts';

const report = createReport(
  'v06',
  'password-load',
  'password worker concurrency, queue, deadlines and cancellation stay bounded',
);
const pw = (text: string): Secret<string> => new Secret(text);
const ms = (since: number): number => Math.round(performance.now() - since);

await report.run('concurrency, queue and deadline', async () => {
  const base = await hashPassword(pw('queue'));
  const record = base.kind === 'hashed' ? base.hash : '';
  const warm = performance.now();
  await verifyPassword(pw('queue'), record);
  const unit = Math.max(ms(warm), 1);
  const started = performance.now();
  const burst = await Promise.all(
    Array.from({ length: 100 }, () => {
      const at = performance.now();
      return verifyPassword(pw('queue'), record).then((verdict) => ({ verdict: verdict.kind, took: ms(at) }));
    }),
  );
  const total = ms(started);
  const busy = burst.filter((item) => item.verdict === 'busy');
  const done = burst.filter((item) => item.verdict === 'match');
  report.check(
    '100 simultaneous verifications: 2 run, 64 wait, the other 34 are busy at once',
    done.length === 66 && busy.length === 34 && busy.every((item) => item.took < 100),
    `${done.length} matched, ${busy.length} busy (the slowest busy answer after ${Math.max(...busy.map((item) => item.took))} ms)`,
  );
  report.check(
    'two run at a time: 66 verifications took about 33 single-verification times, not 66 and not 11',
    total > unit * 22 && total < unit * 48,
    `one verification ${unit} ms; the 66 took ${total} ms (${(total / unit).toFixed(1)} units); host shared with other work`,
  );

  const heavy = { memoryKiB: 65_536, passes: 8 };
  const heavyHash = await hashPassword(pw('heavy'), { cost: heavy });
  const heavyRecord = heavyHash.kind === 'hashed' ? heavyHash.hash : '';
  await verifyPassword(pw('heavy'), heavyRecord);
  const probes: number[] = [];
  for (let i = 0; i < 3; i++) {
    const probe = performance.now();
    await verifyPassword(pw('heavy'), heavyRecord);
    probes.push(ms(probe));
  }
  const heavyUnit = Math.min(...probes);
  const count = Math.min(66, 2 * Math.ceil(5500 / heavyUnit) + 4);
  const begin = performance.now();
  const waiters = await Promise.all(
    Array.from({ length: count }, () =>
      verifyPassword(pw('heavy'), heavyRecord).then((verdict) => ({ verdict: verdict.kind, took: ms(begin) })),
    ),
  );
  const timedOut = waiters.filter((item) => item.verdict === 'busy');
  const slowest = Math.max(...timedOut.map((item) => item.took), 0);
  const fastest = Math.min(...timedOut.map((item) => item.took), Number.POSITIVE_INFINITY);
  report.check(
    'a waiter that has waited 5,000 ms is busy, and the ones ahead of it finished: matches before, busy at the deadline',
    timedOut.length >= 1 && fastest >= 4900 && slowest <= 5600 && waiters.some((item) => item.verdict === 'match'),
    `${count} verifications of ${heavyUnit} ms each: ${waiters.filter((item) => item.verdict === 'match').length} matched, ${timedOut.length} busy, first busy at ${fastest} ms and last at ${slowest} ms`,
  );

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

  const timeThird = async (abort: boolean): Promise<{ finish: number; busy: boolean }> => {
    const controllers = [new AbortController(), new AbortController()];
    const begun = performance.now();
    const holders = controllers.map((controller) =>
      verifyPassword(pw('heavy'), heavyRecord, { signal: controller.signal }),
    );
    await sleep(100);
    if (abort) {
      for (const controller of controllers) {
        controller.abort();
      }
    }
    const answers = await Promise.all(holders);
    const third = await verifyPassword(pw('heavy'), heavyRecord);
    return {
      finish: ms(begun),
      busy: third.kind === 'match' && answers.every((answer) => answer.kind === (abort ? 'busy' : 'match')),
    };
  };
  const control = await timeThird(false);
  const abortedRun = await timeThird(true);
  report.check(
    'a caller aborted while its computation runs is busy at once, but the slot stays taken until the computation ends',
    abortedRun.busy && control.busy && abortedRun.finish >= control.finish * 0.7,
    `the third verification finished ${abortedRun.finish} ms after the holders began when they were aborted at 100 ms, and ${control.finish} ms when they ran on; had the slot been freed at the abort it would have finished in about ${heavyUnit + 100} ms`,
  );
});

report.finish();
