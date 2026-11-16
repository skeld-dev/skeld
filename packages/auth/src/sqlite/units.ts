// Does:  Holds the SQL of the store's 18 operations on SQLite, each a synchronous body over one connection.
// Holds: A body judges every expiry and stores every instant from one clock reading; no body awaits.

// biome-ignore lint/correctness/noUnresolvedImports: Biome's Node module list lacks node:sqlite, which Node 26 ships
import type { SQLOutputValue, StatementSync } from 'node:sqlite';
import type { ApiKeyInfo } from '../api-key/types.ts';
import type {
  ApiKeyRecord,
  Digest,
  Done,
  Lost,
  SessionRecord,
  StoreOperations,
  SubjectRecord,
} from '../store/types.ts';

// Does:  Gives the connection's prepared statement for one fixed SQL text.
export type Query = (text: string) => StatementSync;

type Row = Record<string, SQLOutputValue>;
type InputOf<K extends keyof StoreOperations> = Parameters<StoreOperations[K]>[0];
type ResultOf<K extends keyof StoreOperations> = Awaited<ReturnType<StoreOperations[K]>>;

// Does:  Marks a stored row that does not parse into its record.
export class RowFault extends Error {
  override readonly name = 'RowFault';
}

const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER);
const MIN_SAFE = BigInt(Number.MIN_SAFE_INTEGER);

// Why: The connection reads integers as BigInt, so a stored value past 2^53 reaches this parse instead of throwing.
function integer(row: Row | undefined, column: string): number {
  const value = row?.[column];
  if (typeof value !== 'bigint' || value > MAX_SAFE || value < MIN_SAFE) {
    throw new RowFault(column);
  }
  return Number(value);
}

function nullableInteger(row: Row, column: string): number | null {
  return row[column] === null ? null : integer(row, column);
}

function text(row: Row, column: string): string {
  const value = row[column];
  if (typeof value !== 'string') {
    throw new RowFault(column);
  }
  return value;
}

function flag(row: Row | undefined, column: string): boolean {
  const value = integer(row, column);
  if (value !== 0 && value !== 1) {
    throw new RowFault(column);
  }
  return value === 1;
}

function digestOf(row: Row, column: string): Digest {
  const value = row[column];
  if (!(value instanceof Uint8Array) || value.length !== 32) {
    throw new RowFault(column);
  }
  // Why: The result owns its 32 bytes, so no caller sees or keeps the engine's buffer.
  return new Uint8Array(value);
}

// Why: Scopes are stored joined by one space; an empty part means the row was not written by this store.
function scopes(row: Row): readonly string[] {
  const parts = text(row, 'scopes').split(' ');
  if (parts.includes('')) {
    throw new RowFault('scopes');
  }
  return Object.freeze(parts);
}

// Does:  Reads the store's clock, the engine's view of the host time, in whole epoch milliseconds.
function clock(q: Query): number {
  // biome-ignore lint/security/noSecrets: SQL text, flagged only for the entropy of its letters
  return integer(q("SELECT CAST(round(unixepoch('subsec') * 1000) AS INTEGER) AS now").get(), 'now');
}

// Does:  Reads the installed schema version, or null when no schema_version table exists.
export function schemaVersion(q: Query): number | null {
  const table = q("SELECT 1 FROM sqlite_schema WHERE type = 'table' AND name = 'schema_version'").get();
  if (table === undefined) {
    return null;
  }
  const rows = q('SELECT version FROM schema_version').all();
  if (rows.length !== 1) {
    throw new RowFault('schema_version');
  }
  return integer(rows[0], 'version');
}

function changes(count: number | bigint): number {
  return Number(count);
}

function done<T extends object>(now: number, fields: T): Done<T> {
  return Object.freeze({ kind: 'done' as const, now, ...fields });
}

function lost<R>(reason: R, now: number): Lost<R> {
  return Object.freeze({ kind: 'lost' as const, reason, now });
}

function ensureSubject(q: Query, userId: string): void {
  q('INSERT INTO subjects (user_id, enabled, generation) VALUES (?, 1, 1) ON CONFLICT (user_id) DO NOTHING').run(
    userId,
  );
}

function subjectRow(q: Query, userId: string): Row | undefined {
  return q('SELECT enabled, generation FROM subjects WHERE user_id = ?').get(userId);
}

function deleteSessionsOf(q: Query, userId: string): number {
  return changes(q('DELETE FROM sessions WHERE user_id = ?').run(userId).changes);
}

export function subjectEnsure(q: Query, input: InputOf<'subjectEnsure'>): ResultOf<'subjectEnsure'> {
  const now = clock(q);
  ensureSubject(q, input.userId);
  const row = subjectRow(q, input.userId);
  if (row === undefined) {
    throw new RowFault('subjects');
  }
  return done(now, { enabled: flag(row, 'enabled'), generation: integer(row, 'generation') });
}

export function subjectRead(q: Query, input: InputOf<'subjectRead'>): SubjectRecord | null {
  const now = clock(q);
  const row = subjectRow(q, input.userId);
  if (row === undefined) {
    return null;
  }
  return Object.freeze({ enabled: flag(row, 'enabled'), generation: integer(row, 'generation'), now });
}

export function subjectDisable(q: Query, input: InputOf<'subjectDisable'>): ResultOf<'subjectDisable'> {
  const now = clock(q);
  ensureSubject(q, input.userId);
  const row = q(
    'UPDATE subjects SET enabled = 0, generation = generation + 1 WHERE user_id = ? RETURNING generation',
  ).get(input.userId);
  const generation = integer(row, 'generation');
  return done(now, { generation, revoked: deleteSessionsOf(q, input.userId) });
}

export function subjectEnable(q: Query, input: InputOf<'subjectEnable'>): ResultOf<'subjectEnable'> {
  const now = clock(q);
  const row = subjectRow(q, input.userId);
  if (row === undefined) {
    return lost('absent', now);
  }
  if (flag(row, 'enabled')) {
    return lost('enabled', now);
  }
  if (integer(row, 'generation') !== input.generation) {
    return lost('stale', now);
  }
  const raised = q(
    'UPDATE subjects SET enabled = 1, generation = generation + 1 WHERE user_id = ? RETURNING generation',
  ).get(input.userId);
  const generation = integer(raised, 'generation');
  return done(now, { generation, revoked: deleteSessionsOf(q, input.userId) });
}

export function subjectInvalidate(q: Query, input: InputOf<'subjectInvalidate'>): ResultOf<'subjectInvalidate'> {
  const now = clock(q);
  ensureSubject(q, input.userId);
  const row = q('UPDATE subjects SET generation = generation + 1 WHERE user_id = ? RETURNING enabled, generation').get(
    input.userId,
  );
  const enabled = flag(row, 'enabled');
  const generation = integer(row, 'generation');
  return done(now, { enabled, generation, revoked: deleteSessionsOf(q, input.userId) });
}

function insertSession(
  q: Query,
  digest: Digest,
  userId: string,
  times: { createdAt: number; lastSeenAt: number; absoluteExpiresAt: number; expiresAt: number },
): void {
  q(
    'INSERT INTO sessions (digest, user_id, created_at, last_seen_at, absolute_expires_at, expires_at) ' +
      'VALUES (?, ?, ?, ?, ?, ?)',
  ).run(digest, userId, times.createdAt, times.lastSeenAt, times.absoluteExpiresAt, times.expiresAt);
}

export function sessionIssue(q: Query, input: InputOf<'sessionIssue'>): ResultOf<'sessionIssue'> {
  const now = clock(q);
  const row = subjectRow(q, input.userId);
  if (row === undefined) {
    return lost('stale', now);
  }
  if (!flag(row, 'enabled')) {
    return lost('disabled', now);
  }
  if (integer(row, 'generation') !== input.generation) {
    return lost('stale', now);
  }
  if (input.replaces !== null) {
    q('DELETE FROM sessions WHERE digest = ?').run(input.replaces);
  }
  const absoluteExpiresAt = now + input.absoluteMs;
  const expiresAt = now + Math.min(input.idleMs, input.absoluteMs);
  insertSession(q, input.digest, input.userId, { createdAt: now, lastSeenAt: now, absoluteExpiresAt, expiresAt });
  return done(now, { createdAt: now, expiresAt });
}

export function sessionRead(q: Query, input: InputOf<'sessionRead'>): SessionRecord | null {
  const now = clock(q);
  const row = q(
    'SELECT user_id, created_at, last_seen_at, expires_at, absolute_expires_at FROM sessions ' +
      'WHERE digest = ? AND expires_at > ?',
  ).get(input.digest, now);
  if (row === undefined) {
    return null;
  }
  return Object.freeze({
    userId: text(row, 'user_id'),
    createdAt: integer(row, 'created_at'),
    lastSeenAt: integer(row, 'last_seen_at'),
    expiresAt: integer(row, 'expires_at'),
    absoluteExpiresAt: integer(row, 'absolute_expires_at'),
    now,
  });
}

export function sessionRenew(q: Query, input: InputOf<'sessionRenew'>): ResultOf<'sessionRenew'> {
  const now = clock(q);
  const row = q(
    'UPDATE sessions SET last_seen_at = ?, expires_at = min(?, absolute_expires_at) ' +
      'WHERE digest = ? AND expires_at > ? RETURNING expires_at',
  ).get(now, now + input.idleMs, input.digest, now);
  if (row === undefined) {
    return lost('gone', now);
  }
  return done(now, { expiresAt: integer(row, 'expires_at') });
}

export function sessionRotate(q: Query, input: InputOf<'sessionRotate'>): ResultOf<'sessionRotate'> {
  const now = clock(q);
  const row = q(
    'SELECT created_at, absolute_expires_at FROM sessions WHERE digest = ? AND user_id = ? AND expires_at > ?',
  ).get(input.digest, input.userId, now);
  if (row === undefined) {
    return lost('gone', now);
  }
  const createdAt = integer(row, 'created_at');
  const absoluteExpiresAt = integer(row, 'absolute_expires_at');
  const expiresAt = Math.min(now + input.idleMs, absoluteExpiresAt);
  q('DELETE FROM sessions WHERE digest = ?').run(input.digest);
  insertSession(q, input.next, input.userId, { createdAt, lastSeenAt: now, absoluteExpiresAt, expiresAt });
  return done(now, { createdAt, expiresAt, absoluteExpiresAt });
}

export function sessionRevoke(q: Query, input: InputOf<'sessionRevoke'>): ResultOf<'sessionRevoke'> {
  const now = clock(q);
  const row = q('DELETE FROM sessions WHERE digest = ? RETURNING user_id').get(input.digest);
  if (row === undefined) {
    return done(now, { revoked: false, userId: null });
  }
  return done(now, { revoked: true, userId: text(row, 'user_id') });
}

export function apiKeyIssue(q: Query, input: InputOf<'apiKeyIssue'>): ResultOf<'apiKeyIssue'> {
  const now = clock(q);
  ensureSubject(q, input.userId);
  const subject = subjectRow(q, input.userId);
  if (subject === undefined) {
    throw new RowFault('subjects');
  }
  if (!flag(subject, 'enabled')) {
    return lost('disabled', now);
  }
  const held = q(
    'SELECT count(*) AS held FROM api_keys WHERE user_id = ? AND (expires_at IS NULL OR expires_at > ?)',
  ).get(input.userId, now);
  if (integer(held, 'held') >= input.max) {
    return lost('limit', now);
  }
  const expiresAt = input.expiresInMs === null ? null : now + input.expiresInMs;
  q(
    'INSERT INTO api_keys (key_id, user_id, digest, name, scopes, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
  ).run(input.keyId, input.userId, input.digest, input.name, input.scopes.join(' '), now, expiresAt);
  return done(now, { createdAt: now, expiresAt });
}

export function apiKeyRead(q: Query, input: InputOf<'apiKeyRead'>): ApiKeyRecord | null {
  const now = clock(q);
  const row = q(
    'SELECT k.user_id, k.digest, k.scopes, k.expires_at, coalesce(s.enabled, 0) AS enabled ' +
      'FROM api_keys k LEFT JOIN subjects s ON s.user_id = k.user_id ' +
      'WHERE k.key_id = ? AND (k.expires_at IS NULL OR k.expires_at > ?)',
  ).get(input.keyId, now);
  if (row === undefined) {
    return null;
  }
  return Object.freeze({
    userId: text(row, 'user_id'),
    digest: digestOf(row, 'digest'),
    scopes: scopes(row),
    expiresAt: nullableInteger(row, 'expires_at'),
    enabled: flag(row, 'enabled'),
    now,
  });
}

export function apiKeyList(q: Query, input: InputOf<'apiKeyList'>): ResultOf<'apiKeyList'> {
  const now = clock(q);
  const rows = q(
    'SELECT key_id, name, scopes, created_at, expires_at FROM api_keys ' +
      'WHERE user_id = ? AND (expires_at IS NULL OR expires_at > ?) LIMIT ?',
  ).all(input.userId, now, input.limit);
  const keys = rows.map(
    (row): ApiKeyInfo =>
      Object.freeze({
        keyId: text(row, 'key_id'),
        name: text(row, 'name'),
        scopes: scopes(row),
        createdAt: integer(row, 'created_at'),
        expiresAt: nullableInteger(row, 'expires_at'),
      }),
  );
  return done(now, { keys: Object.freeze(keys) });
}

export function apiKeyRevoke(q: Query, input: InputOf<'apiKeyRevoke'>): ResultOf<'apiKeyRevoke'> {
  const now = clock(q);
  const removed = q('DELETE FROM api_keys WHERE key_id = ? AND user_id = ?').run(input.keyId, input.userId);
  return done(now, { revoked: changes(removed.changes) > 0 });
}

export function limitCharge(q: Query, input: InputOf<'limitCharge'>): ResultOf<'limitCharge'> {
  q(
    'INSERT INTO limit_windows (key, window_start, count, expires_at) VALUES (?, 0, 0, 0) ON CONFLICT (key) DO NOTHING',
  ).run(input.key);
  const now = clock(q);
  const row = q('SELECT count, expires_at FROM limit_windows WHERE key = ?').get(input.key);
  const count = integer(row, 'count');
  const expiresAt = integer(row, 'expires_at');
  if (expiresAt <= now) {
    const resetAt = now + input.windowMs;
    q('UPDATE limit_windows SET window_start = ?, count = 1, expires_at = ? WHERE key = ?').run(
      now,
      resetAt,
      input.key,
    );
    return done(now, { count: 1, resetAt });
  }
  if (count >= input.max) {
    return Object.freeze({ kind: 'lost' as const, reason: 'limit' as const, now, retryAfterMs: expiresAt - now });
  }
  q('UPDATE limit_windows SET count = ? WHERE key = ?').run(count + 1, input.key);
  return done(now, { count: count + 1, resetAt: expiresAt });
}

export function attemptCreate(q: Query, input: InputOf<'attemptCreate'>): ResultOf<'attemptCreate'> {
  const now = clock(q);
  const expiresAt = now + input.ttlMs;
  q(
    'INSERT INTO oidc_attempts (state_digest, binding_digest, provider, nonce, verifier, return_path, expires_at) ' +
      'VALUES (?, ?, ?, ?, ?, ?, ?)',
  ).run(input.state, input.binding, input.provider, input.nonce, input.verifier, input.returnPath, expiresAt);
  return done(now, { expiresAt });
}

export function attemptConsume(q: Query, input: InputOf<'attemptConsume'>): ResultOf<'attemptConsume'> {
  const now = clock(q);
  const row = q(
    'SELECT binding_digest = ? AND provider = ? AS bound, nonce, verifier, return_path FROM oidc_attempts ' +
      'WHERE state_digest = ? AND expires_at > ?',
  ).get(input.binding, input.provider, input.state, now);
  if (row === undefined) {
    return lost('gone', now);
  }
  if (!flag(row, 'bound')) {
    return lost('binding', now);
  }
  const attempt = { nonce: text(row, 'nonce'), verifier: text(row, 'verifier'), returnPath: text(row, 'return_path') };
  q('DELETE FROM oidc_attempts WHERE state_digest = ?').run(input.state);
  return done(now, attempt);
}

// Why: Neither DELETE ... LIMIT dialect is compiled in, so each bounded delete selects keys through the expiry index.
const EXPIRED: readonly (readonly [table: string, text: string])[] = [
  ['sessions', 'DELETE FROM sessions WHERE digest IN (SELECT digest FROM sessions WHERE expires_at <= ? LIMIT ?)'],
  ['api_keys', 'DELETE FROM api_keys WHERE key_id IN (SELECT key_id FROM api_keys WHERE expires_at <= ? LIMIT ?)'],
  [
    'limit_windows',
    'DELETE FROM limit_windows WHERE key IN (SELECT key FROM limit_windows WHERE expires_at <= ? LIMIT ?)',
  ],
  [
    'oidc_attempts',
    'DELETE FROM oidc_attempts WHERE state_digest IN ' +
      '(SELECT state_digest FROM oidc_attempts WHERE expires_at <= ? LIMIT ?)',
  ],
];

// Does:  Deletes at most the limit of expired rows, table by table, reporting each table's count.
export function expiredRemove(
  q: Query,
  input: InputOf<'expiredRemove'>,
  removedFrom: (table: string, removed: number) => void,
): ResultOf<'expiredRemove'> {
  const now = clock(q);
  let left = input.limit;
  for (const [table, statement] of EXPIRED) {
    if (left === 0) {
      break;
    }
    const removed = changes(q(statement).run(now, left).changes);
    removedFrom(table, removed);
    left -= removed;
  }
  return done(now, { removed: input.limit - left });
}
