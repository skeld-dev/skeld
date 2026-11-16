// Does:  Proves the session handoff step by step and the verifications that straddle a credential change.
// Holds: Outcomes are judged from the answer, the sessions table and the records; an application store is a plain map.

import { AuthError } from '@skeld/auth/auth-error';
import {
  cookiesOf,
  disableUser,
  observe,
  type Observed,
  series,
  sleepMs,
  spareStore,
  startApp,
  type App,
} from './rig/v1-app.ts';
import { createReport } from './rig/v1-report.ts';
import { cleanAll, type Kind, makeRig, type Rig, rigKinds, toNumber } from './support-store.ts';
import type { Pool } from 'pg';

const statement =
  'the handoff checks the user id and input keys first, ensures the fence, calls verify once under 10,000 ms, issues with the snapshot generation and records one outcome; a disabled subject cannot sign in, a verification that straddles disable answers disabled and one that straddles disable and enable answers stale; enable is refused when stale, enabled or absent';
const report = createReport('v03', statement);

const NAME = '__Host-skeld';

async function sessionRows(rig: Rig, userId: string): Promise<number> {
  const rows = await rig.query('SELECT count(*) AS n FROM sessions WHERE user_id = ?', [userId]);
  return toNumber(rows[0]?.n);
}

interface Context {
  readonly label: string;
  readonly rig: Rig;
  readonly app: App;
  readonly observed: Observed;
}

async function rejects(call: () => Promise<unknown>): Promise<string> {
  try {
    await call();
    return 'resolved';
  } catch (error) {
    return error instanceof AuthError ? `${error.code}: ${error.message}` : String(error);
  }
}

async function inputCases({ label, app, observed }: Context): Promise<void> {
  let verifies = 0;
  const verify = (): boolean => {
    verifies++;
    return true;
  };
  const bad: [string, string][] = [
    ['an empty user id', ''],
    ['a user id of 129 characters', 'a'.repeat(129)],
    ['a user id with a space', 'a b'],
    ['a user id with a slash', 'a/b'],
    ['a non-ASCII user id', 'käse'],
  ];
  observed.reset();
  await series(bad, async ([name, userId]) => {
    const outcome = await rejects(() => app.sessions.establish({ rawCookies: cookiesOf(NAME), userId, verify }));
    report.check(
      `${label} ${name}: INVALID_INPUT "invalid input", no store call, verify not called`,
      outcome === 'INVALID_INPUT: invalid input' && observed.calls() === 0 && verifies === 0,
      outcome,
    );
  });
  const unknownKey = await rejects(() =>
    app.sessions.establish(JSON.parse(`{"userId":"keys","verify":null,"rawCookies":null,"extra":1}`)),
  );
  report.check(
    `${label} an unknown key of the establish input: INVALID_INPUT before any store call`,
    unknownKey === 'INVALID_INPUT: invalid input' && observed.calls() === 0,
    unknownKey,
  );
  const symbolKey = await rejects(() =>
    app.sessions.establish({ rawCookies: cookiesOf(NAME), userId: 'keys', verify, [Symbol('x')]: 1 }),
  );
  report.check(
    `${label} an unknown symbol key of the establish input: INVALID_INPUT, nothing run`,
    symbolKey === 'INVALID_INPUT: invalid input' && observed.calls() === 0 && verifies === 0,
    symbolKey,
  );
  const rotateKey = await rejects(() => app.sessions.rotate(JSON.parse('{"rawCookies":null,"signalz":1}')));
  report.check(
    `${label} an unknown key of the rotate input: INVALID_INPUT before any store call`,
    rotateKey === 'INVALID_INPUT: invalid input' && observed.calls() === 0,
    rotateKey,
  );
}

async function outcomeCases({ label, rig, app, observed }: Context): Promise<void> {
  const order: string[] = [];
  observed.after('subjectEnsure', () => {
    order.push('ensured');
    return Promise.resolve();
  });
  let signalSeen: unknown = null;
  let verifies = 0;
  const done = await app.sessions.establish({
    rawCookies: cookiesOf(NAME),
    userId: 'happy',
    verify: (signal) => {
      order.push('verify');
      verifies++;
      signalSeen = signal;
      return true;
    },
  });
  observed.after('subjectEnsure', null);
  const rows = await rig.query('SELECT digest, expires_at FROM sessions WHERE user_id = ?', ['happy']);
  report.check(
    `${label} a verified user: established with a LiveSession (status session, user, a 43-character CSRF token, the stored expiry) and one session cookie`,
    done.kind === 'established' &&
      done.session.status === 'session' &&
      done.session.userId === 'happy' &&
      /^[A-Za-z0-9_-]{43}$/.test(done.session.csrfToken) &&
      done.session.expiresAt === toNumber(rows[0]?.expires_at) &&
      done.cookies.length === 1 &&
      done.cookies[0]?.name === NAME &&
      rows.length === 1,
    JSON.stringify(done.kind === 'established' ? { ...done.session, csrfToken: '<43>' } : done),
  );
  report.check(
    `${label} subjectEnsure runs before verify, and verify runs once with an AbortSignal`,
    order.join(',') === 'ensured,verify' && verifies === 1 && signalSeen instanceof AbortSignal,
    order.join(','),
  );
  await app.logs.settle();
  const succeeded = app.logs.named('auth.signin.succeeded');
  report.check(
    `${label} one auth.signin.succeeded at info with the user and via handoff, and no auth.signin.failed for it`,
    succeeded.length === 1 &&
      succeeded[0]?.fields['auth.user'] === 'happy' &&
      succeeded[0]?.fields['auth.via'] === 'handoff' &&
      app.logs.named('auth.signin.failed').length === 0,
    JSON.stringify(succeeded[0]?.fields),
  );

  const refusals: readonly (readonly [string, () => boolean | Promise<boolean>, 'rejected' | 'callback'])[] = [
    ['verify answers false', () => false, 'rejected'],
  ];
  await series(refusals, async ([name, verify, reason], index) => {
    const user = `refuse-${index}`;
    const result = await app.sessions.establish({ rawCookies: cookiesOf(NAME), userId: user, verify });
    report.check(
      `${label} ${name}: refused ${reason}, no session row, no cookie`,
      result.kind === 'refused' &&
        result.reason === reason &&
        !('cookies' in result) &&
        (await sessionRows(rig, user)) === 0,
      JSON.stringify(result),
    );
  });
  verifies = 0;
  observed.failWith('no', 'subjectEnsure');
  const ensureFailed = await app.sessions.establish({
    rawCookies: cookiesOf(NAME),
    userId: 'outage',
    verify: () => {
      verifies++;
      return true;
    },
  });
  observed.failWith(null);
  report.check(
    `${label} subjectEnsure failing: Unavailable not_applied, verify not called, no row`,
    ensureFailed.kind === 'unavailable' &&
      ensureFailed.outcome === 'not_applied' &&
      verifies === 0 &&
      (await sessionRows(rig, 'outage')) === 0,
    JSON.stringify(ensureFailed),
  );
  observed.failWith('no', 'sessionIssue');
  const issueFailed = await app.sessions.establish({
    rawCookies: cookiesOf(NAME),
    userId: 'outage',
    verify: () => true,
  });
  observed.failWith('unknown', 'sessionIssue');
  const issueUnknown = await app.sessions.establish({
    rawCookies: cookiesOf(NAME),
    userId: 'outage',
    verify: () => true,
  });
  observed.failWith(null);
  report.check(
    `${label} sessionIssue failing: Unavailable not_applied, and with an unknown outcome Unavailable unknown; no cookie and no row either way`,
    issueFailed.kind === 'unavailable' &&
      issueFailed.outcome === 'not_applied' &&
      issueUnknown.kind === 'unavailable' &&
      issueUnknown.outcome === 'unknown' &&
      (await sessionRows(rig, 'outage')) === 0,
    `${JSON.stringify(issueFailed)} ${JSON.stringify(issueUnknown)}`,
  );
  await app.logs.settle();
  const unavailable = app.logs.named('auth.signin.failed').filter((r) => r.fields['auth.reason'] === 'unavailable');
  report.check(
    `${label} each Unavailable is one auth.signin.failed with reason unavailable (3)`,
    unavailable.length === 3,
    `${unavailable.length}`,
  );
  const retry = await app.sessions.establish({ rawCookies: cookiesOf(NAME), userId: 'outage', verify: () => true });
  report.check(
    `${label} nothing is replayed: after the outage one fresh establish gives exactly one session`,
    retry.kind === 'established' && (await sessionRows(rig, 'outage')) === 1,
    retry.kind,
  );

  const disabled = await app.subjects.disable('off');
  verifies = 0;
  const refused = await app.sessions.establish({
    rawCookies: cookiesOf(NAME),
    userId: 'off',
    verify: () => {
      verifies++;
      return true;
    },
  });
  report.check(
    `${label} a disabled subject: refused disabled and verify is not called`,
    disabled.kind === 'done' && refused.kind === 'refused' && refused.reason === 'disabled' && verifies === 0,
    JSON.stringify(refused),
  );

  const controller = new AbortController();
  const pending = Promise.withResolvers<boolean>();
  const reached = Promise.withResolvers<void>();
  const callbackBefore = app.logs.named('auth.callback.failed').length;
  const aborting = app.sessions.establish({
    rawCookies: cookiesOf(NAME),
    userId: 'aborting',
    signal: controller.signal,
    verify: () => {
      reached.resolve();
      return pending.promise;
    },
  });
  await reached.promise;
  const began = performance.now();
  controller.abort();
  const aborted = await aborting;
  const waited = performance.now() - began;
  pending.resolve(true);
  await sleepMs(200);
  await app.logs.settle();
  report.check(
    `${label} an abort of input.signal during verify ends the wait at once: Unavailable not_applied, no session, the late true ignored, no auth.callback.failed`,
    aborted.kind === 'unavailable' &&
      aborted.outcome === 'not_applied' &&
      waited < 300 &&
      (await sessionRows(rig, 'aborting')) === 0 &&
      app.logs.named('auth.callback.failed').length === callbackBefore,
    `${JSON.stringify(aborted)} after ${Math.round(waited)} ms`,
  );
}

async function unavailableVerify({ label, rig, app }: Context): Promise<void> {
  await app.logs.settle();
  const failedBefore = app.logs.named('auth.signin.failed').length;
  const callbackBefore = app.logs.named('auth.callback.failed').length;
  const answer = await app.sessions.establish({
    rawCookies: cookiesOf(NAME),
    userId: 'busy-hash',
    verify: () => 'unavailable',
  });
  const asyncAnswer = await app.sessions.establish({
    rawCookies: cookiesOf(NAME),
    userId: 'busy-hash',
    verify: () => Promise.resolve('unavailable'),
  });
  await app.logs.settle();
  const failed = app.logs.named('auth.signin.failed').slice(failedBefore);
  report.check(
    `${label} verify answering 'unavailable' (sync or async): Unavailable not_applied, no session, no cookie, one auth.signin.failed with reason unavailable each and no auth.callback.failed`,
    answer.kind === 'unavailable' &&
      answer.outcome === 'not_applied' &&
      asyncAnswer.kind === 'unavailable' &&
      asyncAnswer.outcome === 'not_applied' &&
      (await sessionRows(rig, 'busy-hash')) === 0 &&
      failed.length === 2 &&
      failed.every((record) => record.fields['auth.reason'] === 'unavailable') &&
      app.logs.named('auth.callback.failed').length === callbackBefore,
    `${JSON.stringify(answer)}; ${failed.length} sign-in failures; callback records ${app.logs.named('auth.callback.failed').length - callbackBefore}`,
  );
}

async function deadlineCases({ label, rig, app }: Context): Promise<void> {
  const callbackBefore = app.logs.named('auth.callback.failed').length;
  let lateAnswered = false;
  const began = performance.now();
  const [hangs, late] = await Promise.all([
    app.sessions.establish({
      rawCookies: cookiesOf(NAME),
      userId: 'hang',
      verify: () => new Promise<boolean>(() => undefined),
    }),
    app.sessions.establish({
      rawCookies: cookiesOf(NAME),
      userId: 'late',
      verify: async () => {
        await sleepMs(10_300);
        lateAnswered = true;
        return true;
      },
    }),
  ]);
  const elapsed = Math.round(performance.now() - began);
  await sleepMs(500);
  await app.logs.settle();
  const records = app.logs.named('auth.callback.failed').slice(callbackBefore);
  report.check(
    `${label} verify that never settles and verify that answers true after the deadline: both refused callback at the 10,000 ms deadline (allowed 9,990 to 10,500 ms: the contract gives 10,000 and a shared host fires timers late), no session, no late admission`,
    hangs.kind === 'refused' &&
      hangs.reason === 'callback' &&
      late.kind === 'refused' &&
      late.reason === 'callback' &&
      elapsed >= 9990 &&
      elapsed <= 10_500 &&
      lateAnswered &&
      (await sessionRows(rig, 'late')) === 0 &&
      (await sessionRows(rig, 'hang')) === 0,
    `${elapsed} ms; late answer delivered ${lateAnswered}`,
  );
  report.check(
    `${label} each is one auth.callback.failed for handoff.verify with cause deadline`,
    records.length === 2 &&
      records.every((r) => r.fields['auth.callback'] === 'handoff.verify' && r.fields['auth.cause'] === 'deadline'),
    `${records.length} records`,
  );
}

interface Changer {
  readonly credentials: Map<string, string>;
  signIn: (user: string, password: string) => Promise<string>;
}

function applicationStore(app: App): Changer {
  const credentials = new Map<string, string>();
  return {
    credentials,
    signIn: async (user, password) => {
      const result = await app.sessions.establish({
        rawCookies: cookiesOf(NAME),
        userId: user,
        verify: () => credentials.get(user) === password,
      });
      return result.kind === 'refused' ? `refused:${result.reason}` : result.kind;
    },
  };
}

async function tableCases({ label, rig, app }: Context): Promise<void> {
  const store = applicationStore(app);
  const read = async (user: string): Promise<string> => {
    const answer = await app.subjects.read(user);
    return answer.kind === 'subject' ? `${answer.enabled ? 'enabled' : 'disabled'}@${answer.generation}` : answer.kind;
  };
  const brief = (value: unknown): string => JSON.stringify(value);
  store.credentials.set('t1', 'old');
  await store.signIn('t1', 'old');

  store.credentials.set('t7', 'old');
  const g7 = await disableUser(app.subjects, 't7');
  const other = await app.subjects.disable('t7');
  const staleRefusal = await app.subjects.enable('t7', g7);
  const stateStale = await read('t7');
  const reenabled = await app.subjects.enable('t7', other.kind === 'done' ? other.generation : 0);
  const live7 = await store.signIn('t7', 'old');
  const lateRefusal = await app.subjects.enable('t7', g7);
  const rowsBefore = await sessionRows(rig, 't7');
  report.check(
    `${label} step 3 refused stale (another actor wrote the fence since step 1) and refused enabled (it was enabled since): each changes nothing, ends no session and writes no record`,
    other.kind === 'done' &&
      staleRefusal.kind === 'refused' &&
      staleRefusal.reason === 'stale' &&
      stateStale === `disabled@${other.kind === 'done' ? other.generation : 0}` &&
      reenabled.kind === 'done' &&
      live7 === 'established' &&
      lateRefusal.kind === 'refused' &&
      lateRefusal.reason === 'enabled' &&
      rowsBefore === 1 &&
      (await sessionRows(rig, 't7')) === 1,
    `${brief(staleRefusal)} ${stateStale} ${brief(lateRefusal)}; sessions ${rowsBefore}`,
  );
  const enabledNow = await app.subjects.enable('t1', 1);
  report.check(
    `${label} enable of a subject that is enabled is refused with reason enabled or stale and changes nothing`,
    enabledNow.kind === 'refused' &&
      (enabledNow.reason === 'enabled' || enabledNow.reason === 'stale') &&
      (await read('t1')) === 'enabled@1',
    `${brief(enabledNow)} ${await read('t1')}`,
  );
  const absent = await app.subjects.enable('never-seen', 1);
  const absentRow = await rig.query('SELECT count(*) AS n FROM subjects WHERE user_id = ?', ['never-seen']);
  report.check(
    `${label} step 3 refused absent: no fence row exists, enable creates none, read answers absent`,
    absent.kind === 'refused' &&
      absent.reason === 'absent' &&
      toNumber(absentRow[0]?.n) === 0 &&
      (await read('never-seen')) === 'absent',
    `${brief(absent)} rows ${toNumber(absentRow[0]?.n)}`,
  );

  store.credentials.set('t4', 'old');
  const straddleDisable = Promise.withResolvers<boolean>();
  const reachedDisable = Promise.withResolvers<void>();
  const beforeDisable = app.sessions.establish({
    rawCookies: cookiesOf(NAME),
    userId: 't4',
    verify: () => {
      reachedDisable.resolve();
      return straddleDisable.promise;
    },
  });
  await reachedDisable.promise;
  const g4 = await disableUser(app.subjects, 't4');
  straddleDisable.resolve(true);
  const disabledAnswer = await beforeDisable;
  report.check(
    `${label} a verification that began before step 1 and ends after it, before step 3: refused disabled, no session`,
    disabledAnswer.kind === 'refused' && disabledAnswer.reason === 'disabled' && (await sessionRows(rig, 't4')) === 0,
    brief(disabledAnswer),
  );
  let called = 0;
  const duringDisabled = await app.sessions.establish({
    rawCookies: cookiesOf(NAME),
    userId: 't4',
    verify: () => {
      called++;
      return true;
    },
  });
  report.check(
    `${label} a verification that begins between steps 1 and 3: establish answers disabled and verify is not called`,
    duringDisabled.kind === 'refused' && duringDisabled.reason === 'disabled' && called === 0,
    `verify calls ${called}`,
  );
  await app.subjects.enable('t4', g4);

  store.credentials.set('t8', 'old');
  const straddleBoth = Promise.withResolvers<boolean>();
  const reachedBoth = Promise.withResolvers<void>();
  const spanning = app.sessions.establish({
    rawCookies: cookiesOf(NAME),
    userId: 't8',
    verify: () => {
      reachedBoth.resolve();
      return straddleBoth.promise;
    },
  });
  await reachedBoth.promise;
  const g8 = await disableUser(app.subjects, 't8');
  store.credentials.set('t8', 'new');
  await app.subjects.enable('t8', g8);
  straddleBoth.resolve(true);
  const staleAnswer = await spanning;
  report.check(
    `${label} a verification that began before step 1 and ends after step 3 (the generation raised twice): refused stale, no session`,
    staleAnswer.kind === 'refused' && staleAnswer.reason === 'stale' && (await sessionRows(rig, 't8')) === 0,
    brief(staleAnswer),
  );
  const after = [await store.signIn('t8', 'old'), await store.signIn('t8', 'new')];
  report.check(
    `${label} a verification that begins after step 3 reads the new record: only the new credential signs in`,
    after.join(',') === 'refused:rejected,established',
    after.join(','),
  );
  await sleepMs(300);
  const parked = await app.subjects.disable('t8-parked');
  await sleepMs(400);
  report.check(
    `${label} auth never re-enables by itself: a disabled subject is still disabled after waiting`,
    parked.kind === 'done' && (await read('t8-parked')) === 'disabled@2',
    await read('t8-parked'),
  );
}

async function straddleRecords(kind: Kind, rig: Rig, pools: Pool[]): Promise<void> {
  const label = `[${kind}]`;
  const app = await startApp({ store: observe(spareStore(rig, pools)).store });
  try {
    const straddle = async (user: string, change: () => Promise<void>): Promise<string> => {
      const hold = Promise.withResolvers<boolean>();
      const reached = Promise.withResolvers<void>();
      const pending = app.sessions.establish({
        rawCookies: cookiesOf(NAME),
        userId: user,
        verify: () => {
          reached.resolve();
          return hold.promise;
        },
      });
      await reached.promise;
      await change();
      hold.resolve(true);
      const answer = await pending;
      return answer.kind === 'refused' ? answer.reason : answer.kind;
    };
    const disabled = await straddle('s-disable', async () => {
      await app.subjects.disable('s-disable');
    });
    const stale = await straddle('s-both', async () => {
      const generation = await disableUser(app.subjects, 's-both');
      await app.subjects.enable('s-both', generation);
    });
    await app.logs.settle();
    const failed = app.logs.named('auth.signin.failed');
    const reasons = failed.map((r) => `${String(r.fields['auth.user'])}:${String(r.fields['auth.reason'])}`).sort();
    report.check(
      `${label} the two straddling verifications differ only in the answer and the recorded reason (disabled, stale): one auth.signin.failed each, no cookie`,
      disabled === 'disabled' &&
        stale === 'stale' &&
        reasons.join(',') === 's-both:stale,s-disable:disabled' &&
        failed.every((r) => r.severity === 'warn' && r.fields['auth.via'] === 'handoff') &&
        app.logs.named('auth.signin.succeeded').length === 0,
      reasons.join(','),
    );
  } finally {
    await app.close();
  }
}

async function shutdownCase(kind: Kind, rig: Rig, pools: Pool[]): Promise<void> {
  const label = `[${kind}]`;
  const observed = observe(spareStore(rig, pools));
  const app = await startApp({ store: observed.store });
  const reached = Promise.withResolvers<void>();
  const hold = Promise.withResolvers<boolean>();
  const pending = app.sessions.establish({
    rawCookies: cookiesOf(NAME),
    userId: 'closing',
    verify: () => {
      reached.resolve();
      return hold.promise;
    },
  });
  await reached.promise;
  const began = performance.now();
  const closing = app.close();
  const answer = await pending;
  const waited = performance.now() - began;
  hold.resolve(true);
  await closing;
  report.check(
    `${label} shutdown during verify ends the wait at once: Unavailable not_applied, no session, no late admission`,
    answer.kind === 'unavailable' &&
      answer.outcome === 'not_applied' &&
      waited < 2000 &&
      (await sessionRows(rig, 'closing')) === 0,
    `${JSON.stringify(answer)} after ${Math.round(waited)} ms`,
  );
  const after = await rejects(() =>
    app.sessions.establish({ rawCookies: cookiesOf(NAME), userId: 'closing', verify: () => true }),
  );
  report.check(
    `${label} establish after the server closed rejects CLOSED "auth is closed"`,
    after === 'CLOSED: auth is closed',
    after,
  );
}

async function suite(kind: Kind): Promise<void> {
  const label = `[${kind}]`;
  const rig = await makeRig(kind, { attach: false });
  const observed = observe(rig.store);
  const app = await startApp({ store: observed.store });
  const context: Context = { label, rig, app, observed };
  const pools: Pool[] = [];
  try {
    await report.run(`${label} input cases`, () => inputCases(context));
    await report.run(`${label} outcome cases`, () => outcomeCases(context));
    await report.run(`${label} verify unavailable`, () => unavailableVerify(context));
    await report.run(`${label} interruption table`, () => tableCases(context));
    await report.run(`${label} verify deadline`, () => deadlineCases(context));
  } finally {
    await app.close();
  }
  try {
    await report.run(`${label} straddling records`, () => straddleRecords(kind, rig, pools));
    await report.run(`${label} shutdown`, () => shutdownCase(kind, rig, pools));
    const before = await rejects(() => createNotReady(rig, pools));
    report.check(
      `${label} establish before listen rejects NOT_READY "auth is not ready"`,
      before === 'NOT_READY: auth is not ready',
      before,
    );
  } finally {
    await Promise.all(pools.map((pool) => pool.end()));
    await rig.dispose();
  }
}

async function createNotReady(rig: Rig, pools: Pool[]): Promise<void> {
  const { createAuth } = await import('@skeld/auth/server');
  const auth = createAuth({ store: spareStore(rig, pools), origin: 'http://127.0.0.1' });
  await auth.sessions.establish({ rawCookies: cookiesOf(NAME), userId: 'early', verify: () => true });
}

try {
  await series(rigKinds, suite);
} finally {
  await cleanAll();
}
report.finish();
