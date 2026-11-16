// Does:  Proves expiry while blocked, concurrent winners, cancellation and abandoned writes on both adapters.
// Holds: Each case is judged from the answers and from a direct read of the database afterwards.

import { randomBytes } from 'node:crypto';
import { createPostgresStore } from '@skeld/auth/postgres';
import {
  cleanAll,
  createReport,
  failureCode,
  fresh,
  isFailure,
  type Kind,
  makeRig,
  type Rig,
  rigKinds,
  type Settled,
  settle,
  show,
  sleepMs,
} from './support-store.ts';

const statement =
  'on SQLite and PostgreSQL an expiry that passes while a call waits for a lock is judged expired; concurrent consume, rotate, revoke, issue and charge leave exactly the winners the rows allow; a signal that aborts after the statement was sent ends nothing; an abandoned write applies once or not at all';
const report = createReport('s05', 'store-races', statement);
const user = (tag: string): string => `${tag}-${randomBytes(6).toString('hex')}`;
const holdFor: Record<Kind, number> = { sqlite: 300, postgres: 1500 };
const ttlFor: Record<Kind, number> = { sqlite: 150, postgres: 600 };

async function issue(
  rig: Rig,
  userId: string,
  idleMs: number,
  absoluteMs: number,
): Promise<{ digest: Uint8Array; expiresAt: number }> {
  await rig.store.ops.subjectEnsure({ userId });
  const digest = fresh();
  const result = await rig.store.ops.sessionIssue({
    userId,
    generation: 1,
    digest,
    replaces: null,
    idleMs,
    absoluteMs,
  });
  if (result.kind !== 'done') {
    throw new Error(`sessionIssue answered ${result.kind}`);
  }
  return { digest, expiresAt: result.expiresAt };
}

interface Blocked<T> {
  readonly outcome: Awaited<ReturnType<typeof settle<T>>>;
  readonly callAt: number;
  readonly elapsed: number;
}

// Does:  Takes the row's lock, starts the call at once and returns when the call settles, with when it started.
async function blocked<T>(
  rig: Rig,
  table: Parameters<Rig['hold']>[0],
  key: Parameters<Rig['hold']>[1],
  call: () => Promise<T>,
): Promise<Blocked<T>> {
  await rig.hold(table, key, holdFor[rig.kind]);
  const callAt = Date.now();
  const began = performance.now();
  const outcome = await settle(call());
  return { outcome, callAt, elapsed: Math.round(performance.now() - began) };
}

async function expiryWhileBlocked(rig: Rig): Promise<void> {
  const { ops } = rig.store;
  const label = `[${rig.kind}]`;
  const ttl = ttlFor[rig.kind];
  const waited = holdFor[rig.kind] / 2;

  const renew = await issue(rig, user('renew'), ttl, 60_000);
  const renewCall = await blocked(rig, 'sessions', renew.digest, () =>
    ops.sessionRenew({ digest: renew.digest, idleMs: 60_000 }),
  );
  const renewed = renewCall.outcome;
  report.check(
    `${label} sessionRenew: live at the call, expired while it waited for the row lock`,
    renewCall.callAt < renew.expiresAt &&
      renewed.ok &&
      renewed.value.kind === 'lost' &&
      renewed.value.reason === 'gone' &&
      renewed.value.now >= renew.expiresAt &&
      renewCall.elapsed >= waited,
    `called at +${renewCall.callAt - (renew.expiresAt - ttl)} ms of a ${ttl} ms session, answered ${show(renewed)} judged at +${renewed.ok ? renewed.value.now - (renew.expiresAt - ttl) : '?'} ms after ${renewCall.elapsed} ms`,
  );
  const control = await issue(rig, user('renew-ok'), ttl, 60_000);
  const controlRenew = await settle(ops.sessionRenew({ digest: control.digest, idleMs: 60_000 }));
  report.check(
    `${label} sessionRenew: the same call with no lock held renews (control)`,
    controlRenew.ok && controlRenew.value.kind === 'done',
    show(controlRenew),
  );

  const rotateUser = user('rotate');
  const rotate = await issue(rig, rotateUser, ttl, 60_000);
  const next = fresh();
  const rotateCall = await blocked(rig, 'sessions', rotate.digest, () =>
    ops.sessionRotate({ userId: rotateUser, digest: rotate.digest, next, idleMs: 60_000 }),
  );
  const rotated = rotateCall.outcome;
  report.check(
    `${label} sessionRotate: expired while it waited, answers gone and creates no successor`,
    rotateCall.callAt < rotate.expiresAt &&
      rotated.ok &&
      rotated.value.kind === 'lost' &&
      rotated.value.now >= rotate.expiresAt &&
      !(await rig.exists('sessions', next)) &&
      rotateCall.elapsed >= waited,
    `${show(rotated)} after ${rotateCall.elapsed} ms; successor row ${(await rig.exists('sessions', next)) ? 'present' : 'absent'}`,
  );
  const controlUser = user('rotate-ok');
  const controlRotate = await issue(rig, controlUser, ttl, 60_000);
  const controlNext = await settle(
    ops.sessionRotate({ userId: controlUser, digest: controlRotate.digest, next: fresh(), idleMs: 60_000 }),
  );
  report.check(
    `${label} sessionRotate: the same call with no lock held rotates (control)`,
    controlNext.ok && controlNext.value.kind === 'done',
    show(controlNext),
  );

  const state = fresh();
  const binding = fresh();
  const created = await ops.attemptCreate({
    state,
    binding,
    provider: 'gh',
    nonce: 'n',
    verifier: 'v',
    returnPath: '/',
    ttlMs: ttl,
  });
  const consumeCall = await blocked(rig, 'oidc_attempts', state, () =>
    ops.attemptConsume({ state, binding, provider: 'gh' }),
  );
  const consumed = consumeCall.outcome;
  report.check(
    `${label} attemptConsume: expired while it waited, answers gone and leaves the row for cleanup`,
    consumeCall.callAt < created.expiresAt &&
      consumed.ok &&
      consumed.value.kind === 'lost' &&
      consumed.value.reason === 'gone' &&
      consumed.value.now >= created.expiresAt &&
      (await rig.exists('oidc_attempts', state)),
    `${show(consumed)} after ${consumeCall.elapsed} ms; row ${(await rig.exists('oidc_attempts', state)) ? 'left' : 'deleted'}`,
  );
  const controlState = fresh();
  await ops.attemptCreate({
    state: controlState,
    binding,
    provider: 'gh',
    nonce: 'n',
    verifier: 'v',
    returnPath: '/',
    ttlMs: ttl,
  });
  const controlConsume = await settle(ops.attemptConsume({ state: controlState, binding, provider: 'gh' }));
  report.check(
    `${label} attemptConsume: the same call with no lock held consumes (control)`,
    controlConsume.ok && controlConsume.value.kind === 'done',
    show(controlConsume),
  );

  const key = fresh();
  const first = await ops.limitCharge({ key, max: 1, windowMs: ttl });
  if (first.kind !== 'done') {
    throw new Error('the first charge was refused');
  }
  const chargeCall = await blocked(rig, 'limit_windows', key, () => ops.limitCharge({ key, max: 1, windowMs: ttl }));
  const charged = chargeCall.outcome;
  report.check(
    `${label} limitCharge: the full window expired while it waited, so the charge opens a new window at count 1`,
    chargeCall.callAt < first.resetAt &&
      charged.ok &&
      charged.value.kind === 'done' &&
      charged.value.count === 1 &&
      charged.value.now >= first.resetAt &&
      chargeCall.elapsed >= waited,
    `${show(charged)}${charged.ok && charged.value.kind === 'done' ? ` count ${charged.value.count}` : ''} after ${chargeCall.elapsed} ms`,
  );
  const controlKey = fresh();
  await ops.limitCharge({ key: controlKey, max: 1, windowMs: 60_000 });
  const controlCharge = await settle(ops.limitCharge({ key: controlKey, max: 1, windowMs: 60_000 }));
  report.check(
    `${label} limitCharge: the same second charge inside a live window is refused (control)`,
    controlCharge.ok && controlCharge.value.kind === 'lost',
    show(controlCharge),
  );

  const keyUser = user('keys');
  const issued = await ops.apiKeyIssue({
    userId: keyUser,
    keyId: user('k1'),
    digest: fresh(),
    name: 'a',
    scopes: ['p:a'],
    expiresInMs: ttl,
    max: 1,
  });
  const keyCall = await blocked(rig, 'subjects', keyUser, () =>
    ops.apiKeyIssue({
      userId: keyUser,
      keyId: user('k2'),
      digest: fresh(),
      name: 'b',
      scopes: ['p:a'],
      expiresInMs: null,
      max: 1,
    }),
  );
  const keyed = keyCall.outcome;
  report.check(
    `${label} apiKeyIssue: the one key expired while the second issue waited, so the limit of 1 no longer holds it back`,
    issued.kind === 'done' &&
      issued.expiresAt !== null &&
      keyCall.callAt < issued.expiresAt &&
      keyed.ok &&
      keyed.value.kind === 'done' &&
      keyCall.elapsed >= waited,
    `${show(keyed)} after ${keyCall.elapsed} ms`,
  );
  const controlKeyUser = user('keys-ok');
  await ops.apiKeyIssue({
    userId: controlKeyUser,
    keyId: user('k3'),
    digest: fresh(),
    name: 'a',
    scopes: ['p:a'],
    expiresInMs: 60_000,
    max: 1,
  });
  const controlKeyed = await settle(
    ops.apiKeyIssue({
      userId: controlKeyUser,
      keyId: user('k4'),
      digest: fresh(),
      name: 'b',
      scopes: ['p:a'],
      expiresInMs: null,
      max: 1,
    }),
  );
  report.check(
    `${label} apiKeyIssue: the same second issue with a live key is refused (control)`,
    controlKeyed.ok && controlKeyed.value.kind === 'lost',
    show(controlKeyed),
  );
}

async function winners(rig: Rig): Promise<void> {
  const { ops } = rig.store;
  const label = `[${rig.kind}]`;

  const rotateUser = user('rot20');
  const original = await issue(rig, rotateUser, 60_000, 60_000);
  const nexts = Array.from({ length: 20 }, () => fresh());
  const rotations = await Promise.all(
    nexts.map((next) =>
      settle(ops.sessionRotate({ userId: rotateUser, digest: original.digest, next, idleMs: 60_000 })),
    ),
  );
  const done = rotations.flatMap((r, i) => (r.ok && r.value.kind === 'done' ? [i] : []));
  const lost = rotations.filter((r) => r.ok && r.value.kind === 'lost' && r.value.reason === 'gone').length;
  const present = await Promise.all(nexts.map((next) => rig.exists('sessions', next)));
  report.check(
    `${label} 20 concurrent sessionRotate of one session: exactly one done, nineteen gone, one successor row`,
    done.length === 1 &&
      lost === 19 &&
      present.filter(Boolean).length === 1 &&
      present[done[0] ?? -1] === true &&
      !(await rig.exists('sessions', original.digest)),
    `done ${done.length}, gone ${lost}, successor rows ${present.filter(Boolean).length}, old row ${(await rig.exists('sessions', original.digest)) ? 'present' : 'absent'}`,
  );

  let bad = 0;
  let rotatedWins = 0;
  let revokedWins = 0;
  for (let trial = 0; trial < 12; trial += 1) {
    const raceUser = user('race');
    // biome-ignore lint/performance/noAwaitInLoops: each trial needs its own session before the race starts
    const target = await issue(rig, raceUser, 60_000, 60_000);
    const successors = Array.from({ length: 10 }, () => fresh());
    const rotating: Promise<Settled<{ readonly kind: string }>>[] = [];
    const revoking: Promise<Settled<{ readonly revoked: boolean }>>[] = [];
    const startRotates = (): void => {
      for (const next of successors) {
        rotating.push(settle(ops.sessionRotate({ userId: raceUser, digest: target.digest, next, idleMs: 60_000 })));
      }
    };
    const startRevokes = (): void => {
      for (let caller = 0; caller < 10; caller += 1) {
        revoking.push(settle(ops.sessionRevoke({ digest: target.digest })));
      }
    };
    // Why: PostgreSQL rotates in more round trips than it revokes; the head start lets a rotate reach the row first.
    if (trial % 3 === 0) {
      startRotates();
      await sleepMs(8);
      startRevokes();
    } else if (trial % 3 === 1) {
      startRevokes();
      startRotates();
    } else {
      startRotates();
      startRevokes();
    }
    const rotateDone = (await Promise.all(rotating)).filter((r) => r.ok && r.value.kind === 'done').length;
    const revokeDone = (await Promise.all(revoking)).filter((r) => r.ok && r.value.revoked).length;
    const rows = await rig.count('sessions', 'user_id', raceUser);
    if (!(rotateDone + revokeDone === 1 && rows === rotateDone && !(await rig.exists('sessions', target.digest)))) {
      bad += 1;
    }
    rotatedWins += rotateDone;
    revokedWins += revokeDone;
  }
  report.check(
    `${label} sessionRotate against sessionRevoke on one session (12 trials of 10 and 10): exactly one caller deletes the row, and a successor exists only when a rotate won`,
    bad === 0,
    `${bad} bad trials; rotate won ${rotatedWins}, revoke won ${revokedWins}`,
  );
}

async function singleUse(rig: Rig): Promise<void> {
  const { ops } = rig.store;
  const label = `[${rig.kind}]`;
  const state = fresh();
  const binding = fresh();
  await ops.attemptCreate({
    state,
    binding,
    provider: 'gh',
    nonce: 'the-nonce',
    verifier: 'the-verifier',
    returnPath: '/x',
    ttlMs: 60_000,
  });
  const consumes = await Promise.all(
    Array.from({ length: 20 }, () => settle(ops.attemptConsume({ state, binding, provider: 'gh' }))),
  );
  const consumed = consumes.filter((r) => r.ok && r.value.kind === 'done');
  const gone = consumes.filter((r) => r.ok && r.value.kind === 'lost' && r.value.reason === 'gone').length;
  const first = consumed[0];
  report.check(
    `${label} 20 concurrent attemptConsume of one attempt: exactly one done with its values, nineteen gone, row deleted`,
    consumed.length === 1 &&
      gone === 19 &&
      first?.ok === true &&
      first.value.kind === 'done' &&
      first.value.nonce === 'the-nonce' &&
      !(await rig.exists('oidc_attempts', state)),
    `done ${consumed.length}, gone ${gone}`,
  );

  const keyUser = user('cap');
  await ops.subjectEnsure({ userId: keyUser });
  const issues = await Promise.all(
    Array.from({ length: 20 }, (_, i) =>
      settle(
        ops.apiKeyIssue({
          userId: keyUser,
          keyId: `k${i}-${randomBytes(6).toString('hex')}`,
          digest: fresh(),
          name: 'n',
          scopes: ['p:a'],
          expiresInMs: null,
          max: 5,
        }),
      ),
    ),
  );
  const issuedDone = issues.filter((r) => r.ok && r.value.kind === 'done').length;
  const issuedLimit = issues.filter((r) => r.ok && r.value.kind === 'lost' && r.value.reason === 'limit').length;
  report.check(
    `${label} 20 concurrent apiKeyIssue with max 5: exactly 5 done, 15 limit, 5 rows`,
    issuedDone === 5 && issuedLimit === 15 && (await rig.count('api_keys', 'user_id', keyUser)) === 5,
    `done ${issuedDone}, limit ${issuedLimit}, rows ${await rig.count('api_keys', 'user_id', keyUser)}`,
  );

  const limitKey = fresh();
  const charges = await Promise.all(
    Array.from({ length: 20 }, () => settle(ops.limitCharge({ key: limitKey, max: 5, windowMs: 60_000 }))),
  );
  const counts = charges.flatMap((r) => (r.ok && r.value.kind === 'done' ? [r.value.count] : [])).sort();
  const refused = charges.flatMap((r) => (r.ok && r.value.kind === 'lost' ? [r.value.retryAfterMs] : []));
  report.check(
    `${label} 20 concurrent limitCharge with max 5: counts 1 to 5 once each, 15 refused with retryAfterMs of at least 1, stored count 5`,
    JSON.stringify(counts) === '[1,2,3,4,5]' &&
      refused.length === 15 &&
      refused.every((ms) => ms >= 1) &&
      (await rig.value('limit_windows', limitKey, 'count')) === 5,
    `counts ${counts.join(',')}; refused ${refused.length}; stored ${await rig.value('limit_windows', limitKey, 'count')}`,
  );

  const revokeUser = user('keyrev');
  const keyId = user('kr');
  await ops.apiKeyIssue({
    userId: revokeUser,
    keyId,
    digest: fresh(),
    name: 'n',
    scopes: ['p:a'],
    expiresInMs: null,
    max: 5,
  });
  const revokes = await Promise.all(
    Array.from({ length: 10 }, () => settle(ops.apiKeyRevoke({ userId: revokeUser, keyId }))),
  );
  const revoked = revokes.filter((r) => r.ok && r.value.revoked).length;
  report.check(
    `${label} 10 concurrent apiKeyRevoke of one key: exactly one revoked, row gone`,
    revoked === 1 && !(await rig.exists('api_keys', keyId)),
    `revoked ${revoked}`,
  );
}

async function fenceRaces(rig: Rig): Promise<void> {
  const { ops } = rig.store;
  const label = `[${rig.kind}]`;
  for (const change of ['subjectInvalidate', 'subjectDisable'] as const) {
    let badTrials = 0;
    let issuedBefore = 0;
    for (let trial = 0; trial < 12; trial += 1) {
      const fenceUser = user('fence');
      // biome-ignore lint/performance/noAwaitInLoops: each trial needs its own subject before the race starts
      await ops.subjectEnsure({ userId: fenceUser });
      const issuing: Promise<Settled<{ readonly kind: string }>>[] = [];
      const changing: Promise<Settled<{ readonly revoked: number }>>[] = [];
      const issueOne = (): void =>
        void issuing.push(
          settle(
            ops.sessionIssue({
              userId: fenceUser,
              generation: 1,
              digest: fresh(),
              replaces: null,
              idleMs: 60_000,
              absoluteMs: 60_000,
            }),
          ),
        );
      const changeOne = (): void => void changing.push(settle(ops[change]({ userId: fenceUser })));
      // Why: Starting the change first in odd trials lets it reach the subject row before the issues.
      const order =
        trial % 2 === 0
          ? [issueOne, issueOne, changeOne, issueOne, issueOne, issueOne]
          : [changeOne, issueOne, issueOne, issueOne, issueOne, issueOne];
      for (const start of order) {
        start();
      }
      const issuedOk = (await Promise.all(issuing)).filter((r) => r.ok && r.value.kind === 'done').length;
      const changed = (await Promise.all(changing))[0];
      const revokedByChange = changed?.ok ? changed.value.revoked : -1;
      const survivors = await rig.count('sessions', 'user_id', fenceUser);
      if (survivors !== 0 || revokedByChange !== issuedOk) {
        badTrials += 1;
      }
      issuedBefore += issuedOk;
    }
    report.check(
      `${label} sessionIssue (5 callers) against ${change} on one subject, 12 trials: no session survives and the change revokes exactly the sessions issued before it`,
      badTrials === 0,
      `${badTrials} bad trials; ${issuedBefore} sessions issued before the change across the trials`,
    );
  }
}

async function cancellation(rig: Rig): Promise<void> {
  const { ops } = rig.store;
  const label = `[${rig.kind}]`;

  const before = await issue(rig, user('cancel-before'), 60_000, 60_000);
  const early = new AbortController();
  early.abort();
  const refusedEarly = await settle(ops.sessionRevoke({ digest: before.digest }, early.signal));
  report.check(
    `${label} a signal aborted before the call: rejected aborted, applied no, the row stands`,
    isFailure(refusedEarly, 'aborted', 'no') && (await rig.exists('sessions', before.digest)),
    `${show(refusedEarly)}; row ${(await rig.exists('sessions', before.digest)) ? 'stands' : 'deleted'}`,
  );

  let aborted = 0;
  let completed = 0;
  let inconsistent = 0;
  for (let trial = 0; trial < 30; trial += 1) {
    // biome-ignore lint/performance/noAwaitInLoops: each trial is a separate session and abort timing
    const target = await issue(rig, user('cancel-race'), 60_000, 60_000);
    const controller = new AbortController();
    const call = settle(ops.sessionRevoke({ digest: target.digest }, controller.signal));
    if (trial % 3 === 1) {
      await Promise.resolve();
    } else if (trial % 3 === 2) {
      await new Promise((resolve) => setImmediate(resolve));
    }
    controller.abort();
    const result = await call;
    const stands = await rig.exists('sessions', target.digest);
    if (isFailure(result, 'aborted', 'no') && stands) {
      aborted += 1;
    } else if (result.ok && result.value.kind === 'done' && result.value.revoked && !stands) {
      completed += 1;
    } else {
      inconsistent += 1;
    }
  }
  report.check(
    `${label} a signal aborted at once after the call (30 trials): the report always agrees with the database`,
    inconsistent === 0,
    `${aborted} rejected aborted with the row standing, ${completed} done with the row deleted, ${inconsistent} inconsistent`,
  );

  const slow = await issue(rig, user('cancel-after'), 60_000, 60_000);
  const controller = new AbortController();
  const hold = holdFor[rig.kind];
  await rig.hold('sessions', slow.digest, hold);
  const began = performance.now();
  const call = settle(ops.sessionRevoke({ digest: slow.digest }, controller.signal));
  await sleepMs(Math.min(150, hold / 2));
  controller.abort();
  const result = await call;
  const elapsed = Math.round(performance.now() - began);
  const stands = await rig.exists('sessions', slow.digest);
  if (rig.kind === 'postgres') {
    report.check(
      '[postgres] a signal aborted while the statement waits on a row lock (sent, in flight) ends nothing: the unit finishes by its own rules and deletes the row',
      result.ok && result.value.kind === 'done' && result.value.revoked && !stands && elapsed >= hold * 0.8,
      `${show(result)} after ${elapsed} ms of a ${hold} ms lock; row ${stands ? 'stands' : 'deleted'}`,
    );
  } else {
    report.check(
      '[sqlite] a signal aborted while the unit waits out busy retries (BEGIN IMMEDIATE refused, nothing began): rejected aborted, applied no, the row stands',
      isFailure(result, 'aborted', 'no') && stands,
      `${show(result)} after ${elapsed} ms of a ${hold} ms lock; row ${stands ? 'stands' : 'deleted'}`,
    );
    const ran = await issue(rig, user('cancel-after-sync'), 60_000, 60_000);
    const late = new AbortController();
    const call2 = settle(ops.sessionRevoke({ digest: ran.digest }, late.signal));
    late.abort();
    const result2 = await call2;
    report.check(
      '[sqlite] a signal aborted after the synchronous unit already ran ends nothing: done, the row is deleted',
      result2.ok &&
        result2.value.kind === 'done' &&
        result2.value.revoked &&
        !(await rig.exists('sessions', ran.digest)),
      show(result2),
    );
  }
}

async function abandoned(rig: Rig): Promise<void> {
  const { ops } = rig.store;
  const label = `[${rig.kind}]`;
  const hold = holdFor[rig.kind];

  const walkUser = user('walk');
  await ops.subjectEnsure({ userId: walkUser });
  const digest = fresh();
  await rig.hold('subjects', walkUser, hold);
  const tracked = settle(
    ops.sessionIssue({ userId: walkUser, generation: 1, digest, replaces: null, idleMs: 60_000, absoluteMs: 60_000 }),
  );
  const rowsWhileBlocked = await rig.count('sessions', 'user_id', walkUser);
  const answer = await tracked;
  await sleepMs(hold / 2);
  report.check(
    `${label} a write whose caller walked away (nobody awaits it, no signal) is blocked while the lock is held, then applies exactly once`,
    rowsWhileBlocked === 0 &&
      answer.ok &&
      answer.value.kind === 'done' &&
      (await rig.count('sessions', 'user_id', walkUser)) === 1 &&
      (await rig.exists('sessions', digest)),
    `rows while blocked ${rowsWhileBlocked}; unit later answered ${show(answer)}; rows afterwards ${await rig.count('sessions', 'user_id', walkUser)}`,
  );

  if (rig.kind === 'sqlite') {
    const target = await issue(rig, user('outlast'), 60_000, 60_000);
    await rig.hold('sessions', target.digest, 1500);
    const began = performance.now();
    const refused = await settle(ops.sessionRevoke({ digest: target.digest }));
    const elapsed = Math.round(performance.now() - began);
    await sleepMs(1500);
    report.check(
      '[sqlite] a write that outlasts the retry schedule is abandoned by the store: unavailable, applied no, and the row stands after the lock is gone',
      isFailure(refused, 'unavailable', 'no') &&
        (await rig.exists('sessions', target.digest)) &&
        elapsed >= 501 &&
        elapsed <= 661,
      `${show(refused)} after ${elapsed} ms (schedule 511 ms, accepted 501 to 661 ms); row ${(await rig.exists('sessions', target.digest)) ? 'stands' : 'deleted'}`,
    );
    return;
  }
  await deadlineAbandon(rig);
}

async function activeBackends(rig: Rig): Promise<number> {
  const rows = await rig.query(
    "SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname = current_database() AND application_name = 'proof-abandon' AND state <> 'idle'",
  );
  return Number(rows[0]?.n);
}

// Does:  Makes a PostgreSQL unit hit its 5,000 ms deadline with its lock statement in flight and reads what remains.
async function deadlineAbandon(rig: Rig): Promise<void> {
  const database = rig.database;
  if (database === null) {
    throw new Error('PostgreSQL rig without a database');
  }
  const pool = database.pool({ max: 2, application: 'proof-abandon' });
  const store = createPostgresStore({ pool, maxClients: 2, cleanupIntervalSeconds: 3600 });
  await store.attach({ onFailure: () => undefined });
  const target = await issue(rig, user('deadline'), 60_000, 60_000);
  await rig.hold('sessions', target.digest, 7500);
  const taken = [await pool.connect(), await pool.connect()];
  const began = performance.now();
  const call = settle(store.ops.sessionRevoke({ digest: target.digest }));
  await sleepMs(2500);
  for (const client of taken) {
    client.release();
  }
  const result = await call;
  const elapsed = Math.round(performance.now() - began);
  await sleepMs(250);
  const interim = await activeBackends(rig);
  await sleepMs(7500 - elapsed + 500);
  const finalBackends = await activeBackends(rig);
  report.check(
    '[postgres] a write abandoned at the 5,000 ms deadline with its lock statement in flight (COMMIT never sent): unavailable, applied no, no backend left running it, and the row stands after the lock is released',
    isFailure(result, 'unavailable', 'no') &&
      failureCode(result) === null &&
      elapsed >= 4990 &&
      elapsed <= 5500 &&
      finalBackends === 0 &&
      (await rig.exists('sessions', target.digest)),
    `${show(result)} after ${elapsed} ms (deadline 5,000 ms, accepted 4,990 to 5,500 ms); backends still running a statement: ${interim} at the failure (its lock_timeout was still counting), ${finalBackends} after it; row ${(await rig.exists('sessions', target.digest)) ? 'stands' : 'deleted'}`,
  );
  await store.close();
  await pool.end();
}

for (const kind of rigKinds) {
  report.note(`== ${kind}`);
  // biome-ignore lint/performance/noAwaitInLoops: one adapter at a time; its locks never meet the other's
  const rig = await makeRig(kind);
  try {
    for (const [name, body] of [
      ['expiry while blocked', expiryWhileBlocked],
      ['concurrent session winners', winners],
      ['single-use, cap and charge winners', singleUse],
      ['fence against issue', fenceRaces],
      ['cancellation', cancellation],
      ['abandoned writes', abandoned],
    ] as const) {
      // biome-ignore lint/performance/noAwaitInLoops: the groups share one rig and one lock holder at a time
      await report.run(`[${kind}] ${name}`, () => body(rig));
    }
    report.check(
      `[${kind}] no store failure reached onFailure for an operation its caller received`,
      rig.events.every((event) => event.operation === 'pool'),
      `${rig.events.length} events: ${rig.events.map((event) => event.operation).join(',')}`,
    );
  } finally {
    await rig.dispose();
  }
}
await cleanAll();
report.finish();
