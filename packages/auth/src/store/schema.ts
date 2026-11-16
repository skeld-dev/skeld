// Does:  Declares the auth schema's version and the statements that create it on SQLite and on PostgreSQL.
// Holds: No foreign key; locks go subjects by user_id ascending, then sessions, api_keys, limit_windows, oidc_attempts.

export const SCHEMA_VERSION = 1;

// Why: Each expiring table has an expires_at index so a cleanup pass deletes at most 1,000 rows without a scan.
export const sqliteSchema: readonly string[] = Object.freeze([
  'CREATE TABLE schema_version (version INTEGER NOT NULL)',
  'CREATE TABLE subjects (user_id TEXT NOT NULL PRIMARY KEY, enabled INTEGER NOT NULL, generation INTEGER NOT NULL)',
  'CREATE TABLE sessions (digest BLOB NOT NULL PRIMARY KEY, user_id TEXT NOT NULL, created_at INTEGER NOT NULL, ' +
    'last_seen_at INTEGER NOT NULL, absolute_expires_at INTEGER NOT NULL, expires_at INTEGER NOT NULL)',
  'CREATE INDEX sessions_user ON sessions (user_id)',
  'CREATE INDEX sessions_expiry ON sessions (expires_at)',
  'CREATE TABLE api_keys (key_id TEXT NOT NULL PRIMARY KEY, user_id TEXT NOT NULL, digest BLOB NOT NULL, ' +
    'name TEXT NOT NULL, scopes TEXT NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER)',
  'CREATE INDEX api_keys_user ON api_keys (user_id)',
  'CREATE INDEX api_keys_expiry ON api_keys (expires_at)',
  'CREATE TABLE limit_windows (key BLOB NOT NULL PRIMARY KEY, window_start INTEGER NOT NULL, ' +
    'count INTEGER NOT NULL, expires_at INTEGER NOT NULL)',
  'CREATE INDEX limit_windows_expiry ON limit_windows (expires_at)',
  'CREATE TABLE oidc_attempts (state_digest BLOB NOT NULL PRIMARY KEY, binding_digest BLOB NOT NULL, ' +
    'provider TEXT NOT NULL, nonce TEXT NOT NULL, verifier TEXT NOT NULL, return_path TEXT NOT NULL, ' +
    'expires_at INTEGER NOT NULL)',
  'CREATE INDEX oidc_attempts_expiry ON oidc_attempts (expires_at)',
  `INSERT INTO schema_version (version) VALUES (${SCHEMA_VERSION})`,
]);

export const postgresSchema: readonly string[] = Object.freeze([
  'CREATE SCHEMA IF NOT EXISTS skeld_auth',
  'CREATE TABLE skeld_auth.schema_version (version integer NOT NULL)',
  'CREATE TABLE skeld_auth.subjects (user_id text PRIMARY KEY, enabled boolean NOT NULL, generation bigint NOT NULL)',
  'CREATE TABLE skeld_auth.sessions (digest bytea PRIMARY KEY, user_id text NOT NULL, created_at bigint NOT NULL, ' +
    'last_seen_at bigint NOT NULL, absolute_expires_at bigint NOT NULL, expires_at bigint NOT NULL)',
  'CREATE INDEX sessions_user ON skeld_auth.sessions (user_id)',
  'CREATE INDEX sessions_expiry ON skeld_auth.sessions (expires_at)',
  'CREATE TABLE skeld_auth.api_keys (key_id text PRIMARY KEY, user_id text NOT NULL, digest bytea NOT NULL, ' +
    'name text NOT NULL, scopes text NOT NULL, created_at bigint NOT NULL, expires_at bigint)',
  'CREATE INDEX api_keys_user ON skeld_auth.api_keys (user_id)',
  'CREATE INDEX api_keys_expiry ON skeld_auth.api_keys (expires_at)',
  'CREATE TABLE skeld_auth.limit_windows (key bytea PRIMARY KEY, window_start bigint NOT NULL, ' +
    'count integer NOT NULL, expires_at bigint NOT NULL)',
  'CREATE INDEX limit_windows_expiry ON skeld_auth.limit_windows (expires_at)',
  'CREATE TABLE skeld_auth.oidc_attempts (state_digest bytea PRIMARY KEY, binding_digest bytea NOT NULL, ' +
    'provider text NOT NULL, nonce text NOT NULL, verifier text NOT NULL, return_path text NOT NULL, ' +
    'expires_at bigint NOT NULL)',
  'CREATE INDEX oidc_attempts_expiry ON skeld_auth.oidc_attempts (expires_at)',
  `INSERT INTO skeld_auth.schema_version (version) VALUES (${SCHEMA_VERSION})`,
]);
