// Does:  Proves conditional enable and the credential change on both adapters: race, interruptions, stale enable.
// Holds: Cases are judged from subject answers, real HTTP statuses and direct database reads, never from timing.

import { exhaustive } from '../support/test-profile.ts';
import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { createServer as createNetServer } from 'node:net';
import { setImmediate as nextTurn } from 'node:timers/promises';
import { hashPassword, verifyPassword } from '@skeld/auth/password';
import { sessionRoutes } from '@skeld/auth/routes';
import { createAuth, type Subjects } from '@skeld/auth/server';
import { StoreFailure } from '@skeld/auth/store';
import { defineContract, errorBodySchema } from '@skeld/core/contract';
import { object, string } from '@skeld/core/schema';
import { Secret } from '@skeld/core/secret';
import { createServer } from '@skeld/core/server';
import { createLogs, type Logs, type Observed, observe, series } from './rig/v1-app.ts';
import { createReport } from './rig/v1-report.ts';
import { cleanAll, fresh, type Kind, makeRig, type Rig, rigKinds } from './support-store.ts';

const statement =
  'enable(userId, expectedGeneration) enables only a subject disabled at exactly that generation and ends its sessions in the same unit; with the application serialising per user a credential change and a reconciliation never admit an old-password session, without it the change stops at a refused enable and a reconciliation that revokes closes the session; every interruption fails closed; a moved generation stops the change and a reconciliation enables at the generation it read';
const report = createReport('v03', statement);

const RUNS = exhaustive ? 10 : 1;
const COOKIE = '__Host-skeld';

const routes = defineContract({
  login: {
    method: 'POST',
    path: '/login',
    access: 'public',
    body: object({
      username: string({ minLength: 1, maxLength: 64 }),
      password: string({ minLength: 1, maxLength: 1024, sensitivity: 'secret' }),
    }),
    responses: { 200: object({ status: string({ maxLength: 16 }) }), 401: errorBodySchema },
  },
  me: {
    method: 'GET',
    path: '/me',
    access: { policy: 'auth.session', action: 'use' },
    responses: { 200: object({ userId: string({ maxLength: 128 }) }) },
  },
});

type Answer = Awaited<ReturnType<Subjects[keyof Subjects]>>;

// Does:  Names an answer of a subject call without its engine text.
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

// Does:  Is the application's own per-user serialization: one holder at a time, later callers wait their turn.
class Locks {
  readonly #tails = new Map<string, Promise<void>>();

  async run<T>(userId: string, work: () => Promise<T>): Promise<T> {
    const previous = this.#tails.get(userId) ?? Promise.resolve();
    const { promise: released, resolve: release } = Promise.withResolvers<void>();
    const tail = previous.then(() => released);
    this.#tails.set(userId, tail);
    await previous;
    try {
      return await work();
    } finally {
      release();
      if (this.#tails.get(userId) === tail) {
        this.#tails.delete(userId);
      }
    }
  }
}

class Crash extends Error {
  constructor() {
    super('the process ended here');
  }
}

// Does:  Orders every call a scenario makes, so a proof can say which came first.
class Trace {
  readonly lines: string[] = [];
  add(actor: string, text: string): void {
    this.lines.push(`${actor} ${text}`);
  }
  first(text: string): number {
    return this.lines.findIndex((line) => line.includes(text));
  }
  count(text: string): number {
    return this.lines.filter((line) => line.includes(text)).length;
  }
}

interface Env {
  readonly kind: Kind;
  readonly rig: Rig;
  readonly observed: Observed;
  readonly logs: Logs;
  readonly origin: string;
  readonly subjects: Subjects;
  readonly sessions: ReturnType<typeof createAuth>['sessions'];
  readonly accounts: Map<string, string>;
  readonly close: () => Promise<void>;
}

async function freePort(): Promise<number> {
  const probe = createNetServer().listen(0, '127.0.0.1');
  await once(probe, 'listening');
  const address = probe.address();
  probe.close();
  if (address === null || typeof address === 'string') {
    throw new Error('no local port');
  }
  return address.port;
}

// Does:  Boots a real createAuth on a real core server over the rig's store, with the application's own account map.
async function startEnv(kind: Kind): Promise<Env> {
  const rig = await makeRig(kind, { attach: false });
  const observed = observe(rig.store);
  const logs = createLogs();
  const accounts = new Map<string, string>();
  const port = await freePort();
  const origin = `http://127.0.0.1:${port}`;
  const auth = createAuth({ store: observed.store, origin });
  const server = createServer({
    gate: auth.gate,
    publicOrigin: origin,
    csrf: { mode: 'strict' },
    log: { thresholds: { security: 'info', app: 'info' }, sink: logs.sink },
  });
  server.routes(sessionRoutes, auth.handlers.session);
  server.routes(routes, {
    login: async (request) => {
      const { username, password } = request.body;
      const established = await auth.sessions.establish({
        rawCookies: request.rawCookies,
        userId: username,
        // Why: The handoff's obligation is that verify reads the stored hash inside the call.
        verify: async (signal) => {
          const stored = accounts.get(username);
          if (stored === undefined) {
            return false;
          }
          return (await verifyPassword(password, stored, { signal })).kind === 'match';
        },
      });
      if (established.kind === 'established') {
        return { status: 200, body: { status: 'session' }, cookies: established.cookies };
      }
      return { status: 401, body: { status: 401, code: 'LOGIN_FAILED', message: 'Sign-in refused' } };
    },
    me: (request) => ({
      status: 200,
      body: { userId: request.principal.kind === 'session' ? request.principal.userId : 'not-a-session' },
    }),
  });
  await server.listen({ port, host: '127.0.0.1' });
  return {
    kind,
    rig,
    observed,
    logs,
    origin,
    subjects: auth.subjects,
    sessions: auth.sessions,
    accounts,
    close: async () => {
      await server.close();
      await rig.dispose();
    },
  };
}

interface Person {
  readonly id: string;
  readonly oldPassword: string;
  readonly newPassword: string;
  readonly hash: string;
}

async function newPerson(env: Env, tag: string): Promise<Person> {
  const id = `${tag}-${randomBytes(5).toString('hex')}`;
  const oldPassword = `old-${randomBytes(12).toString('base64url')}`;
  const newPassword = `new-${randomBytes(12).toString('base64url')}`;
  const hashed = await hashPassword(new Secret(oldPassword));
  if (hashed.kind !== 'hashed') {
    throw new Error(`hash answered ${hashed.kind}`);
  }
  env.accounts.set(id, hashed.hash);
  return { id, oldPassword, newPassword, hash: hashed.hash };
}

async function signIn(env: Env, id: string, password: string): Promise<{ status: number; cookie: string | null }> {
  const response = await fetch(`${env.origin}/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: env.origin },
    body: JSON.stringify({ username: id, password }),
    redirect: 'manual',
  });
  await response.text();
  let cookie: string | null = null;
  for (const line of response.headers.getSetCookie()) {
    const pair = line.split(';')[0] ?? '';
    if (pair.startsWith(`${COOKIE}=`)) {
      cookie = pair;
    }
  }
  return { status: response.status, cookie };
}

async function admitted(env: Env, cookie: string | null): Promise<number | string> {
  if (cookie === null) {
    return 'no session';
  }
  const response = await fetch(`${env.origin}/me`, { headers: { cookie }, redirect: 'manual' });
  await response.text();
  return response.status;
}

// Does:  Says which of the two passwords sign in, by the status of one sign-in each.
async function signIns(env: Env, person: Person): Promise<string> {
  const old = await signIn(env, person.id, person.oldPassword);
  const next = await signIn(env, person.id, person.newPassword);
  return `old=${old.status} new=${next.status}`;
}

function traced(
  env: Env,
  actor: string,
  trace: Trace,
): Pick<Subjects, 'read' | 'disable' | 'enable' | 'revokeSessions'> {
  const note = (text: string, answer: Answer): void => trace.add(actor, `${text} -> ${show(answer)}`);
  return {
    read: async (id) => {
      const answer = await env.subjects.read(id);
      note('subjects.read', answer);
      return answer;
    },
    disable: async (id) => {
      const answer = await env.subjects.disable(id);
      note('subjects.disable', answer);
      return answer;
    },
    enable: async (id, generation) => {
      const answer = await env.subjects.enable(id, generation);
      note(`subjects.enable(${generation})`, answer);
      return answer;
    },
    revokeSessions: async (id) => {
      const answer = await env.subjects.revokeSessions(id);
      note('subjects.revokeSessions', answer);
      return answer;
    },
  };
}

interface Hooks {
  readonly afterDisable?: () => Promise<void>;
  readonly write?: 'throws-unapplied' | 'throws-applied';
  readonly crashBeforeEnable?: boolean;
}

interface ChangeInput {
  readonly person: Person;
  readonly locks: Locks;
  readonly trace: Trace;
  readonly hooks?: Hooks;
}

// Does:  Writes the new hash only if the stored one is still the verified one; the hooks make the outcome unknown.
function writeHash(env: Env, input: ChangeInput, stored: string, nextHash: string): boolean {
  const { person, trace, hooks } = input;
  if (hooks?.write === 'throws-unapplied') {
    throw new Error('write outcome unknown');
  }
  const applied = env.accounts.get(person.id) === stored;
  if (applied) {
    env.accounts.set(person.id, nextHash);
  }
  trace.add('C', `write H->N -> ${applied ? 'applied' : 'not applied'}`);
  if (hooks?.write === 'throws-applied') {
    throw new Error('write outcome unknown');
  }
  return applied;
}

// Does:  Step 3 of the contract: enable at the generation step 1 answered, and read before anything else when unknown.
async function enableAfterWrite(
  subjects: ReturnType<typeof traced>,
  id: string,
  generation: number,
  written: boolean,
): Promise<string> {
  const enabled = await subjects.enable(id, generation);
  if (enabled.kind === 'done') {
    return written ? 'changed' : 'conflict';
  }
  if (enabled.kind === 'refused') {
    return `stopped:${enabled.reason}`;
  }
  if (enabled.outcome === 'not_applied') {
    return 'pending:enable';
  }
  const read = await subjects.read(id);
  return read.kind === 'subject' && read.enabled && read.generation === generation + 1 ? 'changed' : 'pending:enable';
}

// Does:  Runs the application's side of a password change as the contract's three steps under the user's lock.
function change(env: Env, input: ChangeInput): Promise<string> {
  const { person, locks, trace, hooks } = input;
  const subjects = traced(env, 'C', trace);
  return locks.run(person.id, async () => {
    const stored = env.accounts.get(person.id) ?? '';
    const checked = await verifyPassword(new Secret(person.oldPassword), stored);
    const next = await hashPassword(new Secret(person.newPassword));
    if (checked.kind !== 'match' || next.kind !== 'hashed') {
      return 'refused';
    }
    const disabled = await subjects.disable(person.id);
    if (disabled.kind === 'unavailable') {
      return disabled.outcome === 'not_applied' ? 'not_started' : 'pending:disable';
    }
    await hooks?.afterDisable?.();
    let written: boolean;
    try {
      written = writeHash(env, input, stored, next.hash);
    } catch {
      return 'pending:write';
    }
    if (hooks?.crashBeforeEnable === true) {
      throw new Crash();
    }
    return enableAfterWrite(subjects, person.id, disabled.generation, written);
  });
}

async function attempt(work: Promise<string>): Promise<string> {
  try {
    return await work;
  } catch (error) {
    return error instanceof Crash ? 'crashed' : `threw ${String(error)}`;
  }
}

// Does:  Reconciles as the contract says, under the same lock: enable at the generation read, or revoke when enabled.
function reconcile(env: Env, id: string, locks: Locks, actor: string, trace: Trace): Promise<string> {
  const subjects = traced(env, actor, trace);
  return locks.run(id, async () => {
    const subject = await subjects.read(id);
    if (subject.kind === 'unavailable') {
      return 'unavailable';
    }
    if (subject.kind === 'absent') {
      return 'absent';
    }
    if (subject.enabled) {
      return (await subjects.revokeSessions(id)).kind === 'done' ? 'revoked' : 'unavailable';
    }
    const enabled = await subjects.enable(id, subject.generation);
    return enabled.kind === 'done' ? 'enabled' : 'unavailable';
  });
}

async function turns(count: number): Promise<void> {
  await series(Array.from({ length: count }), async () => {
    await nextTurn();
  });
}

type Check = readonly [name: string, ok: boolean, detail: string];

// Does:  Collects the judged assertions of one scenario run.
class Verdicts {
  readonly items: Check[] = [];
  eq(name: string, got: string | number, want: string | number): void {
    this.items.push([name, got === want, got === want ? `${got}` : `got ${got}, want ${want}`]);
  }
  yes(name: string, ok: boolean, detail = ''): void {
    this.items.push([name, ok, detail]);
  }
}

// Does:  Reports every assertion of the first run, and for later runs one line saying whether all of them held.
function emit(label: string, runs: readonly Verdicts[]): void {
  const first = runs[0];
  if (first === undefined) {
    return;
  }
  for (const [name, ok, detail] of first.items) {
    report.check(`${label} ${name}`, ok, detail);
  }
  const rest = runs.slice(1);
  if (rest.length > 0) {
    const bad = rest.flatMap((run, index) =>
      run.items.filter(([, ok]) => !ok).map(([name, , detail]) => `run ${index + 2}: ${name} (${detail})`),
    );
    report.check(
      `${label} the other ${rest.length} runs held all ${first.items.length} assertions`,
      bad.length === 0,
      bad.slice(0, 3).join('; '),
    );
  }
}

async function sessionRows(env: Env, id: string): Promise<number> {
  return await env.rig.count('sessions', 'user_id', id);
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

async function disabledAt(env: Env, id: string): Promise<number> {
  const answer = await env.subjects.disable(id);
  if (answer.kind !== 'done') {
    throw new Error(`disable answered ${show(answer)}`);
  }
  return answer.generation;
}

// Does:  Group 1: the primitive, through the public subject calls.
async function primitive(env: Env): Promise<void> {
  const label = `[${env.kind}] primitive:`;
  const subjects = env.subjects;
  const known = `p1-${randomBytes(5).toString('hex')}`;
  const absent = await Promise.all([subjects.enable(known, 1), subjects.enable(known, 2)]);
  report.check(
    `${label} enable on an absent subject is refused absent and creates none`,
    absent.every((answer) => show(answer) === 'refused/absent') &&
      show(await subjects.read(known)) === 'absent' &&
      (await env.rig.count('subjects', 'user_id', known)) === 0,
    `${absent.map(show).join(', ')}; row count ${await env.rig.count('subjects', 'user_id', known)}`,
  );

  const id = `p2-${randomBytes(5).toString('hex')}`;
  const g = await disabledAt(env, id);
  const earlier = show(await subjects.enable(id, g - 1));
  const later = show(await subjects.enable(id, g + 1));
  const unchanged = show(await subjects.read(id));
  report.check(
    `${label} enable at g-1 and at g+1 is refused stale and changes nothing (g=${g})`,
    earlier === 'refused/stale' && later === 'refused/stale' && unchanged === `subject(enabled=false,generation=${g})`,
    `${earlier}, ${later}, then ${unchanged}`,
  );
  const exact = show(await subjects.enable(id, g));
  report.check(
    `${label} enable at g is done: enabled, generation g+1`,
    exact === `done(enabled=true,generation=${g + 1})` &&
      show(await subjects.read(id)) === `subject(enabled=true,generation=${g + 1})`,
    exact,
  );
  const again = show(await subjects.enable(id, g + 1));
  const atOld = show(await subjects.enable(id, g));
  report.check(
    `${label} enable on an enabled subject is refused enabled whatever the generation, and changes nothing`,
    again === 'refused/enabled' &&
      atOld === 'refused/enabled' &&
      show(await subjects.read(id)) === `subject(enabled=true,generation=${g + 1})`,
    `${again}, ${atOld}`,
  );

  const racing = `p3-${randomBytes(5).toString('hex')}`;
  const gRace = await disabledAt(env, racing);
  const answers = await Promise.all(Array.from({ length: 20 }, () => subjects.enable(racing, gRace)));
  const shown = answers.map(show);
  report.check(
    `${label} twenty concurrent enable(g): exactly one done, nineteen refused enabled`,
    shown.filter((text) => text.startsWith('done')).length === 1 &&
      shown.filter((text) => text === 'refused/enabled').length === 19 &&
      show(await subjects.read(racing)) === `subject(enabled=true,generation=${gRace + 1})`,
    `${shown.filter((text) => text.startsWith('done')).length} done, ${shown.filter((text) => text === 'refused/enabled').length} refused enabled`,
  );

  const holder = `p4-${randomBytes(5).toString('hex')}`;
  const gHeld = await disabledAt(env, holder);
  await plant(env.rig, holder, 2);
  const planted = await sessionRows(env, holder);
  const refusedStale = show(await subjects.enable(holder, gHeld + 1));
  const keptByRefusal = await sessionRows(env, holder);
  const ended = show(await subjects.enable(holder, gHeld));
  await env.logs.settle();
  const revokedEvents = env.logs
    .named('auth.session.revoked')
    .filter((record) => record.fields['auth.user'] === holder && record.fields['auth.cause'] === 'enable');
  const changedEvents = env.logs
    .named('auth.subject.changed')
    .filter((record) => record.fields['auth.user'] === holder && record.fields['auth.change'] === 'enabled');
  report.check(
    `${label} a refused enable leaves the sessions of a disabled subject; a done enable deletes them`,
    planted === 2 &&
      refusedStale === 'refused/stale' &&
      keptByRefusal === 2 &&
      ended.startsWith('done') &&
      (await sessionRows(env, holder)) === 0,
    `planted ${planted}, after refusal ${keptByRefusal}, after done ${await sessionRows(env, holder)}`,
  );
  report.check(
    `${label} the done enable wrote one auth.subject.changed (enabled) and one auth.session.revoked (cause enable); the refusal wrote none`,
    changedEvents.length === 1 && revokedEvents.length === 1,
    `changed ${changedEvents.length}, revoked ${revokedEvents.length}`,
  );
  const quiet = `p5-${randomBytes(5).toString('hex')}`;
  const gQuiet = await disabledAt(env, quiet);
  await subjects.enable(quiet, gQuiet);
  await env.logs.settle();
  report.check(
    `${label} an enable that ends no session writes no auth.session.revoked`,
    env.logs
      .named('auth.session.revoked')
      .filter((record) => record.fields['auth.user'] === quiet && record.fields['auth.cause'] === 'enable').length ===
      0 &&
      env.logs
        .named('auth.subject.changed')
        .filter((record) => record.fields['auth.user'] === quiet && record.fields['auth.change'] === 'enabled')
        .length === 1,
  );
}

// Does:  Group 1: the store unit under the public call, whose answer counts the sessions an enable deletes.
async function unit(kind: Kind): Promise<void> {
  const label = `[${kind}] store unit:`;
  const rig = await makeRig(kind);
  try {
    const userId = `u1-${randomBytes(5).toString('hex')}`;
    const disabled = await rig.store.ops.subjectDisable({ userId });
    await plant(rig, userId, 3);
    const stale = await rig.store.ops.subjectEnable({ userId, generation: disabled.generation + 1 });
    const kept = await rig.count('sessions', 'user_id', userId);
    const done = await rig.store.ops.subjectEnable({ userId, generation: disabled.generation });
    report.check(
      `${label} subjectEnable at the disabled generation answers done with revoked 3 and the generation one higher; at another generation it answers lost stale and deletes nothing`,
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

// Does:  Group 2: the change and the reconciliation hold their own locks, so nothing serialises them.
async function withoutSerialization(env: Env): Promise<Verdicts> {
  const out = new Verdicts();
  const trace = new Trace();
  const person = await newPerson(env, 'g2');
  const paused = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const changeDone = attempt(
    change(env, {
      person,
      locks: new Locks(),
      trace,
      hooks: {
        afterDisable: async () => {
          paused.resolve();
          await release.promise;
        },
      },
    }),
  );
  await paused.promise;
  const reconciled = await reconcile(env, person.id, new Locks(), 'R', trace);
  out.eq('the reconciliation, holding no common lock, enables at the generation it read', reconciled, 'enabled');
  const early = await signIn(env, person.id, person.oldPassword);
  out.eq('the old password signs in while the change is paused (session S)', early.status, 200);
  out.eq('S is admitted on a protected route', await admitted(env, early.cookie), 200);
  release.resolve();
  const outcome = await changeDone;
  out.eq('the change stops at its refused enable and does not report success', outcome, 'stopped:enabled');
  out.eq(
    'the change called disable once and enable once: nothing repeated',
    `${trace.count('C subjects.disable')}/${trace.count('C subjects.enable')}`,
    '1/1',
  );
  out.yes(
    'the change had written the new hash before its enable was refused',
    trace.count('write H->N -> applied') === 1,
  );
  out.eq(
    'S is still admitted after the refused enable (the documented residual)',
    await admitted(env, early.cookie),
    200,
  );
  const settled = await reconcile(env, person.id, new Locks(), 'R2', trace);
  out.eq('a reconciliation that finds the subject enabled revokes sessions', settled, 'revoked');
  out.eq('S is refused from then on', await admitted(env, early.cookie), 401);
  out.eq('no session of the user exists', await sessionRows(env, person.id), 0);
  out.eq('the old password does not sign in and the new one does', await signIns(env, person), 'old=401 new=200');
  return out;
}

// Does:  Group 3: the change and the reconciliation share one per-user serialization.
async function withSerialization(env: Env): Promise<Verdicts> {
  const out = new Verdicts();
  const trace = new Trace();
  const person = await newPerson(env, 'g3');
  const locks = new Locks();
  const paused = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const changeDone = attempt(
    change(env, {
      person,
      locks,
      trace,
      hooks: {
        afterDisable: async () => {
          paused.resolve();
          await release.promise;
        },
      },
    }),
  );
  await paused.promise;
  const reconciling = reconcile(env, person.id, locks, 'R', trace);
  await turns(25);
  out.eq('the reconciliation has not read the subject while the change is paused', trace.count('R subjects.read'), 0);
  const early = await signIn(env, person.id, person.oldPassword);
  const earlyNew = await signIn(env, person.id, person.newPassword);
  out.eq(
    'a sign-in with the old password during the pause is refused',
    `${early.status} ${early.cookie === null ? 'no cookie' : 'cookie'}`,
    '401 no cookie',
  );
  out.eq(
    'a sign-in with the new password during the pause is refused too',
    `${earlyNew.status} ${earlyNew.cookie === null ? 'no cookie' : 'cookie'}`,
    '401 no cookie',
  );
  release.resolve();
  const outcome = await changeDone;
  const reconciled = await reconciling;
  out.eq('the change completes', outcome, 'changed');
  out.yes(
    'the reconciliation read the subject only after the change had enabled it',
    trace.first('C subjects.enable') >= 0 && trace.first('R subjects.read') > trace.first('C subjects.enable'),
    `C enable at ${trace.first('C subjects.enable')}, R read at ${trace.first('R subjects.read')}`,
  );
  out.eq('the reconciliation found it enabled and revoked sessions', reconciled, 'revoked');
  out.eq('no session of the user exists', await sessionRows(env, person.id), 0);
  const old = await signIn(env, person.id, person.oldPassword);
  out.eq('the old password does not sign in', old.status, 401);
  const next = await signIn(env, person.id, person.newPassword);
  out.eq('the new password signs in and is admitted', `${next.status} ${await admitted(env, next.cookie)}`, '200 200');
  out.eq('the only session of the user is the new one', await sessionRows(env, person.id), 1);
  return out;
}

// Does:  Group 4: each interruption row of the contract's table.
async function interruptions(env: Env): Promise<void> {
  const label = `[${env.kind}] interruption:`;
  const { observed } = env;
  const lost =
    (operation: 'subjectDisable' | 'subjectEnable'): (() => Promise<void>) =>
    () => {
      throw new StoreFailure(operation, 'unavailable', 'unknown', null);
    };
  const state = async (id: string): Promise<string> => show(await env.subjects.read(id));
  const row = async (name: string, body: (out: Verdicts) => Promise<void>): Promise<void> => {
    const out = new Verdicts();
    try {
      await body(out);
    } finally {
      observed.failWith(null);
      observed.after('subjectDisable', null);
      observed.after('subjectEnable', null);
    }
    for (const [item, ok, detail] of out.items) {
      report.check(`${label} ${name}: ${item}`, ok, detail);
    }
  };

  await row('step 1 answers not_applied', async (out) => {
    const person = await newPerson(env, 'g4a');
    observed.failWith('no', 'subjectDisable');
    const outcome = await attempt(change(env, { person, locks: new Locks(), trace: new Trace() }));
    observed.failWith(null);
    out.eq('the change reports it did not start', outcome, 'not_started');
    out.eq('the subject was not disabled', await state(person.id), 'absent');
    out.eq(
      'the old credential is stored and only the old password signs in',
      await signIns(env, person),
      'old=200 new=401',
    );
  });

  await row('step 1 answers unknown', async (out) => {
    const person = await newPerson(env, 'g4b');
    observed.after('subjectDisable', lost('subjectDisable'));
    const outcome = await attempt(change(env, { person, locks: new Locks(), trace: new Trace() }));
    observed.after('subjectDisable', null);
    out.eq('the change reports pending at disable', outcome, 'pending:disable');
    out.eq(
      'the subject may be disabled: read says disabled at generation 2',
      await state(person.id),
      'subject(enabled=false,generation=2)',
    );
    out.eq('no password signs in', await signIns(env, person), 'old=401 new=401');
    const settled = await reconcile(env, person.id, new Locks(), 'R', new Trace());
    out.eq('a reconciliation enables at the generation it read', settled, 'enabled');
    out.eq(
      'the old credential still stands: only the old password signs in',
      await signIns(env, person),
      'old=200 new=401',
    );
  });

  await row('a crash after step 1', async (out) => {
    const person = await newPerson(env, 'g4c');
    const outcome = await attempt(
      change(env, {
        person,
        locks: new Locks(),
        trace: new Trace(),
        hooks: {
          afterDisable: () => {
            throw new Crash();
          },
        },
      }),
    );
    out.eq('the process ended after the disable', outcome, 'crashed');
    out.eq('the subject is disabled', await state(person.id), 'subject(enabled=false,generation=2)');
    out.eq('no password signs in', await signIns(env, person), 'old=401 new=401');
    const settled = await reconcile(env, person.id, new Locks(), 'R', new Trace());
    out.eq('the restarted reconciliation enables at the generation it read', settled, 'enabled');
    out.eq('the old credential stands', await signIns(env, person), 'old=200 new=401');
  });

  await series(['throws-unapplied', 'throws-applied'] as const, (write) =>
    row(
      `step 2's outcome is unknown (the write ${write === 'throws-applied' ? 'had committed' : 'had not applied'})`,
      async (out) => {
        const person = await newPerson(env, `g4d${write === 'throws-applied' ? 'a' : 'u'}`);
        const outcome = await attempt(
          change(env, { person, locks: new Locks(), trace: new Trace(), hooks: { write } }),
        );
        out.eq('the change reports pending at the write', outcome, 'pending:write');
        out.eq('the subject stays disabled', await state(person.id), 'subject(enabled=false,generation=2)');
        out.eq('no password signs in', await signIns(env, person), 'old=401 new=401');
        const record = env.accounts.get(person.id);
        out.eq(
          'the application reads its own record and finds what the write left',
          record === person.hash ? 'old' : 'new',
          write === 'throws-applied' ? 'new' : 'old',
        );
        out.eq('reconciling enables it', await reconcile(env, person.id, new Locks(), 'R', new Trace()), 'enabled');
        out.eq(
          'afterwards the stored credential alone signs in',
          await signIns(env, person),
          write === 'throws-applied' ? 'old=401 new=200' : 'old=200 new=401',
        );
      },
    ),
  );

  await row('a crash after step 2', async (out) => {
    const person = await newPerson(env, 'g4e');
    const outcome = await attempt(
      change(env, { person, locks: new Locks(), trace: new Trace(), hooks: { crashBeforeEnable: true } }),
    );
    out.eq('the process ended after the write', outcome, 'crashed');
    out.eq('the subject is disabled', await state(person.id), 'subject(enabled=false,generation=2)');
    out.eq('no password signs in', await signIns(env, person), 'old=401 new=401');
    out.eq(
      'the restarted reconciliation enables it',
      await reconcile(env, person.id, new Locks(), 'R', new Trace()),
      'enabled',
    );
    out.eq('only the new password signs in', await signIns(env, person), 'old=401 new=200');
  });

  await row('step 3 answers not_applied', async (out) => {
    const person = await newPerson(env, 'g4f');
    observed.failWith('no', 'subjectEnable');
    const outcome = await attempt(change(env, { person, locks: new Locks(), trace: new Trace() }));
    observed.failWith(null);
    out.eq('the change reports pending at enable', outcome, 'pending:enable');
    out.eq(
      'the subject is still disabled at the generation of its disable',
      await state(person.id),
      'subject(enabled=false,generation=2)',
    );
    out.eq('no password signs in', await signIns(env, person), 'old=401 new=401');
    out.eq(
      'the same enable at generation 2, repeated, is done',
      show(await env.subjects.enable(person.id, 2)),
      'done(enabled=true,generation=3)',
    );
    out.eq('only the new password signs in', await signIns(env, person), 'old=401 new=200');
  });

  await row('step 3 answers unknown and had applied', async (out) => {
    const person = await newPerson(env, 'g4g');
    observed.after('subjectEnable', lost('subjectEnable'));
    const outcome = await attempt(change(env, { person, locks: new Locks(), trace: new Trace() }));
    observed.after('subjectEnable', null);
    out.eq('the change reads, finds enabled at g+1 and reports its own enable done', outcome, 'changed');
    out.eq('the subject is enabled at generation 3', await state(person.id), 'subject(enabled=true,generation=3)');
    out.eq('only the new password signs in', await signIns(env, person), 'old=401 new=200');
  });

  await row('step 3 answers unknown and had not applied', async (out) => {
    const person = await newPerson(env, 'g4h');
    observed.failWith('unknown', 'subjectEnable');
    const outcome = await attempt(change(env, { person, locks: new Locks(), trace: new Trace() }));
    observed.failWith(null);
    out.eq('the change reads, finds disabled at g and reports pending at enable', outcome, 'pending:enable');
    out.eq('the subject is disabled at generation 2', await state(person.id), 'subject(enabled=false,generation=2)');
    out.eq('no password signs in', await signIns(env, person), 'old=401 new=401');
    out.eq(
      'the enable at generation 2 called again is done',
      show(await env.subjects.enable(person.id, 2)),
      'done(enabled=true,generation=3)',
    );
    out.eq('only the new password signs in', await signIns(env, person), 'old=401 new=200');
  });
}

// Does:  Group 5: another actor moved the generation during the change, so its enable is refused stale.
async function staleEnable(env: Env): Promise<Verdicts> {
  const out = new Verdicts();
  const trace = new Trace();
  const person = await newPerson(env, 'g5');
  const locks = new Locks();
  const paused = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const changeDone = attempt(
    change(env, {
      person,
      locks,
      trace,
      hooks: {
        afterDisable: async () => {
          paused.resolve();
          await release.promise;
        },
      },
    }),
  );
  await paused.promise;
  const extra = show(await env.subjects.disable(person.id));
  out.eq('an extra disable during the change raises the generation', extra, 'done(enabled=false,generation=3)');
  release.resolve();
  const outcome = await changeDone;
  out.eq('the change stops: its enable is refused stale', outcome, 'stopped:stale');
  out.eq(
    'the change called disable once and enable once: nothing repeated',
    `${trace.count('C subjects.disable')}/${trace.count('C subjects.enable')}`,
    '1/1',
  );
  out.eq(
    'the subject stays disabled at the moved generation',
    show(await env.subjects.read(person.id)),
    'subject(enabled=false,generation=3)',
  );
  out.eq('no password signs in', await signIns(env, person), 'old=401 new=401');
  const settled = await reconcile(env, person.id, locks, 'R', trace);
  out.eq('a reconciliation enables at the generation it read', settled, 'enabled');
  out.eq(
    'the reconciliation named generation 3',
    trace.count('R subjects.enable(3) -> done(enabled=true,generation=4)'),
    1,
  );
  out.eq(
    'the change had written the new hash: only the new password signs in',
    await signIns(env, person),
    'old=401 new=200',
  );
  out.eq(
    "the change's own stale enable, repeated now, is refused enabled",
    show(await env.subjects.enable(person.id, 2)),
    'refused/enabled',
  );
  return out;
}

async function suite(kind: Kind): Promise<void> {
  const env = await startEnv(kind);
  try {
    await report.run(`[${kind}] primitive`, () => primitive(env));
    await report.run(`[${kind}] store unit`, () => unit(kind));
    const second: Verdicts[] = [];
    await series(Array.from({ length: RUNS }), async () => {
      second.push(await withoutSerialization(env));
    });
    emit(`[${kind}] no serialization:`, second);
    const third: Verdicts[] = [];
    await series(Array.from({ length: RUNS }), async () => {
      third.push(await withSerialization(env));
    });
    emit(`[${kind}] per-user serialization:`, third);
    await report.run(`[${kind}] interruption`, () => interruptions(env));
    const fifth: Verdicts[] = [];
    await series(Array.from({ length: exhaustive ? 3 : 1 }), async () => {
      fifth.push(await staleEnable(env));
    });
    emit(`[${kind}] stale enable:`, fifth);
  } finally {
    await env.close();
  }
}

try {
  await series(rigKinds, suite);
} finally {
  await cleanAll();
}
report.finish();
