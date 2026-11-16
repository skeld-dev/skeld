import { defineContract, errorBodySchema } from '@skeld/core/contract';
import * as t from '@skeld/core/schema';
import { sessionStateSchema } from '@skeld/auth/routes';

// The documents policy binds its input to this node by identity, so the route and the policy share it.
export const documentId = t.string({ minLength: 1, maxLength: 64 });

const document = t.object({
  id: t.string({ maxLength: 64 }),
  tenant: t.string({ maxLength: 64 }),
  title: t.string({ maxLength: 120 }),
  body: t.string({ maxLength: 2000 }),
});

export const appContract = defineContract({
  login: {
    method: 'POST',
    path: '/login',
    access: 'public',
    body: t.object({
      username: t.string({ minLength: 1, maxLength: 64 }),
      password: t.string({ minLength: 1, maxLength: 1024, sensitivity: 'secret' }),
    }),
    responses: { 200: sessionStateSchema, 401: errorBodySchema, 429: errorBodySchema },
  },
  readDocument: {
    method: 'GET',
    path: '/documents/:id',
    access: { policy: 'documents', action: 'read' },
    params: t.object({ id: documentId }),
    responses: { 200: document },
  },
  writeDocument: {
    method: 'PUT',
    path: '/documents/:id',
    access: { policy: 'documents', action: 'write' },
    params: t.object({ id: documentId }),
    body: t.object({ body: t.string({ maxLength: 2000 }) }),
    responses: { 200: document },
  },
  changePassword: {
    method: 'POST',
    path: '/account/password',
    access: { policy: 'auth.session', action: 'use' },
    body: t.object({
      currentPassword: t.string({ minLength: 1, maxLength: 1024, sensitivity: 'secret' }),
      newPassword: t.string({ minLength: 12, maxLength: 1024, sensitivity: 'secret' }),
    }),
    responses: { 204: null, 403: errorBodySchema, 409: errorBodySchema, 429: errorBodySchema },
  },
  issueApiKey: {
    method: 'POST',
    path: '/account/api-keys',
    access: { policy: 'auth.session', action: 'use' },
    body: t.object({ name: t.string({ minLength: 1, maxLength: 64 }) }),
    responses: {
      201: t.object({
        keyId: t.string({ maxLength: 16 }),
        key: t.exposed(t.string({ maxLength: 67, sensitivity: 'secret' }), 'shown once to the user who issued it'),
        expiresAt: t.union([t.integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }), t.null()]),
      }),
      409: errorBodySchema,
    },
  },
  revokeApiKey: {
    method: 'DELETE',
    path: '/account/api-keys/:keyId',
    access: { policy: 'auth.session', action: 'use' },
    params: t.object({ keyId: t.string({ minLength: 16, maxLength: 16 }) }),
    responses: { 204: null, 404: errorBodySchema },
  },
  readReport: {
    method: 'GET',
    path: '/reports/me',
    access: { policy: 'reports', action: 'read' },
    responses: { 200: t.object({ issuer: t.string({ maxLength: 255 }), userId: t.string({ maxLength: 128 }) }) },
  },
});

export type Document = t.Infer<typeof document>;
