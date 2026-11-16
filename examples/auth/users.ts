import { randomBytes } from 'node:crypto';
// biome-ignore lint/correctness/noUnresolvedImports: Biome's Node module list lacks node:sqlite, which Node 26 ships
import type { DatabaseSync, SQLOutputValue } from 'node:sqlite';

// The application's own user table, in its own database file. Auth never reads it: auth keeps only a
// subject fence (user id, enabled, generation) in its separate store.
export interface User {
  readonly id: string;
  readonly name: string;
  readonly tenant: string;
  readonly passwordHash: string;
}

export interface Users {
  findByName(name: string): User | undefined;
  findById(id: string): User | undefined;
  findByIdentity(issuer: string, subject: string): User | undefined;
  // Replaces the hash only if it is still the one the caller verified; false when another write came first.
  replaceHash(id: string, verifiedHash: string, nextHash: string): boolean;
  linkIdentity(id: string, issuer: string, subject: string): void;
}

export function openUsers(db: DatabaseSync): Users {
  db.exec(`CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    tenant TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    oidc_issuer TEXT,
    oidc_subject TEXT,
    UNIQUE (oidc_issuer, oidc_subject)
  ) STRICT`);
  const byName = db.prepare('SELECT id, name, tenant, password_hash FROM users WHERE name = ?');
  const byId = db.prepare('SELECT id, name, tenant, password_hash FROM users WHERE id = ?');
  const byIdentity = db.prepare(
    'SELECT id, name, tenant, password_hash FROM users WHERE oidc_issuer = ? AND oidc_subject = ?',
  );
  const replace = db.prepare('UPDATE users SET password_hash = ? WHERE id = ? AND password_hash = ?');
  const link = db.prepare('UPDATE users SET oidc_issuer = ?, oidc_subject = ? WHERE id = ?');

  return {
    findByName: (name) => toUser(byName.get(name)),
    findById: (id) => toUser(byId.get(id)),
    findByIdentity: (issuer, subject) => toUser(byIdentity.get(issuer, subject)),
    replaceHash: (id, verifiedHash, nextHash) => replace.run(nextHash, id, verifiedHash).changes === 1,
    linkIdentity: (id, issuer, subject) => {
      link.run(issuer, subject, id);
    },
  };
}

// Creates the example's fake users with fresh random passwords, returned once to the caller and stored
// nowhere but as hashes. Nothing here is a sample credential: every run makes new ones.
export async function seedUsers(
  db: DatabaseSync,
  people: readonly { readonly id: string; readonly tenant: string }[],
  hash: (password: string) => Promise<string>,
): Promise<ReadonlyMap<string, string>> {
  const insert = db.prepare('INSERT INTO users (id, name, tenant, password_hash) VALUES (?, ?, ?, ?)');
  const seeded = await Promise.all(
    people.map(async (person) => {
      const password = randomBytes(12).toString('base64url');
      return { person, password, hash: await hash(password) };
    }),
  );
  for (const { person, hash: passwordHash } of seeded) {
    insert.run(person.id, person.id, person.tenant, passwordHash);
  }
  return new Map(seeded.map(({ person, password }) => [person.id, password]));
}

function toUser(row: Record<string, SQLOutputValue> | undefined): User | undefined {
  if (row === undefined) {
    return undefined;
  }
  return { id: text(row.id), name: text(row.name), tenant: text(row.tenant), passwordHash: text(row.password_hash) };
}

function text(value: SQLOutputValue | undefined): string {
  if (typeof value !== 'string') {
    throw new TypeError('users: a column read back is not text');
  }
  return value;
}
