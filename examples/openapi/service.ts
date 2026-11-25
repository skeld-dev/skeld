import { apiKeys } from '@skeld/auth/api-key';
import { definePolicy } from '@skeld/auth/policy';
import { createAuth } from '@skeld/auth/server';
import type { AuthStore } from '@skeld/auth/store';
import { defineContract, errorBodySchema } from '@skeld/core/contract';
import * as t from '@skeld/core/schema';

// The one place the session cookie is named: auth sets it and the generated document describes it.
export const SESSION_COOKIE = '__Host-notes';

export const notesPolicy = definePolicy('notes', {
  credentials: ['session', 'api_key'],
  actions: { read: () => true, write: () => true },
});

const noteId = t.string({ minLength: 1, maxLength: 36 });
const note = t.object({ id: t.string({ maxLength: 36 }), text: t.string({ maxLength: 2000 }) });

export const notesContract = defineContract({
  health: { method: 'GET', path: '/health', access: 'public', responses: { 204: null } },
  readNote: {
    method: 'GET',
    path: '/notes/:id',
    access: { policy: 'notes', action: 'read' },
    params: t.object({ id: noteId }),
    responses: { 200: note, 404: errorBodySchema },
  },
  writeNote: {
    method: 'PUT',
    path: '/notes/:id',
    access: { policy: 'notes', action: 'write' },
    params: t.object({ id: noteId }),
    body: t.object({ text: t.string({ maxLength: 2000 }) }),
    responses: { 200: note, 404: errorBodySchema },
  },
});

// The auth instance the service runs with; its session cookie is SESSION_COOKIE and it accepts API keys.
export function createNotesAuth(store: AuthStore, origin: string) {
  return createAuth({
    store,
    origin,
    policies: [notesPolicy],
    session: { cookieName: SESSION_COOKIE },
    apiKeys: apiKeys(),
  });
}
