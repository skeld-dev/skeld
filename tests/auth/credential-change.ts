// Does:  Proves on both adapters the generation fence: stale enable, revocation and a sign-in crossing a change.
// Holds: Orderings are forced by holding verify open; results come from public answers, HTTP statuses and row counts.

import { randomBytes } from 'node:crypto';
import type { Subjects } from '@skeld/auth/server';
import { createReport } from './rig/report.ts';
import { cookieHeader, get, series, startApp } from './rig/v1-app.ts';
import { cleanAll, fresh, type Kind, makeRig, type Rig, rigKinds } from './support-store.ts';

const report = createReport(
  'enable is fenced by the generation it names and ends the sessions of the disabled subject; revocation ends every session; a sign-in whose verification crosses a credential change issues no session',
);

const id = (prefix: string): string => `${prefix}-${randomBytes(5).toString('hex')}`;

type Answer = Awaited<ReturnType<Subjects[keyof Subjects]>>;

function show(answer: Answer): string {
  switch (answer.kind) {
    case 'done':
      return `done(enabled=${answer.enabled},generation=${answer.generation})`;
    case 'refused':
      return `refused/${answer.reason}`;
    case 'subject':
      return `subject(enabled=${answer.enabled},generation=${answer.generation})`;
    case 'absent':
      return 'absent';
    case 'unavailable':
      return `unavailable/${answer.outcome}`;
    default:
      return 'unknown-answer';
  }
}

async function plant(rig: Rig, userId: string, count: number): Promise<void> {
  const now = Date.now();
  await series(Array.from({ length: count }), async () => {
    await rig.query(
      'INSERT INTO sessions (digest, user_id, created_at, last_seen_at, absolute_expires_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)',
      [Buffer.from(fresh()), userId, now, now, now + 3_600_000, now + 3_600_000],
    );
  });
}

// Does:  Plants sessions under a disabled subject, which no public call can make, to see what enable deletes.
async function enableDeletes(kind: Kind): Promise<void> {
  const rig = await makeRig(kind);
  try {
    const userId = id('u1');
    const disabled = await rig.store.ops.subjectDisable({ userId });
    await plant(rig, userId, 3);
    const stale = await rig.store.ops.subjectEnable({ userId, generation: disabled.generation + 1 });
    const kept = await rig.count('sessions', 'user_id', userId);
    const done = await rig.store.ops.subjectEnable({ userId, generation: disabled.generation });
    report.check(
      `[${kind}] store unit: subjectEnable at the disabled generation answers done with revoked 3 and the generation one higher; at another generation it answers lost stale and deletes nothing`,
      stale.kind === 'lost' &&
        stale.reason === 'stale' &&
        kept === 3 &&
        done.kind === 'done' &&
        done.revoked === 3 &&
        done.generation === disabled.generation + 1 &&
        (await rig.count('sessions', 'user_id', userId)) === 0,
      `stale ${stale.kind}, kept ${kept}, done ${done.kind} revoked ${done.kind === 'done' ? done.revoked : '-'}`,
    );
  } finally {
    await rig.dispose();
  }
}

async function publicCases(kind: Kind): Promise<void> {
  const label = `[${kind}]`;
  const rig = await makeRig(kind, { attach: false });
  let hold: (() => Promise<void>) | null = null;
  const app = await startApp({
    store: rig.store,
    verify: async () => {
      await hold?.();
      return true;
    },
  });
  const { subjects } = app;
  const admitted = async (token: string | null): Promise<number | string> =>
    token === null ? 'no session' : (await get(app.port, '/docs', [cookieHeader('__Host-skeld', token)])).status;
  const rows = (userId: string): Promise<number> => rig.count('sessions', 'user_id', userId);
  try {
    const revokedUser = id('rv');
    const first = await app.signIn(revokedUser);
    const second = await app.signIn(revokedUser);
    const readBefore = await subjects.read(revokedUser);
    const revoked = await subjects.revokeSessions(revokedUser);
    const readAfter = await subjects.read(revokedUser);
    const statuses = `${await admitted(first.token)} ${await admitted(second.token)}`;
    report.check(
      `${label} revokeSessions ends every session of the user and raises the generation, leaving it enabled`,
      revoked.kind === 'done' &&
        statuses === '401 401' &&
        (await rows(revokedUser)) === 0 &&
        readBefore.kind === 'subject' &&
        readAfter.kind === 'subject' &&
        readAfter.enabled &&
        readAfter.generation > readBefore.generation,
      `${show(revoked)}; sessions answer ${statuses}; ${show(readBefore)} -> ${show(readAfter)}`,
    );

    const fenced = id('st');
    const live = await app.signIn(fenced);
    const firstDisable = await subjects.disable(fenced);
    const secondDisable = await subjects.disable(fenced);
    if (firstDisable.kind !== 'done' || secondDisable.kind !== 'done') {
      throw new Error(`disable answered ${show(firstDisable)} and ${show(secondDisable)}`);
    }
    const stale = await subjects.enable(fenced, firstDisable.generation);
    const afterStale = await subjects.read(fenced);
    const whileDisabled = await app.signIn(fenced);
    const enabled = await subjects.enable(fenced, secondDisable.generation);
    const repeated = await subjects.enable(fenced, secondDisable.generation);
    const absent = await subjects.enable(id('nobody'), 2);
    report.check(
      `${label} enable at a generation another disable moved is refused stale and changes nothing; at the current one it enables`,
      show(stale) === 'refused/stale' &&
        show(afterStale) === `subject(enabled=false,generation=${secondDisable.generation})` &&
        enabled.kind === 'done' &&
        enabled.enabled &&
        enabled.generation > secondDisable.generation,
      `${show(stale)}; ${show(afterStale)}; then ${show(enabled)}`,
    );
    report.check(
      `${label} enable on an enabled subject is refused enabled and on an unknown one absent`,
      show(repeated) === 'refused/enabled' && show(absent) === 'refused/absent',
      `${show(repeated)}; ${show(absent)}`,
    );
    report.check(
      `${label} a disabled subject's session is refused and it cannot sign in until enabled`,
      (await admitted(live.token)) === 401 &&
        whileDisabled.result === 'refused:disabled' &&
        whileDisabled.token === null &&
        (await app.signIn(fenced)).result === 'established',
      `old session ${await admitted(live.token)}; sign-in while disabled ${whileDisabled.result}`,
    );

    const crossings: [string, (userId: string) => Promise<unknown>, string][] = [
      ['revokeSessions', (userId) => subjects.revokeSessions(userId), 'refused:stale'],
      ['disable', (userId) => subjects.disable(userId), 'refused:disabled'],
      [
        'disable then enable',
        async (userId) => {
          const off = await subjects.disable(userId);
          return off.kind === 'done' ? subjects.enable(userId, off.generation) : off;
        },
        'refused:stale',
      ],
    ];
    await series(crossings, async ([name, change, want]) => {
      const userId = id('cx');
      const entered = Promise.withResolvers<void>();
      const release = Promise.withResolvers<void>();
      hold = async () => {
        entered.resolve();
        await release.promise;
      };
      const signing = app.signIn(userId);
      await entered.promise;
      hold = null;
      await change(userId);
      release.resolve();
      const signed = await signing;
      await app.logs.settle();
      const failed = app.logs
        .named('auth.signin.failed')
        .filter((record) => record.fields['auth.user'] === userId)
        .map((record) => `${String(record.fields['auth.via'])}:${String(record.fields['auth.reason'])}`);
      report.check(
        `${label} a sign-in whose verify was running when ${name} completed issues no session: ${want}, one record`,
        signed.result === want &&
          signed.token === null &&
          (await rows(userId)) === 0 &&
          failed.join() === `handoff:${want.slice('refused:'.length)}`,
        `${signed.result}; cookie ${signed.token === null ? 'none' : 'set'}; sessions ${await rows(userId)}; records ${failed.join()}`,
      );
    });
  } finally {
    await app.close();
    await rig.dispose();
  }
}

try {
  await series(rigKinds, async (kind) => {
    await report.run(`[${kind}] enable deletes planted sessions`, () => enableDeletes(kind));
    await report.run(`[${kind}] public credential changes`, () => publicCases(kind));
  });
} finally {
  await cleanAll();
}
report.finish();
