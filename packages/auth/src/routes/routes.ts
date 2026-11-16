// Does:  Declares auth's two route sets, the session routes and the OIDC routes, and the session state schema.
// Holds: The routes' methods, paths and access are fixed here; the auth gate recognises its own routes by them.

import { defineContract, errorBodySchema } from '@skeld/core/contract';
import { exposed, integer, literal, object, optional, string, union } from '@skeld/core/schema';

const PROVIDER = object({ provider: string({ minLength: 1, maxLength: 32 }) });

/** The body of `authSession`: no session, or the live session with its CSRF token. */
export const sessionStateSchema = union([
  object({ status: literal('none') }),
  object({
    status: literal('session'),
    userId: string({ minLength: 1, maxLength: 128 }),
    csrfToken: exposed(
      string({ minLength: 43, maxLength: 43, sensitivity: 'secret' }),
      'the page holding the session cookie sends it back as x-csrf-token',
    ),
    expiresAt: integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }),
  }),
]);

/**
 * The session routes whose handlers `auth.handlers.session` supplies: status, sign-out and dead-cookie cleanup.
 * @see examples/auth/app.ts
 */
export const sessionRoutes = defineContract({
  authSession: {
    method: 'GET',
    path: '/auth/session',
    access: 'optional',
    responses: { 200: sessionStateSchema },
  },
  authSignOut: {
    method: 'POST',
    path: '/auth/sign-out',
    access: { policy: 'auth.session', action: 'use' },
    responses: { 204: null },
  },
  authSessionClear: {
    method: 'POST',
    path: '/auth/session/clear',
    access: 'public',
    responses: { 204: null, 429: errorBodySchema },
  },
});

/**
 * The OIDC routes whose handlers `oidc().handlers` supplies: one start and one callback route per provider name.
 * @see examples/auth/app.ts
 */
export const oidcRoutes = defineContract({
  authOidcStart: {
    method: 'POST',
    path: '/auth/oidc/:provider/start',
    access: 'public',
    params: PROVIDER,
    body: object({ returnTo: optional(string({ minLength: 1, maxLength: 512 })) }),
    responses: { 200: object({ url: string({ maxLength: 4096 }) }), 429: errorBodySchema },
  },
  authOidcCallback: {
    method: 'GET',
    path: '/auth/oidc/:provider/callback',
    access: 'public',
    params: PROVIDER,
    query: object({
      state: string({ minLength: 43, maxLength: 43 }),
      code: optional(string({ minLength: 1, maxLength: 2048, sensitivity: 'secret' })),
      iss: optional(string({ minLength: 1, maxLength: 255 })),
      error: optional(string({ minLength: 1, maxLength: 64 })),
    }),
    responses: { 303: null, 429: errorBodySchema },
  },
});

/** The type of `sessionRoutes`. */
export type SessionRoutes = typeof sessionRoutes;

/** The type of `oidcRoutes`. */
export type OidcRoutes = typeof oidcRoutes;
