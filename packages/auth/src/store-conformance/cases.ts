// Does:  Declares the conformance cases: each return case of the 18 operations, lock waits, races and the lifecycle.
// Holds: Every expected value comes from the store contract's rows, never from an adapter's behaviour.

import { setImmediate, setTimeout as sleep } from 'node:timers/promises';
import { StoreFailure } from '../store/store.ts';
import type { AuthStore, Digest, StoreAttach, StoreEvent, StoreOperations } from '../store/types.ts';
import {
  check,
  deepFrozen,
  describe,
  integer,
  kind,
  lostWith,
  newDigest,
  newKeyId,
  newUserId,
  plainDigest,
  rejectsWith,
  same,
  sameBytes,
} from './check.ts';
import type { ConformanceTarget } from './types.ts';

type HoldLock = NonNullable<ConformanceTarget['holdLock']>;
type WriteVersions = NonNullable<ConformanceTarget['writeVersions']>;

interface CaseContext {
  readonly store: AuthStore;
  readonly ops: StoreOperations;
  readonly attach: StoreAttach;
  readonly events: readonly StoreEvent[];
  readonly hold: HoldLock | undefined;
  readonly writeVersions: WriteVersions | undefined;
}

interface Case {
  readonly name: string;
  readonly setup: 'attached' | 'none';
  readonly needs: 'lock' | 'row-lock' | 'versions' | null;
  readonly run: (context: CaseContext) => Promise<void>;
}

const LONG_MS = 3_600_000;
// Why: Short expiries must pass during a held lock yet the hold must end inside SQLite's 511 ms retry budget.
const SHORT_MS = 100;
const HOLD_MS = 300;
const PAST_SHORT_MS = 250;
const RACE = 20;

function attached(name: string, run: (context: CaseContext) => Promise<void>): Case {
  return { name, setup: 'attached', needs: null, run };
}

function locked(name: string, run: (context: CaseContext) => Promise<void>): Case {
  return { name, setup: 'attached', needs: 'lock', run };
}

function lifecycle(name: string, run: (context: CaseContext) => Promise<void>): Case {
  return { name, setup: 'none', needs: null, run };
}

function versioned(name: string, run: (context: CaseContext, write: WriteVersions) => Promise<void>): Case {
  return {
    name,
    setup: 'none',
    needs: 'versions',
    run: async (context) => {
      check(context.writeVersions !== undefined, 'writeVersions is required by this case');
      kind(await context.store.install(), 'installed', 'install');
      await run(context, context.writeVersions);
    },
  };
}

function holder(context: CaseContext): HoldLock {
  check(context.hold !== undefined, 'holdLock is required by this case');
  return context.hold;
}

async function issueSession(
  ops: StoreOperations,
  options: { readonly userId?: string; readonly idleMs?: number; readonly absoluteMs?: number } = {},
): Promise<{
  readonly userId: string;
  readonly digest: Digest;
  readonly createdAt: number;
  readonly expiresAt: number;
}> {
  const userId = options.userId ?? newUserId();
  const fence = await ops.subjectEnsure({ userId });
  const digest = newDigest();
  const issued = kind(
    await ops.sessionIssue({
      userId,
      generation: fence.generation,
      digest,
      replaces: null,
      idleMs: options.idleMs ?? LONG_MS,
      absoluteMs: options.absoluteMs ?? LONG_MS,
    }),
    'done',
    'setup sessionIssue',
  );
  return { userId, digest, createdAt: issued.createdAt, expiresAt: issued.expiresAt };
}

async function issueKey(
  ops: StoreOperations,
  userId: string,
  options: { readonly expiresInMs?: number | null; readonly max?: number; readonly scopes?: readonly string[] } = {},
): Promise<{
  readonly keyId: string;
  readonly digest: Digest;
  readonly createdAt: number;
  readonly expiresAt: number | null;
}> {
  const keyId = newKeyId();
  const digest = newDigest();
  const issued = kind(
    await ops.apiKeyIssue({
      userId,
      keyId,
      digest,
      name: `key ${keyId}`,
      scopes: options.scopes ?? ['notes:read'],
      expiresInMs: options.expiresInMs ?? null,
      max: options.max ?? 100,
    }),
    'done',
    'setup apiKeyIssue',
  );
  return { keyId, digest, createdAt: issued.createdAt, expiresAt: issued.expiresAt };
}

function attemptInput(state: Digest, binding: Digest, ttlMs = LONG_MS) {
  return {
    state,
    binding,
    provider: 'local',
    nonce: 'nonce-value',
    verifier: 'verifier-value',
    returnPath: '/home',
    ttlMs,
  };
}

async function expectBlocked<T>(hold: Promise<void>, operation: () => Promise<T>, what: string): Promise<T> {
  await hold;
  const started = performance.now();
  const result = await operation();
  check(performance.now() - started >= HOLD_MS / 2, `${what}: finished without waiting for the held lock`);
  return result;
}

async function expectUnblocked<T>(hold: Promise<void>, operation: () => Promise<T>, what: string): Promise<T> {
  await hold;
  const started = performance.now();
  const result = await operation();
  check(performance.now() - started < HOLD_MS / 2, `${what}: waited for a held lock it must not wait on`);
  return result;
}

function count<T>(values: readonly T[], test: (value: T) => boolean): number {
  return values.filter(test).length;
}

function sequence(from: number, to: number): string {
  return Array.from({ length: to - from + 1 }, (_, index) => from + index).join(',');
}

function sorted(values: readonly number[]): string {
  return [...values].sort((a, b) => a - b).join(',');
}

type Call = (ops: StoreOperations, signal?: AbortSignal) => Promise<unknown>;

const calls: { readonly [K in keyof StoreOperations]: Call } = {
  subjectEnsure: (ops, signal) => ops.subjectEnsure({ userId: newUserId() }, signal),
  subjectRead: (ops, signal) => ops.subjectRead({ userId: newUserId() }, signal),
  subjectDisable: (ops, signal) => ops.subjectDisable({ userId: newUserId() }, signal),
  subjectEnable: (ops, signal) => ops.subjectEnable({ userId: newUserId(), generation: 1 }, signal),
  subjectInvalidate: (ops, signal) => ops.subjectInvalidate({ userId: newUserId() }, signal),
  sessionIssue: (ops, signal) =>
    ops.sessionIssue(
      { userId: newUserId(), generation: 1, digest: newDigest(), replaces: null, idleMs: LONG_MS, absoluteMs: LONG_MS },
      signal,
    ),
  sessionRead: (ops, signal) => ops.sessionRead({ digest: newDigest() }, signal),
  sessionRenew: (ops, signal) => ops.sessionRenew({ digest: newDigest(), idleMs: LONG_MS }, signal),
  sessionRotate: (ops, signal) =>
    ops.sessionRotate({ userId: newUserId(), digest: newDigest(), next: newDigest(), idleMs: LONG_MS }, signal),
  sessionRevoke: (ops, signal) => ops.sessionRevoke({ digest: newDigest() }, signal),
  apiKeyIssue: (ops, signal) =>
    ops.apiKeyIssue(
      {
        userId: newUserId(),
        keyId: newKeyId(),
        digest: newDigest(),
        name: 'key',
        scopes: ['notes:read'],
        expiresInMs: null,
        max: 10,
      },
      signal,
    ),
  apiKeyRead: (ops, signal) => ops.apiKeyRead({ keyId: newKeyId() }, signal),
  apiKeyList: (ops, signal) => ops.apiKeyList({ userId: newUserId(), limit: 10 }, signal),
  apiKeyRevoke: (ops, signal) => ops.apiKeyRevoke({ userId: newUserId(), keyId: newKeyId() }, signal),
  limitCharge: (ops, signal) => ops.limitCharge({ key: newDigest(), max: 5, windowMs: LONG_MS }, signal),
  attemptCreate: (ops, signal) => ops.attemptCreate(attemptInput(newDigest(), newDigest()), signal),
  attemptConsume: (ops, signal) =>
    ops.attemptConsume({ state: newDigest(), binding: newDigest(), provider: 'local' }, signal),
  expiredRemove: (ops, signal) => ops.expiredRemove({ limit: 10 }, signal),
};

function everyOperation(): Case[] {
  const cases: Case[] = [];
  for (const [operation, call] of Object.entries(calls)) {
    cases.push(
      lifecycle(`${operation}.before-attach`, async ({ store }) => {
        kind(await store.install(), 'installed', 'install');
        await rejectsWith(call(store.ops), 'unavailable', 'no', operation);
      }),
      lifecycle(`${operation}.after-close`, async ({ store, attach }) => {
        kind(await store.install(), 'installed', 'install');
        kind(await store.attach(attach), 'attached', 'attach');
        await store.close();
        await rejectsWith(call(store.ops), 'unavailable', 'no', operation);
      }),
      attached(`${operation}.aborted`, async ({ ops }) => {
        await rejectsWith(call(ops, AbortSignal.abort()), 'aborted', 'no', operation);
      }),
    );
  }
  return cases;
}

const installCases: Case[] = [
  lifecycle('install.empty', async ({ store, attach }) => {
    const result = await store.install();
    kind(result, 'installed', 'install');
    deepFrozen(result, 'install result');
    kind(await store.attach(attach), 'attached', 'attach');
  }),
  lifecycle('install.concurrent', async ({ store, attach }) => {
    const results = await Promise.all(Array.from({ length: 5 }, () => store.install()));
    same(
      count(results, (result) => result.kind === 'installed'),
      1,
      'installed',
    );
    same(
      count(results, (result) => result.kind === 'current'),
      4,
      'current',
    );
    kind(await store.attach(attach), 'attached', 'attach');
  }),
  lifecycle('install.current', async ({ store, attach }) => {
    kind(await store.install(), 'installed', 'first install');
    kind(await store.install(), 'current', 'second install');
    kind(await store.attach(attach), 'attached', 'attach');
  }),
  versioned('install.mismatch', async ({ store }, write) => {
    await write([2]);
    const result = kind(await store.install(), 'mismatch', 'install');
    same(result.found, 2, 'found');
    deepFrozen(result, 'install result');
  }),
  versioned('install.version-empty', async ({ store }, write) => {
    await write([]);
    await rejectsWith(store.install(), 'record', 'no', 'install');
  }),
  versioned('install.version-repeated', async ({ store }, write) => {
    await write([1, 1]);
    await rejectsWith(store.install(), 'record', 'no', 'install');
  }),
  versioned('attach.mismatch', async ({ store, attach }, write) => {
    await write([2]);
    const result = kind(await store.attach(attach), 'mismatch', 'attach');
    same(result.found, 2, 'found');
    deepFrozen(result, 'attach result');
  }),
  versioned('attach.version-empty', async ({ store, attach }, write) => {
    await write([]);
    await rejectsWith(store.attach(attach), 'record', 'no', 'attach');
  }),
  versioned('attach.version-repeated', async ({ store, attach }, write) => {
    await write([1, 1]);
    await rejectsWith(store.attach(attach), 'record', 'no', 'attach');
  }),
  lifecycle('attach.after-close', async ({ store, attach }) => {
    kind(await store.install(), 'installed', 'install');
    await store.close();
    await rejectsWith(store.attach(attach), 'unavailable', 'no', 'attach');
  }),
  lifecycle('install.after-close', async ({ store }) => {
    await store.close();
    await rejectsWith(store.install(), 'unavailable', 'no', 'install');
  }),
  lifecycle('close.twice', async ({ store, attach }) => {
    kind(await store.install(), 'installed', 'install');
    kind(await store.attach(attach), 'attached', 'attach');
    await store.close();
    await store.close();
  }),
  lifecycle('attach.not-installed', async ({ store, attach }) => {
    const result = await store.attach(attach);
    kind(result, 'not_installed', 'attach');
    deepFrozen(result, 'attach result');
  }),
  lifecycle('attach.second', async ({ store, attach }) => {
    kind(await store.install(), 'installed', 'install');
    const first = await store.attach(attach);
    kind(first, 'attached', 'first attach');
    deepFrozen(first, 'attach result');
    const second = await store.attach(attach);
    kind(second, 'in_use', 'second attach');
    deepFrozen(second, 'second attach result');
    same((await store.ops.subjectEnsure({ userId: newUserId() })).kind, 'done', 'operation after second attach');
  }),
];

const subjectCases: Case[] = [
  attached('subjectEnsure.absent', async ({ ops }) => {
    const userId = newUserId();
    const result = await ops.subjectEnsure({ userId });
    same(result.kind, 'done', 'kind');
    same(result.enabled, true, 'enabled');
    same(result.generation, 1, 'generation');
    integer(result.now, 'now');
    deepFrozen(result, 'result');
    const read = await ops.subjectRead({ userId });
    same(read?.enabled, true, 'read enabled');
    same(read?.generation, 1, 'read generation');
  }),
  attached('subjectEnsure.existing', async ({ ops }) => {
    const userId = newUserId();
    await ops.subjectDisable({ userId });
    const result = await ops.subjectEnsure({ userId });
    same(result.enabled, false, 'enabled');
    same(result.generation, 2, 'generation');
  }),
  attached('subjectRead.absent', async ({ ops }) => {
    same(await ops.subjectRead({ userId: newUserId() }), null, 'read');
  }),
  attached('subjectRead.present', async ({ ops }) => {
    const userId = newUserId();
    await ops.subjectInvalidate({ userId });
    const read = await ops.subjectRead({ userId });
    check(read !== null, 'read: null for a present subject');
    same(read.enabled, true, 'enabled');
    same(read.generation, 2, 'generation');
    integer(read.now, 'now');
    deepFrozen(read, 'record');
  }),
  attached('subjectDisable.absent', async ({ ops }) => {
    const userId = newUserId();
    const result = await ops.subjectDisable({ userId });
    same(result.generation, 2, 'generation');
    same(result.revoked, 0, 'revoked');
    deepFrozen(result, 'result');
    const read = await ops.subjectRead({ userId });
    same(read?.enabled, false, 'read enabled');
    same(read?.generation, 2, 'read generation');
  }),
  attached('subjectDisable.sessions', async ({ ops }) => {
    const first = await issueSession(ops);
    const second = await issueSession(ops, { userId: first.userId });
    const other = await issueSession(ops);
    const result = await ops.subjectDisable({ userId: first.userId });
    same(result.generation, 2, 'generation');
    same(result.revoked, 2, 'revoked');
    same(await ops.sessionRead({ digest: first.digest }), null, 'first session');
    same(await ops.sessionRead({ digest: second.digest }), null, 'second session');
    check((await ops.sessionRead({ digest: other.digest })) !== null, "another subject's session was deleted");
  }),
  attached('subjectDisable.repeat', async ({ ops }) => {
    const userId = newUserId();
    same((await ops.subjectDisable({ userId })).generation, 2, 'first generation');
    same((await ops.subjectDisable({ userId })).generation, 3, 'second generation');
    same((await ops.subjectRead({ userId }))?.enabled, false, 'enabled');
  }),
  attached('subjectEnable.absent', async ({ ops }) => {
    const userId = newUserId();
    const result = await ops.subjectEnable({ userId, generation: 1 });
    lostWith(result, 'absent', 'enable');
    integer(result.now, 'now');
    deepFrozen(result, 'result');
    same(await ops.subjectRead({ userId }), null, 'read');
  }),
  attached('subjectEnable.disabled', async ({ ops }) => {
    const first = await issueSession(ops);
    const other = await issueSession(ops);
    const userId = first.userId;
    const disabled = await ops.subjectDisable({ userId });
    same(disabled.generation, 2, 'disable generation');
    const result = kind(await ops.subjectEnable({ userId, generation: 2 }), 'done', 'enable');
    same(result.generation, 3, 'generation');
    same(result.revoked, 0, 'revoked');
    integer(result.now, 'now');
    deepFrozen(result, 'result');
    const read = await ops.subjectRead({ userId });
    same(read?.enabled, true, 'read enabled');
    same(read?.generation, 3, 'read generation');
    same(await ops.sessionRead({ digest: first.digest }), null, 'session');
    check((await ops.sessionRead({ digest: other.digest })) !== null, "another subject's session was deleted");
  }),
  attached('subjectEnable.enabled', async ({ ops }) => {
    const issued = await issueSession(ops);
    const userId = issued.userId;
    const result = await ops.subjectEnable({ userId, generation: 1 });
    lostWith(result, 'enabled', 'enable at the current generation');
    deepFrozen(result, 'result');
    lostWith(await ops.subjectEnable({ userId, generation: 2 }), 'enabled', 'enable at another generation');
    const read = await ops.subjectRead({ userId });
    same(read?.enabled, true, 'read enabled');
    same(read?.generation, 1, 'read generation');
    check((await ops.sessionRead({ digest: issued.digest })) !== null, 'a refused enable deleted a session');
  }),
  attached('subjectEnable.stale', async ({ ops }) => {
    const userId = newUserId();
    same((await ops.subjectDisable({ userId })).generation, 2, 'disable generation');
    const below = await ops.subjectEnable({ userId, generation: 1 });
    lostWith(below, 'stale', 'enable below the generation');
    deepFrozen(below, 'result');
    lostWith(await ops.subjectEnable({ userId, generation: 3 }), 'stale', 'enable above the generation');
    const read = await ops.subjectRead({ userId });
    same(read?.enabled, false, 'read enabled');
    same(read?.generation, 2, 'read generation');
  }),
  attached('subjectInvalidate.absent', async ({ ops }) => {
    const userId = newUserId();
    const result = await ops.subjectInvalidate({ userId });
    same(result.generation, 2, 'generation');
    same(result.revoked, 0, 'revoked');
    same(result.enabled, true, 'enabled');
    deepFrozen(result, 'result');
    const read = await ops.subjectRead({ userId });
    same(read?.enabled, true, 'read enabled');
    same(read?.generation, 2, 'read generation');
  }),
  attached('subjectInvalidate.sessions', async ({ ops }) => {
    const first = await issueSession(ops);
    const second = await issueSession(ops, { userId: first.userId });
    const result = await ops.subjectInvalidate({ userId: first.userId });
    same(result.generation, 2, 'generation');
    same(result.revoked, 2, 'revoked');
    same(result.enabled, true, 'enabled');
    same(await ops.sessionRead({ digest: first.digest }), null, 'first session');
    same(await ops.sessionRead({ digest: second.digest }), null, 'second session');
    same((await ops.subjectRead({ userId: first.userId }))?.enabled, true, 'enabled');
  }),
  attached('subjectInvalidate.disabled', async ({ ops }) => {
    const userId = newUserId();
    await ops.subjectDisable({ userId });
    const result = await ops.subjectInvalidate({ userId });
    same(result.generation, 3, 'generation');
    same(result.enabled, false, 'enabled');
    same((await ops.subjectRead({ userId }))?.enabled, false, 'enabled');
  }),
];

const sessionCases: Case[] = [
  attached('sessionIssue.done', async ({ ops }) => {
    const userId = newUserId();
    const digest = newDigest();
    await ops.subjectEnsure({ userId });
    const issued = kind(
      await ops.sessionIssue({ userId, generation: 1, digest, replaces: null, idleMs: 60_000, absoluteMs: 600_000 }),
      'done',
      'issue',
    );
    integer(issued.now, 'now');
    same(issued.createdAt, issued.now, 'createdAt');
    same(issued.expiresAt, issued.now + 60_000, 'expiresAt');
    deepFrozen(issued, 'result');
    const read = await ops.sessionRead({ digest });
    check(read !== null, 'read: the issued session is absent');
    same(read.userId, userId, 'read userId');
    same(read.createdAt, issued.createdAt, 'read createdAt');
    same(read.expiresAt, issued.expiresAt, 'read expiresAt');
    same(read.absoluteExpiresAt, issued.now + 600_000, 'read absoluteExpiresAt');
    same(read.lastSeenAt, issued.now, 'read lastSeenAt');
  }),
  attached('sessionIssue.absolute-shorter', async ({ ops }) => {
    const userId = newUserId();
    const digest = newDigest();
    await ops.subjectEnsure({ userId });
    const issued = kind(
      await ops.sessionIssue({ userId, generation: 1, digest, replaces: null, idleMs: 600_000, absoluteMs: 60_000 }),
      'done',
      'issue',
    );
    same(issued.expiresAt, issued.now + 60_000, 'expiresAt');
    same((await ops.sessionRead({ digest }))?.absoluteExpiresAt, issued.now + 60_000, 'absoluteExpiresAt');
  }),
  attached('sessionIssue.absent-fence', async ({ ops }) => {
    const userId = newUserId();
    const digest = newDigest();
    const result = await ops.sessionIssue({
      userId,
      generation: 1,
      digest,
      replaces: null,
      idleMs: LONG_MS,
      absoluteMs: LONG_MS,
    });
    lostWith(result, 'stale', 'issue');
    deepFrozen(result, 'result');
    same(await ops.sessionRead({ digest }), null, 'read');
    same(await ops.subjectRead({ userId }), null, 'a lost issue left a fence behind');
  }),
  attached('sessionIssue.disabled', async ({ ops }) => {
    const userId = newUserId();
    const digest = newDigest();
    await ops.subjectDisable({ userId });
    lostWith(
      await ops.sessionIssue({ userId, generation: 2, digest, replaces: null, idleMs: LONG_MS, absoluteMs: LONG_MS }),
      'disabled',
      'issue',
    );
    same(await ops.sessionRead({ digest }), null, 'read');
  }),
  attached('sessionIssue.disabled-before-stale', async ({ ops }) => {
    const userId = newUserId();
    await ops.subjectDisable({ userId });
    lostWith(
      await ops.sessionIssue({
        userId,
        generation: 1,
        digest: newDigest(),
        replaces: null,
        idleMs: LONG_MS,
        absoluteMs: LONG_MS,
      }),
      'disabled',
      'issue',
    );
  }),
  attached('sessionIssue.stale', async ({ ops }) => {
    const userId = newUserId();
    const digest = newDigest();
    await ops.subjectEnsure({ userId });
    await ops.subjectInvalidate({ userId });
    lostWith(
      await ops.sessionIssue({ userId, generation: 1, digest, replaces: null, idleMs: LONG_MS, absoluteMs: LONG_MS }),
      'stale',
      'issue',
    );
    same(await ops.sessionRead({ digest }), null, 'read');
  }),
  attached('sessionIssue.replaces', async ({ ops }) => {
    const held = await issueSession(ops);
    const userId = newUserId();
    const digest = newDigest();
    await ops.subjectEnsure({ userId });
    kind(
      await ops.sessionIssue({
        userId,
        generation: 1,
        digest,
        replaces: held.digest,
        idleMs: LONG_MS,
        absoluteMs: LONG_MS,
      }),
      'done',
      'issue',
    );
    same(await ops.sessionRead({ digest: held.digest }), null, 'the replaced session of another subject');
    same((await ops.sessionRead({ digest }))?.userId, userId, 'new session');
  }),
  attached('sessionIssue.replaces-absent', async ({ ops }) => {
    const userId = newUserId();
    await ops.subjectEnsure({ userId });
    kind(
      await ops.sessionIssue({
        userId,
        generation: 1,
        digest: newDigest(),
        replaces: newDigest(),
        idleMs: LONG_MS,
        absoluteMs: LONG_MS,
      }),
      'done',
      'issue',
    );
  }),
  attached('sessionIssue.lost-keeps-replaced', async ({ ops }) => {
    const held = await issueSession(ops);
    await ops.subjectInvalidate({ userId: newUserId() });
    const userId = newUserId();
    await ops.subjectInvalidate({ userId });
    lostWith(
      await ops.sessionIssue({
        userId,
        generation: 1,
        digest: newDigest(),
        replaces: held.digest,
        idleMs: LONG_MS,
        absoluteMs: LONG_MS,
      }),
      'stale',
      'issue',
    );
    check((await ops.sessionRead({ digest: held.digest })) !== null, 'a lost issue deleted the replaced session');
  }),
  attached('sessionRead.absent', async ({ ops }) => {
    same(await ops.sessionRead({ digest: newDigest() }), null, 'read');
  }),
  attached('sessionRead.record', async ({ ops }) => {
    const live = await issueSession(ops);
    const read = await ops.sessionRead({ digest: live.digest });
    check(read !== null, 'read: null for a live session');
    integer(read.now, 'now');
    integer(read.lastSeenAt, 'lastSeenAt');
    check(read.expiresAt > read.now, 'expiresAt is not after now');
    deepFrozen(read, 'record');
  }),
  attached('sessionRead.expired', async ({ ops }) => {
    const live = await issueSession(ops, { idleMs: SHORT_MS });
    await sleep(PAST_SHORT_MS);
    same(await ops.sessionRead({ digest: live.digest }), null, 'read');
  }),
  attached('sessionRenew.done', async ({ ops }) => {
    const live = await issueSession(ops, { idleMs: 60_000, absoluteMs: 600_000 });
    await sleep(20);
    const renewed = kind(await ops.sessionRenew({ digest: live.digest, idleMs: 120_000 }), 'done', 'renew');
    same(renewed.expiresAt, renewed.now + 120_000, 'expiresAt');
    deepFrozen(renewed, 'result');
    const read = await ops.sessionRead({ digest: live.digest });
    same(read?.lastSeenAt, renewed.now, 'read lastSeenAt');
    same(read?.expiresAt, renewed.expiresAt, 'read expiresAt');
    same(read?.createdAt, live.createdAt, 'read createdAt');
  }),
  attached('sessionRenew.capped', async ({ ops }) => {
    const live = await issueSession(ops, { idleMs: 1_000, absoluteMs: 5_000 });
    const before = await ops.sessionRead({ digest: live.digest });
    check(before !== null, 'read: null for a live session');
    const renewed = kind(await ops.sessionRenew({ digest: live.digest, idleMs: 600_000 }), 'done', 'renew');
    same(renewed.expiresAt, before.absoluteExpiresAt, 'expiresAt');
    same((await ops.sessionRead({ digest: live.digest }))?.absoluteExpiresAt, before.absoluteExpiresAt, 'absolute');
  }),
  attached('sessionRenew.absent', async ({ ops }) => {
    const digest = newDigest();
    lostWith(await ops.sessionRenew({ digest, idleMs: LONG_MS }), 'gone', 'renew');
    same(await ops.sessionRead({ digest }), null, 'read after renew');
  }),
  attached('sessionRenew.expired', async ({ ops }) => {
    const live = await issueSession(ops, { idleMs: SHORT_MS });
    await sleep(PAST_SHORT_MS);
    lostWith(await ops.sessionRenew({ digest: live.digest, idleMs: LONG_MS }), 'gone', 'renew');
    same(await ops.sessionRead({ digest: live.digest }), null, 'read after renew');
  }),
  attached('sessionRotate.done', async ({ ops }) => {
    const live = await issueSession(ops, { idleMs: 60_000, absoluteMs: 600_000 });
    const before = await ops.sessionRead({ digest: live.digest });
    check(before !== null, 'read: null for a live session');
    const next = newDigest();
    const rotated = kind(
      await ops.sessionRotate({ userId: live.userId, digest: live.digest, next, idleMs: 120_000 }),
      'done',
      'rotate',
    );
    same(rotated.createdAt, live.createdAt, 'createdAt');
    same(rotated.absoluteExpiresAt, before.absoluteExpiresAt, 'absoluteExpiresAt');
    same(rotated.expiresAt, rotated.now + 120_000, 'expiresAt');
    deepFrozen(rotated, 'result');
    same(await ops.sessionRead({ digest: live.digest }), null, 'old session');
    const read = await ops.sessionRead({ digest: next });
    same(read?.userId, live.userId, 'next userId');
    same(read?.createdAt, live.createdAt, 'next createdAt');
    same(read?.expiresAt, rotated.expiresAt, 'next expiresAt');
    same(read?.lastSeenAt, rotated.now, 'next lastSeenAt');
  }),
  attached('sessionRotate.capped', async ({ ops }) => {
    const live = await issueSession(ops, { idleMs: 1_000, absoluteMs: 5_000 });
    const rotated = kind(
      await ops.sessionRotate({ userId: live.userId, digest: live.digest, next: newDigest(), idleMs: 600_000 }),
      'done',
      'rotate',
    );
    same(rotated.expiresAt, rotated.absoluteExpiresAt, 'expiresAt');
  }),
  attached('sessionRotate.other-subject', async ({ ops }) => {
    const live = await issueSession(ops);
    const next = newDigest();
    lostWith(
      await ops.sessionRotate({ userId: newUserId(), digest: live.digest, next, idleMs: LONG_MS }),
      'gone',
      'rotate',
    );
    check((await ops.sessionRead({ digest: live.digest })) !== null, 'a lost rotate deleted the session');
    same(await ops.sessionRead({ digest: next }), null, 'next session');
  }),
  attached('sessionRotate.absent-subject', async ({ ops }) => {
    const userId = newUserId();
    lostWith(
      await ops.sessionRotate({ userId, digest: newDigest(), next: newDigest(), idleMs: LONG_MS }),
      'gone',
      'rotate',
    );
    same(await ops.subjectRead({ userId }), null, 'a lost rotate left a fence behind');
  }),
  attached('sessionRotate.absent', async ({ ops }) => {
    const userId = newUserId();
    await ops.subjectEnsure({ userId });
    const next = newDigest();
    lostWith(await ops.sessionRotate({ userId, digest: newDigest(), next, idleMs: LONG_MS }), 'gone', 'rotate');
    same(await ops.sessionRead({ digest: next }), null, 'next session');
  }),
  attached('sessionRotate.expired', async ({ ops }) => {
    const live = await issueSession(ops, { idleMs: SHORT_MS });
    await sleep(PAST_SHORT_MS);
    const next = newDigest();
    lostWith(
      await ops.sessionRotate({ userId: live.userId, digest: live.digest, next, idleMs: LONG_MS }),
      'gone',
      'rotate',
    );
    same(await ops.sessionRead({ digest: next }), null, 'next session');
  }),
  attached('sessionRevoke.present', async ({ ops }) => {
    const live = await issueSession(ops);
    const result = await ops.sessionRevoke({ digest: live.digest });
    same(result.revoked, true, 'revoked');
    same(result.userId, live.userId, 'userId');
    deepFrozen(result, 'result');
    same(await ops.sessionRead({ digest: live.digest }), null, 'read');
  }),
  attached('sessionRevoke.expired', async ({ ops }) => {
    const expired = await issueSession(ops, { idleMs: SHORT_MS });
    await sleep(PAST_SHORT_MS);
    const result = await ops.sessionRevoke({ digest: expired.digest });
    same(result.revoked, true, 'revoked');
    same(result.userId, expired.userId, 'userId');
    same((await ops.expiredRemove({ limit: 1_000 })).removed, 0, 'expired rows left after the revoke');
  }),
  attached('sessionRevoke.absent', async ({ ops }) => {
    const result = await ops.sessionRevoke({ digest: newDigest() });
    same(result.revoked, false, 'revoked');
    same(result.userId, null, 'userId');
  }),
];

const apiKeyCases: Case[] = [
  attached('apiKeyIssue.done', async ({ ops }) => {
    const userId = newUserId();
    await ops.subjectEnsure({ userId });
    const result = await ops.apiKeyIssue({
      userId,
      keyId: newKeyId(),
      digest: newDigest(),
      name: 'deploy',
      scopes: ['notes:read'],
      expiresInMs: null,
      max: 10,
    });
    const issued = kind(result, 'done', 'issue');
    same(issued.createdAt, issued.now, 'createdAt');
    same(issued.expiresAt, null, 'expiresAt');
    deepFrozen(issued, 'result');
  }),
  attached('apiKeyIssue.expiring', async ({ ops }) => {
    const userId = newUserId();
    const issued = await issueKey(ops, userId, { expiresInMs: 60_000 });
    const read = await ops.apiKeyRead({ keyId: issued.keyId });
    same(issued.expiresAt, issued.createdAt + 60_000, 'expiresAt');
    same(read?.expiresAt, issued.expiresAt, 'read expiresAt');
  }),
  attached('apiKeyIssue.absent-fence', async ({ ops }) => {
    const userId = newUserId();
    await issueKey(ops, userId);
    const read = await ops.subjectRead({ userId });
    same(read?.enabled, true, 'fence enabled');
    same(read?.generation, 1, 'fence generation');
  }),
  attached('apiKeyIssue.disabled', async ({ ops }) => {
    const userId = newUserId();
    const keyId = newKeyId();
    await ops.subjectDisable({ userId });
    const result = await ops.apiKeyIssue({
      userId,
      keyId,
      digest: newDigest(),
      name: 'deploy',
      scopes: ['notes:read'],
      expiresInMs: null,
      max: 10,
    });
    lostWith(result, 'disabled', 'issue');
    same(await ops.apiKeyRead({ keyId }), null, 'read');
  }),
  attached('apiKeyIssue.limit', async ({ ops }) => {
    const userId = newUserId();
    await issueKey(ops, userId, { max: 2 });
    await issueKey(ops, userId, { max: 2 });
    const keyId = newKeyId();
    const result = await ops.apiKeyIssue({
      userId,
      keyId,
      digest: newDigest(),
      name: 'third',
      scopes: ['notes:read'],
      expiresInMs: null,
      max: 2,
    });
    lostWith(result, 'limit', 'third issue');
    same(await ops.apiKeyRead({ keyId }), null, 'read');
    same((await ops.apiKeyList({ userId, limit: 1_000 })).keys.length, 2, 'listed keys');
  }),
  attached('apiKeyIssue.expired-not-counted', async ({ ops }) => {
    const userId = newUserId();
    await issueKey(ops, userId, { max: 1, expiresInMs: SHORT_MS });
    await sleep(PAST_SHORT_MS);
    await issueKey(ops, userId, { max: 1 });
  }),
  attached('apiKeyRead.record', async ({ ops }) => {
    const userId = newUserId();
    const issued = await issueKey(ops, userId, { scopes: ['notes:read', 'notes:write'] });
    const read = await ops.apiKeyRead({ keyId: issued.keyId });
    check(read !== null, 'read: null for an issued key');
    same(read.userId, userId, 'userId');
    check(sameBytes(read.digest, issued.digest), 'digest differs from the issued one');
    plainDigest(read.digest, 'digest');
    same(read.scopes.join(' '), 'notes:read notes:write', 'scopes');
    same(read.expiresAt, null, 'expiresAt');
    same(read.enabled, true, 'enabled');
    integer(read.now, 'now');
    deepFrozen(read, 'record');
  }),
  attached('apiKeyRead.absent', async ({ ops }) => {
    same(await ops.apiKeyRead({ keyId: newKeyId() }), null, 'read');
  }),
  attached('apiKeyRead.expired', async ({ ops }) => {
    const issued = await issueKey(ops, newUserId(), { expiresInMs: SHORT_MS });
    await sleep(PAST_SHORT_MS);
    same(await ops.apiKeyRead({ keyId: issued.keyId }), null, 'read');
  }),
  attached('apiKeyRead.disabled', async ({ ops }) => {
    const userId = newUserId();
    const issued = await issueKey(ops, userId);
    const disabled = await ops.subjectDisable({ userId });
    same((await ops.apiKeyRead({ keyId: issued.keyId }))?.enabled, false, 'enabled');
    kind(await ops.subjectEnable({ userId, generation: disabled.generation }), 'done', 'enable');
    same((await ops.apiKeyRead({ keyId: issued.keyId }))?.enabled, true, 'enabled after enable');
  }),
  attached('apiKeyList.keys', async ({ ops }) => {
    const userId = newUserId();
    const first = await issueKey(ops, userId);
    const second = await issueKey(ops, userId, { expiresInMs: 60_000, scopes: ['notes:read', 'notes:write'] });
    await issueKey(ops, userId, { expiresInMs: SHORT_MS });
    await issueKey(ops, newUserId());
    await sleep(PAST_SHORT_MS);
    const listed = await ops.apiKeyList({ userId, limit: 1_000 });
    same(listed.kind, 'done', 'kind');
    deepFrozen(listed, 'result');
    same(listed.keys.length, 2, 'listed keys');
    const byId = new Map(listed.keys.map((info) => [info.keyId, info]));
    const one = byId.get(first.keyId);
    const two = byId.get(second.keyId);
    check(one !== undefined && two !== undefined, 'an unexpired key is missing from the list');
    same(one.name, `key ${first.keyId}`, 'name');
    same(one.createdAt, first.createdAt, 'createdAt');
    same(one.expiresAt, null, 'expiresAt');
    same(two.expiresAt, second.expiresAt, 'expiresAt of the expiring key');
    same(two.scopes.join(' '), 'notes:read notes:write', 'scopes');
  }),
  attached('apiKeyList.limit', async ({ ops }) => {
    const userId = newUserId();
    await Promise.all([issueKey(ops, userId), issueKey(ops, userId), issueKey(ops, userId)]);
    same((await ops.apiKeyList({ userId, limit: 2 })).keys.length, 2, 'listed keys');
  }),
  attached('apiKeyList.limit-bounds', async ({ ops }) => {
    const userId = newUserId();
    await issueKey(ops, userId);
    await rejectsWith(ops.apiKeyList({ userId, limit: 0 }), 'fault', 'no', 'limit 0');
    await rejectsWith(ops.apiKeyList({ userId, limit: 1_001 }), 'fault', 'no', 'limit 1,001');
  }),
  attached('apiKeyList.empty', async ({ ops }) => {
    const listed = await ops.apiKeyList({ userId: newUserId(), limit: 10 });
    same(listed.keys.length, 0, 'listed keys');
    deepFrozen(listed, 'result');
  }),
  attached('apiKeyRevoke.match', async ({ ops }) => {
    const userId = newUserId();
    const issued = await issueKey(ops, userId);
    const result = await ops.apiKeyRevoke({ userId, keyId: issued.keyId });
    same(result.revoked, true, 'revoked');
    deepFrozen(result, 'result');
    same(await ops.apiKeyRead({ keyId: issued.keyId }), null, 'read');
  }),
  attached('apiKeyRevoke.other-subject', async ({ ops }) => {
    const issued = await issueKey(ops, newUserId());
    same((await ops.apiKeyRevoke({ userId: newUserId(), keyId: issued.keyId })).revoked, false, 'revoked');
    check((await ops.apiKeyRead({ keyId: issued.keyId })) !== null, "another subject's revoke deleted the key");
  }),
  attached('apiKeyRevoke.absent', async ({ ops }) => {
    same((await ops.apiKeyRevoke({ userId: newUserId(), keyId: newKeyId() })).revoked, false, 'revoked');
  }),
];

const limitAndAttemptCases: Case[] = [
  attached('limitCharge.first', async ({ ops }) => {
    const charged = kind(await ops.limitCharge({ key: newDigest(), max: 5, windowMs: 60_000 }), 'done', 'charge');
    same(charged.count, 1, 'count');
    same(charged.resetAt, charged.now + 60_000, 'resetAt');
    deepFrozen(charged, 'result');
  }),
  attached('limitCharge.counts', async ({ ops }) => {
    const key = newDigest();
    const first = kind(await ops.limitCharge({ key, max: 5, windowMs: 60_000 }), 'done', 'first');
    const second = kind(await ops.limitCharge({ key, max: 5, windowMs: 60_000 }), 'done', 'second');
    const third = kind(await ops.limitCharge({ key, max: 5, windowMs: 60_000 }), 'done', 'third');
    same(`${first.count},${second.count},${third.count}`, '1,2,3', 'counts');
    same(third.resetAt, first.resetAt, 'resetAt');
  }),
  attached('limitCharge.limit', async ({ ops }) => {
    const key = newDigest();
    await ops.limitCharge({ key, max: 2, windowMs: 60_000 });
    const second = kind(await ops.limitCharge({ key, max: 2, windowMs: 60_000 }), 'done', 'second');
    const refused = await ops.limitCharge({ key, max: 2, windowMs: 60_000 });
    lostWith(refused, 'limit', 'third');
    deepFrozen(refused, 'result');
    check('retryAfterMs' in refused, 'retryAfterMs is missing');
    same(refused.retryAfterMs, second.resetAt - refused.now, 'retryAfterMs');
    lostWith(await ops.limitCharge({ key, max: 2, windowMs: 60_000 }), 'limit', 'fourth');
  }),
  attached('limitCharge.after-cleanup', async ({ ops }) => {
    const key = newDigest();
    await ops.limitCharge({ key, max: 1, windowMs: SHORT_MS });
    await sleep(PAST_SHORT_MS);
    same((await ops.expiredRemove({ limit: 1_000 })).removed, 1, 'expired window removed');
    const charged = kind(await ops.limitCharge({ key, max: 1, windowMs: 60_000 }), 'done', 'charge');
    same(charged.count, 1, 'count');
    same(charged.resetAt, charged.now + 60_000, 'resetAt');
  }),
  attached('limitCharge.restart', async ({ ops }) => {
    const key = newDigest();
    await ops.limitCharge({ key, max: 1, windowMs: SHORT_MS });
    await sleep(PAST_SHORT_MS);
    const restarted = kind(await ops.limitCharge({ key, max: 1, windowMs: SHORT_MS }), 'done', 'charge');
    same(restarted.count, 1, 'count');
    same(restarted.resetAt, restarted.now + SHORT_MS, 'resetAt');
  }),
  attached('attemptCreate.done', async ({ ops }) => {
    const created = await ops.attemptCreate(attemptInput(newDigest(), newDigest(), 600_000));
    same(created.kind, 'done', 'kind');
    same(created.expiresAt, created.now + 600_000, 'expiresAt');
    deepFrozen(created, 'result');
  }),
  attached('attemptCreate.repeated-state', async ({ ops, events }) => {
    const state = newDigest();
    const binding = newDigest();
    await ops.attemptCreate(attemptInput(state, binding));
    await rejectsWith(
      ops.attemptCreate({ ...attemptInput(state, newDigest()), nonce: 'other' }),
      'fault',
      'no',
      'repeat',
    );
    same(events.length, 0, 'onFailure calls for a rejected operation');
    const consumed = kind(await ops.attemptConsume({ state, binding, provider: 'local' }), 'done', 'consume');
    same(consumed.nonce, 'nonce-value', 'the first attempt was kept');
  }),
  attached('attemptConsume.done', async ({ ops }) => {
    const state = newDigest();
    const binding = newDigest();
    await ops.attemptCreate(attemptInput(state, binding));
    const consumed = kind(await ops.attemptConsume({ state, binding, provider: 'local' }), 'done', 'consume');
    same(consumed.nonce, 'nonce-value', 'nonce');
    same(consumed.verifier, 'verifier-value', 'verifier');
    same(consumed.returnPath, '/home', 'returnPath');
    deepFrozen(consumed, 'result');
    lostWith(await ops.attemptConsume({ state, binding, provider: 'local' }), 'gone', 'second consume');
  }),
  attached('attemptConsume.absent', async ({ ops }) => {
    lostWith(
      await ops.attemptConsume({ state: newDigest(), binding: newDigest(), provider: 'local' }),
      'gone',
      'consume',
    );
  }),
  attached('attemptConsume.expired', async ({ ops }) => {
    const state = newDigest();
    const binding = newDigest();
    await ops.attemptCreate(attemptInput(state, binding, SHORT_MS));
    await sleep(PAST_SHORT_MS);
    lostWith(await ops.attemptConsume({ state, binding, provider: 'local' }), 'gone', 'consume');
  }),
  attached('attemptConsume.expired-before-binding', async ({ ops }) => {
    const state = newDigest();
    await ops.attemptCreate(attemptInput(state, newDigest(), SHORT_MS));
    await sleep(PAST_SHORT_MS);
    lostWith(await ops.attemptConsume({ state, binding: newDigest(), provider: 'other' }), 'gone', 'consume');
    same((await ops.expiredRemove({ limit: 1_000 })).removed, 1, 'expired attempt left for cleanup');
  }),
  attached('attemptConsume.binding', async ({ ops }) => {
    const state = newDigest();
    const binding = newDigest();
    await ops.attemptCreate(attemptInput(state, binding));
    lostWith(await ops.attemptConsume({ state, binding: newDigest(), provider: 'local' }), 'binding', 'consume');
    kind(await ops.attemptConsume({ state, binding, provider: 'local' }), 'done', 'consume after a refused one');
  }),
  attached('attemptConsume.provider', async ({ ops }) => {
    const state = newDigest();
    const binding = newDigest();
    await ops.attemptCreate(attemptInput(state, binding));
    lostWith(await ops.attemptConsume({ state, binding, provider: 'other' }), 'binding', 'consume');
    kind(await ops.attemptConsume({ state, binding, provider: 'local' }), 'done', 'consume after a refused one');
  }),
  attached('expiredRemove.limit-bounds', async ({ ops }) => {
    await issueSession(ops, { idleMs: SHORT_MS });
    await sleep(PAST_SHORT_MS);
    await rejectsWith(ops.expiredRemove({ limit: 0 }), 'fault', 'no', 'limit 0');
    await rejectsWith(ops.expiredRemove({ limit: 1_001 }), 'fault', 'no', 'limit 1,001');
    same((await ops.expiredRemove({ limit: 1_000 })).removed, 1, 'expired rows left by the refused passes');
  }),
  attached('expiredRemove.bounded', async ({ ops }) => {
    const live = await issueSession(ops);
    const expired = await issueSession(ops, { idleMs: SHORT_MS, absoluteMs: SHORT_MS });
    await issueKey(ops, newUserId(), { expiresInMs: SHORT_MS });
    await ops.limitCharge({ key: newDigest(), max: 5, windowMs: SHORT_MS });
    await ops.attemptCreate(attemptInput(newDigest(), newDigest(), SHORT_MS));
    await sleep(PAST_SHORT_MS);
    const first = await ops.expiredRemove({ limit: 3 });
    same(first.removed, 3, 'removed with limit 3');
    deepFrozen(first, 'result');
    same((await ops.expiredRemove({ limit: 1_000 })).removed, 1, 'removed by the second pass');
    same((await ops.expiredRemove({ limit: 1_000 })).removed, 0, 'removed by the third pass');
    check((await ops.sessionRead({ digest: live.digest })) !== null, 'a live session was removed');
    check((await ops.subjectRead({ userId: expired.userId })) !== null, 'a subject was removed');
  }),
];

const raceCases: Case[] = [
  attached('sessionIssue.concurrent', async ({ ops }) => {
    const userId = newUserId();
    await ops.subjectEnsure({ userId });
    const digests = Array.from({ length: RACE }, () => newDigest());
    const results = await Promise.all(
      digests.map((digest) =>
        ops.sessionIssue({ userId, generation: 1, digest, replaces: null, idleMs: LONG_MS, absoluteMs: LONG_MS }),
      ),
    );
    same(
      count(results, (result) => result.kind === 'done'),
      RACE,
      'done',
    );
    const reads = await Promise.all(digests.map((digest) => ops.sessionRead({ digest })));
    same(
      count(reads, (read) => read !== null),
      RACE,
      'readable sessions',
    );
  }),
  attached('sessionIssue.concurrent-invalidate', async ({ ops }) => {
    const userId = newUserId();
    await ops.subjectEnsure({ userId });
    const digests = Array.from({ length: RACE }, () => newDigest());
    const issue = (digest: Digest) =>
      ops.sessionIssue({ userId, generation: 1, digest, replaces: null, idleMs: LONG_MS, absoluteMs: LONG_MS });
    const before = digests.slice(0, RACE / 2).map(issue);
    const invalidated = ops.subjectInvalidate({ userId });
    const after = digests.slice(RACE / 2).map(issue);
    const results = await Promise.all([...before, ...after]);
    const { revoked, generation } = await invalidated;
    same(generation, 2, 'generation');
    const done = count(results, (result) => result.kind === 'done');
    check(
      results.every((result) => result.kind === 'done' || (result.kind === 'lost' && result.reason === 'stale')),
      'an issue answered other than done or stale',
    );
    same(revoked, done, 'sessions revoked against sessions issued before the invalidation');
    const reads = await Promise.all(digests.map((digest) => ops.sessionRead({ digest })));
    same(
      count(reads, (read) => read !== null),
      0,
      'sessions of the old generation still live',
    );
  }),
  attached('sessionRotate.concurrent', async ({ ops }) => {
    const live = await issueSession(ops);
    const nexts = Array.from({ length: RACE }, () => newDigest());
    const results = await Promise.all(
      nexts.map((next) => ops.sessionRotate({ userId: live.userId, digest: live.digest, next, idleMs: LONG_MS })),
    );
    same(
      count(results, (result) => result.kind === 'done'),
      1,
      'done',
    );
    same(
      count(results, (result) => result.kind === 'lost' && result.reason === 'gone'),
      RACE - 1,
      'gone',
    );
    const reads = await Promise.all(nexts.map((next) => ops.sessionRead({ digest: next })));
    same(
      count(reads, (read) => read !== null),
      1,
      'live successors',
    );
    const winner = results.findIndex((result) => result.kind === 'done');
    check(reads[winner] !== null, 'the live successor is not the winner');
    same(await ops.sessionRead({ digest: live.digest }), null, 'old session');
  }),
  attached('attemptConsume.concurrent', async ({ ops }) => {
    const state = newDigest();
    const binding = newDigest();
    await ops.attemptCreate(attemptInput(state, binding));
    const results = await Promise.all(
      Array.from({ length: RACE }, () => ops.attemptConsume({ state, binding, provider: 'local' })),
    );
    same(
      count(results, (result) => result.kind === 'done'),
      1,
      'done',
    );
    same(
      count(results, (result) => result.kind === 'lost' && result.reason === 'gone'),
      RACE - 1,
      'gone',
    );
  }),
  attached('apiKeyIssue.concurrent', async ({ ops }) => {
    const userId = newUserId();
    const results = await Promise.all(
      Array.from({ length: RACE }, () =>
        ops.apiKeyIssue({
          userId,
          keyId: newKeyId(),
          digest: newDigest(),
          name: 'race',
          scopes: ['notes:read'],
          expiresInMs: null,
          max: 5,
        }),
      ),
    );
    same(
      count(results, (result) => result.kind === 'done'),
      5,
      'done',
    );
    same(
      count(results, (result) => result.kind === 'lost' && result.reason === 'limit'),
      RACE - 5,
      'limit',
    );
    same((await ops.apiKeyList({ userId, limit: 1_000 })).keys.length, 5, 'listed keys');
  }),
  attached('limitCharge.concurrent', async ({ ops }) => {
    const key = newDigest();
    await ops.limitCharge({ key, max: 10, windowMs: LONG_MS });
    const results = await Promise.all(
      Array.from({ length: RACE }, () => ops.limitCharge({ key, max: 10, windowMs: LONG_MS })),
    );
    const counts = results.flatMap((result) => (result.kind === 'done' ? [result.count] : []));
    same(sorted(counts), sequence(2, 10), 'counts granted');
    same(
      count(results, (result) => result.kind === 'lost'),
      RACE - 9,
      'limit',
    );
  }),
  attached('subjectEnsure.absent-race', async ({ ops }) => {
    const userId = newUserId();
    const results = await Promise.all(Array.from({ length: RACE }, () => ops.subjectEnsure({ userId })));
    check(
      results.every((result) => result.enabled && result.generation === 1),
      'a concurrent ensure answered other than enabled at generation 1',
    );
  }),
  attached('subjectDisable.absent-race', async ({ ops }) => {
    const userId = newUserId();
    const results = await Promise.all(Array.from({ length: RACE }, () => ops.subjectDisable({ userId })));
    same(sorted(results.map((result) => result.generation)), sequence(2, RACE + 1), 'generations');
    const read = await ops.subjectRead({ userId });
    same(read?.generation, RACE + 1, 'final generation');
    same(read?.enabled, false, 'enabled');
  }),
  attached('subjectInvalidate.absent-race', async ({ ops }) => {
    const userId = newUserId();
    const results = await Promise.all(Array.from({ length: RACE }, () => ops.subjectInvalidate({ userId })));
    same(sorted(results.map((result) => result.generation)), sequence(2, RACE + 1), 'generations');
    const read = await ops.subjectRead({ userId });
    same(read?.generation, RACE + 1, 'final generation');
    same(read?.enabled, true, 'enabled');
  }),
  attached('subjectEnable.concurrent', async ({ ops }) => {
    const userId = newUserId();
    const { generation } = await ops.subjectDisable({ userId });
    const results = await Promise.all(Array.from({ length: RACE }, () => ops.subjectEnable({ userId, generation })));
    const winners = results.flatMap((result) => (result.kind === 'done' ? [result.generation] : []));
    same(winners.length, 1, 'callers answered done');
    same(winners[0], generation + 1, 'generation');
    same(
      count(results, (result) => result.kind === 'lost' && result.reason === 'enabled'),
      RACE - 1,
      'callers answered lost (enabled)',
    );
    const read = await ops.subjectRead({ userId });
    same(read?.enabled, true, 'read enabled');
    same(read?.generation, generation + 1, 'read generation');
  }),
  attached('subjectEnable.absent-race', async ({ ops }) => {
    const userId = newUserId();
    const half = RACE / 2;
    const results = await Promise.all(
      Array.from({ length: RACE }, (_, index) =>
        index % 2 === 0 ? ops.subjectDisable({ userId }) : ops.subjectEnable({ userId, generation: 2 }),
      ),
    );
    const enables = results.filter((_, index) => index % 2 === 1);
    const raised = results.flatMap((result) => (result.kind === 'done' ? [result.generation] : []));
    const enabled = count(enables, (result) => result.kind === 'done');
    check(enabled <= 1, `${enabled} callers enabled at one generation`);
    check(
      enables.every((result) => result.kind === 'done' || ['absent', 'enabled', 'stale'].includes(result.reason)),
      'an enable answered a reason outside absent, enabled and stale',
    );
    same(sorted(raised), sequence(2, half + enabled + 1), 'generations answered');
    const read = await ops.subjectRead({ userId });
    same(read?.generation, half + enabled + 1, 'final generation');
    const last = results.find((result) => result.kind === 'done' && result.generation === half + enabled + 1);
    same(read?.enabled, last !== undefined && enables.includes(last), 'final enabled');
  }),
  attached('limitCharge.cleanup-race', async ({ ops }) => {
    const key = newDigest();
    await ops.limitCharge({ key, max: 10, windowMs: SHORT_MS });
    await sleep(PAST_SHORT_MS);
    const charges = Array.from({ length: RACE }, (_, index) =>
      index % 4 === 0
        ? ops.expiredRemove({ limit: 1_000 }).then(() => ops.limitCharge({ key, max: 10, windowMs: LONG_MS }))
        : ops.limitCharge({ key, max: 10, windowMs: LONG_MS }),
    );
    const results = await Promise.all(charges);
    const counts = results.flatMap((result) => (result.kind === 'done' ? [result.count] : []));
    same(sorted(counts), sequence(1, 10), 'counts granted');
    same(
      count(results, (result) => result.kind === 'lost'),
      RACE - 10,
      'limit',
    );
  }),
  attached('limitCharge.absent-race', async ({ ops }) => {
    const key = newDigest();
    const results = await Promise.all(
      Array.from({ length: RACE }, () => ops.limitCharge({ key, max: 100, windowMs: LONG_MS })),
    );
    const counts = results.flatMap((result) => (result.kind === 'done' ? [result.count] : []));
    same(sorted(counts), sequence(1, RACE), 'counts granted');
  }),
];

const lockCases: Case[] = [
  locked('sessionRenew.expires-while-locked', async (context) => {
    const live = await issueSession(context.ops, { idleMs: SHORT_MS });
    const result = await expectBlocked(
      holder(context)('sessions', live.digest, HOLD_MS),
      () => context.ops.sessionRenew({ digest: live.digest, idleMs: LONG_MS }),
      'renew',
    );
    lostWith(result, 'gone', 'renew');
  }),
  locked('sessionRotate.expires-while-locked', async (context) => {
    const live = await issueSession(context.ops, { idleMs: SHORT_MS });
    const next = newDigest();
    const result = await expectBlocked(
      holder(context)('sessions', live.digest, HOLD_MS),
      () => context.ops.sessionRotate({ userId: live.userId, digest: live.digest, next, idleMs: LONG_MS }),
      'rotate',
    );
    lostWith(result, 'gone', 'rotate');
    same(await context.ops.sessionRead({ digest: next }), null, 'next session');
  }),
  locked('attemptConsume.expires-while-locked', async (context) => {
    const state = newDigest();
    const binding = newDigest();
    await context.ops.attemptCreate(attemptInput(state, binding, SHORT_MS));
    const result = await expectBlocked(
      holder(context)('oidc_attempts', state, HOLD_MS),
      () => context.ops.attemptConsume({ state, binding, provider: 'local' }),
      'consume',
    );
    lostWith(result, 'gone', 'consume');
  }),
  locked('limitCharge.expires-while-locked', async (context) => {
    const key = newDigest();
    await context.ops.limitCharge({ key, max: 1, windowMs: SHORT_MS });
    const result = await expectBlocked(
      holder(context)('limit_windows', key, HOLD_MS),
      () => context.ops.limitCharge({ key, max: 1, windowMs: SHORT_MS }),
      'charge',
    );
    same(kind(result, 'done', 'charge').count, 1, 'count of the restarted window');
  }),
  locked('apiKeyIssue.expires-while-locked', async (context) => {
    const userId = newUserId();
    await issueKey(context.ops, userId, { max: 1, expiresInMs: SHORT_MS });
    const result = await expectBlocked(
      holder(context)('subjects', userId, HOLD_MS),
      () =>
        context.ops.apiKeyIssue({
          userId,
          keyId: newKeyId(),
          digest: newDigest(),
          name: 'second',
          scopes: ['notes:read'],
          expiresInMs: null,
          max: 1,
        }),
      'issue',
    );
    kind(result, 'done', 'issue after the first key expired while waiting');
  }),
  locked('subjectEnsure.waits-for-lock', async (context) => {
    const userId = newUserId();
    await context.ops.subjectEnsure({ userId });
    const result = await expectBlocked(
      holder(context)('subjects', userId, HOLD_MS),
      () => context.ops.subjectEnsure({ userId }),
      'ensure',
    );
    same(result.generation, 1, 'generation');
  }),
  {
    name: 'expiredRemove.skips-locked',
    setup: 'attached',
    needs: 'row-lock',
    run: async (context) => {
      const held = await issueSession(context.ops, { idleMs: SHORT_MS });
      await context.ops.attemptCreate(attemptInput(newDigest(), newDigest(), SHORT_MS));
      await sleep(PAST_SHORT_MS);
      const first = await expectUnblocked(
        holder(context)('sessions', held.digest, HOLD_MS),
        () => context.ops.expiredRemove({ limit: 1_000 }),
        'remove',
      );
      same(first.removed, 1, 'removed beside the held row');
      await sleep(HOLD_MS);
      same((await context.ops.expiredRemove({ limit: 1_000 })).removed, 1, 'held row removed by a later pass');
    },
  },
  locked('close.outstanding', async (context) => {
    const live = await issueSession(context.ops);
    await holder(context)('sessions', live.digest, HOLD_MS);
    const settled: true[] = [];
    const callers = Array.from({ length: RACE }, () =>
      context.ops.sessionRenew({ digest: live.digest, idleMs: LONG_MS }).then(
        (result) => {
          settled.push(true);
          return result.kind === 'done' ? null : `answered ${result.kind}`;
        },
        (error: unknown) => {
          settled.push(true);
          return error instanceof StoreFailure && error.reason === 'unavailable' && error.applied === 'no'
            ? null
            : `rejected ${describe(error)}`;
        },
      ),
    );
    await sleep(20);
    const started = performance.now();
    await context.store.close();
    const closed = performance.now();
    // Why: A caller's answer reaches this case a few promise jobs after the adapter settles it, so one turn is allowed.
    await setImmediate();
    const settledAtClose = settled.length;
    const answers = await Promise.all(callers);
    const wrong = answers.filter((answer) => answer !== null);
    check(wrong.length === 0, `callers answered other than done or unavailable: ${wrong.join('; ')}`);
    same(settledAtClose, RACE, 'callers settled when close resolved');
    check(closed - started <= 5_500, `close took ${Math.round(closed - started)} ms`);
  }),
  locked('subjectRead.no-lock-wait', async (context) => {
    const userId = newUserId();
    await context.ops.subjectEnsure({ userId });
    const read = await expectUnblocked(
      holder(context)('subjects', userId, HOLD_MS),
      () => context.ops.subjectRead({ userId }),
      'read',
    );
    same(read?.generation, 1, 'generation');
  }),
  locked('sessionRead.no-lock-wait', async (context) => {
    const live = await issueSession(context.ops);
    const read = await expectUnblocked(
      holder(context)('sessions', live.digest, HOLD_MS),
      () => context.ops.sessionRead({ digest: live.digest }),
      'read',
    );
    same(read?.userId, live.userId, 'userId');
  }),
  locked('apiKeyRead.no-lock-wait', async (context) => {
    const userId = newUserId();
    const issued = await issueKey(context.ops, userId);
    const read = await expectUnblocked(
      holder(context)('api_keys', issued.keyId, HOLD_MS),
      () => context.ops.apiKeyRead({ keyId: issued.keyId }),
      'read',
    );
    same(read?.userId, userId, 'userId');
  }),
];

export const cases: readonly Case[] = [
  ...installCases,
  ...subjectCases,
  ...sessionCases,
  ...apiKeyCases,
  ...limitAndAttemptCases,
  ...raceCases,
  ...lockCases,
  ...everyOperation(),
];
