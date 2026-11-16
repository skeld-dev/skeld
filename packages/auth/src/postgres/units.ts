// Does:  Implements installation, the version read and the store's 18 operations as PostgreSQL units.
// Holds: A unit reads clock_timestamp() once, after the locks of every row it judges; each lock is its own statement.

import { timingSafeEqual } from 'node:crypto';
import { count } from '#diag';
import type { ApiKeyInfo } from '../api-key/types.ts';
import { postgresSchema, SCHEMA_VERSION } from '../store/schema.ts';
import { StoreFailure } from '../store/store.ts';
import type { AttachResult, InstallResult, StoreOperations } from '../store/types.ts';
import {
  affected,
  bool,
  boolOrNull,
  digest,
  first,
  int,
  intOrNull,
  isNull,
  RecordError,
  scopes,
  text,
} from './rows.ts';
import type { Runner, Tx } from './runner.ts';

type Input<K extends keyof StoreOperations> = Parameters<StoreOperations[K]>[0];
type Output<K extends keyof StoreOperations> = Awaited<ReturnType<StoreOperations[K]>>;

// Why: clock_timestamp() is read when the statement runs; now() is the transaction's start and misses a lock wait.
const CLOCK = 'floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint';
const READ_CLOCK = `SELECT ${CLOCK} AS now`;

const VERSION_TABLE = "SELECT to_regclass('skeld_auth.schema_version') IS NOT NULL AS present";
const VERSION = 'SELECT version FROM skeld_auth.schema_version';

const SUBJECT_ENSURE =
  'INSERT INTO skeld_auth.subjects (user_id, enabled, generation) VALUES ($1, true, 1) ON CONFLICT (user_id) DO NOTHING';
const SUBJECT_SHARE = 'SELECT enabled, generation FROM skeld_auth.subjects WHERE user_id = $1 FOR SHARE';
const SUBJECT_UPDATE = 'SELECT enabled, generation FROM skeld_auth.subjects WHERE user_id = $1 FOR UPDATE';
const SUBJECT_READ =
  `SELECT c.now, s.enabled, s.generation FROM (SELECT ${CLOCK} AS now) c ` +
  'LEFT JOIN skeld_auth.subjects s ON s.user_id = $1';
const SUBJECT_DISABLE =
  'UPDATE skeld_auth.subjects SET enabled = false, generation = generation + 1 WHERE user_id = $1 RETURNING generation';
const SUBJECT_ENABLE =
  'UPDATE skeld_auth.subjects SET enabled = true, generation = generation + 1 WHERE user_id = $1 RETURNING generation';
const SUBJECT_INVALIDATE =
  'UPDATE skeld_auth.subjects SET generation = generation + 1 WHERE user_id = $1 RETURNING generation';

const SESSION_LOCK =
  'SELECT user_id, created_at, absolute_expires_at, expires_at FROM skeld_auth.sessions WHERE digest = $1 FOR UPDATE';
const SESSION_READ =
  `SELECT c.now, s.user_id, s.created_at, s.last_seen_at, s.expires_at, s.absolute_expires_at FROM (SELECT ${CLOCK} ` +
  'AS now) c LEFT JOIN skeld_auth.sessions s ON s.digest = $1 AND s.expires_at > c.now';
const SESSION_INSERT =
  'INSERT INTO skeld_auth.sessions (digest, user_id, created_at, last_seen_at, absolute_expires_at, expires_at) ' +
  'VALUES ($1, $2, $3, $4, $5, $6)';
const SESSION_RENEW = 'UPDATE skeld_auth.sessions SET last_seen_at = $2, expires_at = $3 WHERE digest = $1';
const SESSION_DELETE = 'DELETE FROM skeld_auth.sessions WHERE digest = $1';
const SESSIONS_OF_SUBJECT_DELETE = 'DELETE FROM skeld_auth.sessions WHERE user_id = $1';

const KEY_LOCK = 'SELECT user_id FROM skeld_auth.api_keys WHERE key_id = $1 FOR UPDATE';
const KEY_COUNT =
  'SELECT count(*) AS n FROM skeld_auth.api_keys WHERE user_id = $1 AND (expires_at IS NULL OR expires_at > $2)';
const KEY_INSERT =
  'INSERT INTO skeld_auth.api_keys (key_id, user_id, digest, name, scopes, created_at, expires_at) ' +
  'VALUES ($1, $2, $3, $4, $5, $6, $7)';
const KEY_READ =
  `SELECT c.now, k.user_id, k.digest, k.scopes, k.expires_at, s.enabled FROM (SELECT ${CLOCK} AS now) c ` +
  'LEFT JOIN skeld_auth.api_keys k ON k.key_id = $1 AND (k.expires_at IS NULL OR k.expires_at > c.now) ' +
  'LEFT JOIN skeld_auth.subjects s ON s.user_id = k.user_id';
const KEY_LIST =
  `SELECT c.now, k.key_id, k.name, k.scopes, k.created_at, k.expires_at FROM (SELECT ${CLOCK} AS now) c ` +
  'LEFT JOIN LATERAL (SELECT key_id, name, scopes, created_at, expires_at FROM skeld_auth.api_keys ' +
  'WHERE user_id = $1 AND (expires_at IS NULL OR expires_at > c.now) LIMIT $2) k ON true';
const KEY_DELETE = 'DELETE FROM skeld_auth.api_keys WHERE key_id = $1';

const WINDOW_ENSURE =
  'INSERT INTO skeld_auth.limit_windows (key, window_start, count, expires_at) VALUES ($1, 0, 0, 0) ' +
  'ON CONFLICT (key) DO NOTHING';
const WINDOW_LOCK = 'SELECT count, expires_at FROM skeld_auth.limit_windows WHERE key = $1 FOR UPDATE';
const WINDOW_RESTART =
  'UPDATE skeld_auth.limit_windows SET window_start = $2, count = 1, expires_at = $3 WHERE key = $1';
const WINDOW_COUNT = 'UPDATE skeld_auth.limit_windows SET count = $2 WHERE key = $1';

const ATTEMPT_INSERT =
  'INSERT INTO skeld_auth.oidc_attempts (state_digest, binding_digest, provider, nonce, verifier, return_path, ' +
  'expires_at) VALUES ($1, $2, $3, $4, $5, $6, $7)';
const ATTEMPT_LOCK =
  'SELECT binding_digest, provider, nonce, verifier, return_path, expires_at FROM skeld_auth.oidc_attempts ' +
  'WHERE state_digest = $1 FOR UPDATE';
const ATTEMPT_DELETE = 'DELETE FROM skeld_auth.oidc_attempts WHERE state_digest = $1';

// Why: A cleanup pass never waits on a row a unit holds; a skipped row is judged again on the next pass.
const CLEANUP: readonly (readonly [table: string, statement: string])[] = [
  [
    'sessions',
    'DELETE FROM skeld_auth.sessions WHERE digest IN (SELECT digest FROM skeld_auth.sessions ' +
      'WHERE expires_at <= $1 ORDER BY expires_at LIMIT $2 FOR UPDATE SKIP LOCKED)',
  ],
  [
    'api_keys',
    'DELETE FROM skeld_auth.api_keys WHERE key_id IN (SELECT key_id FROM skeld_auth.api_keys ' +
      'WHERE expires_at <= $1 ORDER BY expires_at LIMIT $2 FOR UPDATE SKIP LOCKED)',
  ],
  [
    'limit_windows',
    'DELETE FROM skeld_auth.limit_windows WHERE key IN (SELECT key FROM skeld_auth.limit_windows ' +
      'WHERE expires_at <= $1 ORDER BY expires_at LIMIT $2 FOR UPDATE SKIP LOCKED)',
  ],
  [
    'oidc_attempts',
    'DELETE FROM skeld_auth.oidc_attempts WHERE state_digest IN (SELECT state_digest FROM skeld_auth.oidc_attempts ' +
      'WHERE expires_at <= $1 ORDER BY expires_at LIMIT $2 FOR UPDATE SKIP LOCKED)',
  ],
];

const MAX_LIMIT = 1_000;

function withinLimit(limit: number): boolean {
  return Number.isSafeInteger(limit) && limit >= 1 && limit <= MAX_LIMIT;
}

async function clock(tx: Tx): Promise<number> {
  return int(first((await tx.query(READ_CLOCK)).rows), 'now');
}

async function lockSubject(tx: Tx, statement: string, userId: string): Promise<unknown> {
  await tx.query(SUBJECT_ENSURE, [userId]);
  return first((await tx.query(statement, [userId])).rows);
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  return a.byteLength === b.byteLength && timingSafeEqual(a, b);
}

// Does:  Reads the version row; null when the schema has not been installed.
async function readVersion(tx: Tx): Promise<number | null> {
  if (!bool(first((await tx.query(VERSION_TABLE)).rows), 'present')) {
    return null;
  }
  const { rows } = await tx.query(VERSION);
  if (rows.length !== 1) {
    throw new RecordError('schema_version holds other than one row');
  }
  return int(rows[0], 'version');
}

export async function install(run: Runner): Promise<InstallResult> {
  const judge = (found: number): InstallResult =>
    Object.freeze(found === SCHEMA_VERSION ? { kind: 'current' } : { kind: 'mismatch', found });
  try {
    return await run.write('install', undefined, async (tx) => {
      const found = await readVersion(tx);
      if (found !== null) {
        return judge(found);
      }
      for (const statement of postgresSchema) {
        // biome-ignore lint/performance/noAwaitInLoops: one connection runs the schema statements in their order.
        await tx.query(statement);
      }
      return Object.freeze({ kind: 'installed' });
    });
  } catch (error) {
    // Why: A concurrent install that committed first fails this one with 23505 or 42P07; the version then settles it.
    if (!(error instanceof StoreFailure) || error.applied !== 'no') {
      throw error;
    }
    const settled = await run.write('install', undefined, async (tx) => {
      const found = await readVersion(tx);
      return found === null ? { kind: 'absent' as const } : judge(found);
    });
    if (settled.kind === 'absent') {
      throw error;
    }
    return settled;
  }
}

export function attachVersion(run: Runner): Promise<AttachResult> {
  return run.write('attach', undefined, async (tx) => {
    const found = await readVersion(tx);
    if (found === null) {
      return Object.freeze({ kind: 'not_installed' });
    }
    return Object.freeze(found === SCHEMA_VERSION ? { kind: 'attached' } : { kind: 'mismatch', found });
  });
}

export function subjectEnsure(
  run: Runner,
  { userId }: Input<'subjectEnsure'>,
  signal?: AbortSignal,
): Promise<Output<'subjectEnsure'>> {
  return run.write('subjectEnsure', signal, async (tx) => {
    const row = await lockSubject(tx, SUBJECT_SHARE, userId);
    const now = await clock(tx);
    return Object.freeze({ kind: 'done', now, enabled: bool(row, 'enabled'), generation: int(row, 'generation') });
  });
}

export function subjectRead(
  run: Runner,
  { userId }: Input<'subjectRead'>,
  signal?: AbortSignal,
): Promise<Output<'subjectRead'>> {
  return run.read('subjectRead', signal, SUBJECT_READ, [userId], (rows) => {
    const row = first(rows);
    const enabled = boolOrNull(row, 'enabled');
    if (enabled === null) {
      return null;
    }
    return Object.freeze({ enabled, generation: int(row, 'generation'), now: int(row, 'now') });
  });
}

function raiseGeneration(
  run: Runner,
  operation: 'subjectDisable' | 'subjectInvalidate',
  userId: string,
  signal: AbortSignal | undefined,
): Promise<Output<'subjectInvalidate'>> {
  return run.write(operation, signal, async (tx) => {
    const row = await lockSubject(tx, SUBJECT_UPDATE, userId);
    const now = await clock(tx);
    const statement = operation === 'subjectDisable' ? SUBJECT_DISABLE : SUBJECT_INVALIDATE;
    const generation = int(first((await tx.query(statement, [userId])).rows), 'generation');
    const revoked = affected((await tx.query(SESSIONS_OF_SUBJECT_DELETE, [userId])).rowCount);
    return Object.freeze({ kind: 'done', now, enabled: bool(row, 'enabled'), generation, revoked });
  });
}

export async function subjectDisable(
  run: Runner,
  { userId }: Input<'subjectDisable'>,
  signal?: AbortSignal,
): Promise<Output<'subjectDisable'>> {
  const { now, generation, revoked } = await raiseGeneration(run, 'subjectDisable', userId, signal);
  return Object.freeze({ kind: 'done', now, generation, revoked });
}

export function subjectInvalidate(
  run: Runner,
  { userId }: Input<'subjectInvalidate'>,
  signal?: AbortSignal,
): Promise<Output<'subjectInvalidate'>> {
  return raiseGeneration(run, 'subjectInvalidate', userId, signal);
}

export function subjectEnable(
  run: Runner,
  input: Input<'subjectEnable'>,
  signal?: AbortSignal,
): Promise<Output<'subjectEnable'>> {
  return run.write('subjectEnable', signal, async (tx) => {
    const subject = (await tx.query(SUBJECT_UPDATE, [input.userId])).rows[0];
    const now = await clock(tx);
    if (subject === undefined) {
      return Object.freeze({ kind: 'lost', reason: 'absent', now });
    }
    if (bool(subject, 'enabled')) {
      return Object.freeze({ kind: 'lost', reason: 'enabled', now });
    }
    if (int(subject, 'generation') !== input.generation) {
      return Object.freeze({ kind: 'lost', reason: 'stale', now });
    }
    const generation = int(first((await tx.query(SUBJECT_ENABLE, [input.userId])).rows), 'generation');
    const revoked = affected((await tx.query(SESSIONS_OF_SUBJECT_DELETE, [input.userId])).rowCount);
    return Object.freeze({ kind: 'done', now, generation, revoked });
  });
}

export function sessionIssue(
  run: Runner,
  input: Input<'sessionIssue'>,
  signal?: AbortSignal,
): Promise<Output<'sessionIssue'>> {
  return run.write('sessionIssue', signal, async (tx) => {
    const subject = (await tx.query(SUBJECT_SHARE, [input.userId])).rows[0];
    if (input.replaces !== null) {
      await tx.query(SESSION_LOCK, [input.replaces]);
    }
    const now = await clock(tx);
    if (subject === undefined) {
      return Object.freeze({ kind: 'lost', reason: 'stale', now });
    }
    if (!bool(subject, 'enabled')) {
      return Object.freeze({ kind: 'lost', reason: 'disabled', now });
    }
    if (int(subject, 'generation') !== input.generation) {
      return Object.freeze({ kind: 'lost', reason: 'stale', now });
    }
    if (input.replaces !== null) {
      await tx.query(SESSION_DELETE, [input.replaces]);
    }
    const absoluteExpiresAt = now + input.absoluteMs;
    const expiresAt = now + Math.min(input.idleMs, input.absoluteMs);
    await tx.query(SESSION_INSERT, [input.digest, input.userId, now, now, absoluteExpiresAt, expiresAt]);
    return Object.freeze({ kind: 'done', now, createdAt: now, expiresAt });
  });
}

export function sessionRead(
  run: Runner,
  input: Input<'sessionRead'>,
  signal?: AbortSignal,
): Promise<Output<'sessionRead'>> {
  return run.read('sessionRead', signal, SESSION_READ, [input.digest], (rows) => {
    const row = first(rows);
    if (isNull(row, 'user_id')) {
      return null;
    }
    return Object.freeze({
      userId: text(row, 'user_id'),
      createdAt: int(row, 'created_at'),
      lastSeenAt: int(row, 'last_seen_at'),
      expiresAt: int(row, 'expires_at'),
      absoluteExpiresAt: int(row, 'absolute_expires_at'),
      now: int(row, 'now'),
    });
  });
}

export function sessionRenew(
  run: Runner,
  input: Input<'sessionRenew'>,
  signal?: AbortSignal,
): Promise<Output<'sessionRenew'>> {
  return run.write('sessionRenew', signal, async (tx) => {
    const row = (await tx.query(SESSION_LOCK, [input.digest])).rows[0];
    const now = await clock(tx);
    if (row === undefined || int(row, 'expires_at') <= now) {
      return Object.freeze({ kind: 'lost', reason: 'gone', now });
    }
    const expiresAt = Math.min(now + input.idleMs, int(row, 'absolute_expires_at'));
    await tx.query(SESSION_RENEW, [input.digest, now, expiresAt]);
    return Object.freeze({ kind: 'done', now, expiresAt });
  });
}

export function sessionRotate(
  run: Runner,
  input: Input<'sessionRotate'>,
  signal?: AbortSignal,
): Promise<Output<'sessionRotate'>> {
  return run.write('sessionRotate', signal, async (tx) => {
    await tx.query(SUBJECT_SHARE, [input.userId]);
    const row = (await tx.query(SESSION_LOCK, [input.digest])).rows[0];
    const now = await clock(tx);
    if (row === undefined || text(row, 'user_id') !== input.userId || int(row, 'expires_at') <= now) {
      return Object.freeze({ kind: 'lost', reason: 'gone', now });
    }
    const createdAt = int(row, 'created_at');
    const absoluteExpiresAt = int(row, 'absolute_expires_at');
    const expiresAt = Math.min(now + input.idleMs, absoluteExpiresAt);
    await tx.query(SESSION_DELETE, [input.digest]);
    await tx.query(SESSION_INSERT, [input.next, input.userId, createdAt, now, absoluteExpiresAt, expiresAt]);
    return Object.freeze({ kind: 'done', now, createdAt, expiresAt, absoluteExpiresAt });
  });
}

export function sessionRevoke(
  run: Runner,
  input: Input<'sessionRevoke'>,
  signal?: AbortSignal,
): Promise<Output<'sessionRevoke'>> {
  return run.write('sessionRevoke', signal, async (tx) => {
    const row = (await tx.query(SESSION_LOCK, [input.digest])).rows[0];
    const now = await clock(tx);
    if (row === undefined) {
      return Object.freeze({ kind: 'done', now, revoked: false, userId: null });
    }
    await tx.query(SESSION_DELETE, [input.digest]);
    return Object.freeze({ kind: 'done', now, revoked: true, userId: text(row, 'user_id') });
  });
}

export function apiKeyIssue(
  run: Runner,
  input: Input<'apiKeyIssue'>,
  signal?: AbortSignal,
): Promise<Output<'apiKeyIssue'>> {
  return run.write('apiKeyIssue', signal, async (tx) => {
    const subject = await lockSubject(tx, SUBJECT_UPDATE, input.userId);
    const now = await clock(tx);
    if (!bool(subject, 'enabled')) {
      return Object.freeze({ kind: 'lost', reason: 'disabled', now });
    }
    if (int(first((await tx.query(KEY_COUNT, [input.userId, now])).rows), 'n') >= input.max) {
      return Object.freeze({ kind: 'lost', reason: 'limit', now });
    }
    const expiresAt = input.expiresInMs === null ? null : now + input.expiresInMs;
    await tx.query(KEY_INSERT, [
      input.keyId,
      input.userId,
      input.digest,
      input.name,
      input.scopes.join(' '),
      now,
      expiresAt,
    ]);
    return Object.freeze({ kind: 'done', now, createdAt: now, expiresAt });
  });
}

export function apiKeyRead(
  run: Runner,
  input: Input<'apiKeyRead'>,
  signal?: AbortSignal,
): Promise<Output<'apiKeyRead'>> {
  return run.read('apiKeyRead', signal, KEY_READ, [input.keyId], (rows) => {
    const row = first(rows);
    if (isNull(row, 'user_id')) {
      return null;
    }
    return Object.freeze({
      userId: text(row, 'user_id'),
      digest: digest(row, 'digest'),
      scopes: scopes(row, 'scopes'),
      expiresAt: intOrNull(row, 'expires_at'),
      enabled: boolOrNull(row, 'enabled') === true,
      now: int(row, 'now'),
    });
  });
}

export function apiKeyList(
  run: Runner,
  input: Input<'apiKeyList'>,
  signal?: AbortSignal,
): Promise<Output<'apiKeyList'>> {
  if (!withinLimit(input.limit)) {
    return Promise.reject(new StoreFailure('apiKeyList', 'fault', 'no', null));
  }
  return run.read('apiKeyList', signal, KEY_LIST, [input.userId, input.limit], (rows) => {
    const keys: ApiKeyInfo[] = [];
    for (const row of rows) {
      if (!isNull(row, 'key_id')) {
        keys.push(
          Object.freeze({
            keyId: text(row, 'key_id'),
            name: text(row, 'name'),
            scopes: scopes(row, 'scopes'),
            createdAt: int(row, 'created_at'),
            expiresAt: intOrNull(row, 'expires_at'),
          }),
        );
      }
    }
    return Object.freeze({ kind: 'done', now: int(first(rows), 'now'), keys: Object.freeze(keys) });
  });
}

export function apiKeyRevoke(
  run: Runner,
  input: Input<'apiKeyRevoke'>,
  signal?: AbortSignal,
): Promise<Output<'apiKeyRevoke'>> {
  return run.write('apiKeyRevoke', signal, async (tx) => {
    const row = (await tx.query(KEY_LOCK, [input.keyId])).rows[0];
    const now = await clock(tx);
    if (row === undefined || text(row, 'user_id') !== input.userId) {
      return Object.freeze({ kind: 'done', now, revoked: false });
    }
    await tx.query(KEY_DELETE, [input.keyId]);
    return Object.freeze({ kind: 'done', now, revoked: true });
  });
}

export function limitCharge(
  run: Runner,
  input: Input<'limitCharge'>,
  signal?: AbortSignal,
): Promise<Output<'limitCharge'>> {
  return run.write('limitCharge', signal, async (tx) => {
    let row: unknown;
    // Why: Cleanup may delete an expired window between the insert that found it and the lock; insert and lock again.
    while (row === undefined) {
      // biome-ignore lint/performance/noAwaitInLoops: the lock must follow the insert it retries, on one connection.
      await tx.query(WINDOW_ENSURE, [input.key]);
      row = (await tx.query(WINDOW_LOCK, [input.key])).rows[0];
    }
    const now = await clock(tx);
    const resetAt = now + input.windowMs;
    const expiresAt = int(row, 'expires_at');
    if (expiresAt <= now) {
      await tx.query(WINDOW_RESTART, [input.key, now, resetAt]);
      return Object.freeze({ kind: 'done', now, count: 1, resetAt });
    }
    const charged = int(row, 'count');
    if (charged >= input.max) {
      return Object.freeze({ kind: 'lost', reason: 'limit', now, retryAfterMs: expiresAt - now });
    }
    await tx.query(WINDOW_COUNT, [input.key, charged + 1]);
    return Object.freeze({ kind: 'done', now, count: charged + 1, resetAt: expiresAt });
  });
}

export function attemptCreate(
  run: Runner,
  input: Input<'attemptCreate'>,
  signal?: AbortSignal,
): Promise<Output<'attemptCreate'>> {
  return run.write('attemptCreate', signal, async (tx) => {
    const now = await clock(tx);
    const expiresAt = now + input.ttlMs;
    await tx.query(ATTEMPT_INSERT, [
      input.state,
      input.binding,
      input.provider,
      input.nonce,
      input.verifier,
      input.returnPath,
      expiresAt,
    ]);
    return Object.freeze({ kind: 'done', now, expiresAt });
  });
}

export function attemptConsume(
  run: Runner,
  input: Input<'attemptConsume'>,
  signal?: AbortSignal,
): Promise<Output<'attemptConsume'>> {
  return run.write('attemptConsume', signal, async (tx) => {
    const row = (await tx.query(ATTEMPT_LOCK, [input.state])).rows[0];
    const now = await clock(tx);
    if (row === undefined || int(row, 'expires_at') <= now) {
      return Object.freeze({ kind: 'lost', reason: 'gone', now });
    }
    if (!sameBytes(digest(row, 'binding_digest'), input.binding) || text(row, 'provider') !== input.provider) {
      return Object.freeze({ kind: 'lost', reason: 'binding', now });
    }
    await tx.query(ATTEMPT_DELETE, [input.state]);
    return Object.freeze({
      kind: 'done',
      now,
      nonce: text(row, 'nonce'),
      verifier: text(row, 'verifier'),
      returnPath: text(row, 'return_path'),
    });
  });
}

export function expiredRemove(
  run: Runner,
  input: Input<'expiredRemove'>,
  signal?: AbortSignal,
): Promise<Output<'expiredRemove'>> {
  if (!withinLimit(input.limit)) {
    return Promise.reject(new StoreFailure('expiredRemove', 'fault', 'no', null));
  }
  return run.write('expiredRemove', signal, async (tx) => {
    const now = await clock(tx);
    let removed = 0;
    for (const [table, statement] of CLEANUP) {
      if (removed >= input.limit) {
        break;
      }
      // biome-ignore lint/performance/noAwaitInLoops: each table's bound is what the tables before it left of the limit.
      const rows = affected((await tx.query(statement, [now, input.limit - removed])).rowCount);
      removed += rows;
      for (let row = 0; row < rows; row += 1) {
        count('auth.store.cleanup_rows', table);
      }
    }
    return Object.freeze({ kind: 'done', now, removed });
  });
}
