// biome-ignore lint/correctness/noUnresolvedImports: Biome's Node module list lacks node:sqlite, which Node 26 ships
import type { DatabaseSync, SQLOutputValue } from 'node:sqlite';
import { definePolicy } from '@skeld/auth/policy';
import { type Document, documentId } from './contract.ts';
import type { Users } from './users.ts';

// A protected resource owned by the application: documents, each in one tenant.
export function createDocuments(db: DatabaseSync, users: Users) {
  db.exec(`CREATE TABLE IF NOT EXISTS documents (
    id TEXT PRIMARY KEY,
    tenant TEXT NOT NULL,
    title TEXT NOT NULL,
    body TEXT NOT NULL
  ) STRICT`);
  const insert = db.prepare('INSERT INTO documents (id, tenant, title, body) VALUES (?, ?, ?, ?)');
  const byId = db.prepare('SELECT id, tenant, title, body FROM documents WHERE id = ?');
  const update = db.prepare('UPDATE documents SET body = ? WHERE id = ?');
  insert.run('acme-plan', 'acme', 'Acme plan', 'Ship the widget.');
  insert.run('globex-plan', 'globex', 'Globex plan', 'Ship the gadget.');

  // The policy decides who may act on a document. The gate runs it after the request is validated and before
  // the handler: load the document, check tenant membership, then the action.
  const policy = definePolicy('documents', {
    credentials: ['session', 'api_key'],
    input: { id: documentId },
    load: ({ input }) => toDocument(byId.get(input.id)),
    tenant: {
      of: (resource) => resource.tenant,
      member: ({ principal, tenant }) =>
        principal.kind !== 'jwt' && users.findById(principal.userId)?.tenant === tenant,
    },
    actions: {
      read: () => true,
      write: () => true,
    },
  });

  // Operations are the only code that touches the table on a request's behalf. Each one acts on
  // grant.resource, the row the policy loaded and judged, never on an id passed beside the grant.
  return {
    policy,
    read: policy.operation('read', (grant): Document => grant.resource),
    write: policy.operation('write', (grant, body: string): Document => {
      update.run(body, grant.resource.id);
      return { ...grant.resource, body };
    }),
  };
}

function toDocument(row: Record<string, SQLOutputValue> | undefined): Document | null {
  if (row === undefined) {
    return null;
  }
  const { id, tenant, title, body } = row;
  if (typeof id !== 'string' || typeof tenant !== 'string' || typeof title !== 'string' || typeof body !== 'string') {
    throw new TypeError('documents: a column read back is not text');
  }
  return { id, tenant, title, body };
}
