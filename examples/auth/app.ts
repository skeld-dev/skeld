import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
// biome-ignore lint/correctness/noUnresolvedImports: Biome's Node module list lacks node:sqlite, which Node 26 ships
import { DatabaseSync } from 'node:sqlite';
import { apiKeys } from '@skeld/auth/api-key';
import { jwt } from '@skeld/auth/jwt';
import { oidc } from '@skeld/auth/oidc';
import { hashPassword } from '@skeld/auth/password';
import { definePolicy, type Principal } from '@skeld/auth/policy';
import { oidcRoutes, sessionRoutes } from '@skeld/auth/routes';
import { createAuth, type LimitRule } from '@skeld/auth/server';
import { createSqliteStore } from '@skeld/auth/sqlite';
import { HttpError } from '@skeld/core/http-error';
import type { LogSink } from '@skeld/core/log';
import { expose, Secret } from '@skeld/core/secret';
import { createServer } from '@skeld/core/server';
import { appContract } from './contract.ts';
import { changePassword, type ChangeDeps } from './credential-change.ts';
import { createDocuments } from './documents.ts';
import { createLocalIssuer } from './local-issuer.ts';
import { createLogin, PASSWORD_COST, unavailable } from './login.ts';
import type { ProviderConfig } from './launch.ts';
import { createUserLocks } from './user-locks.ts';
import { openUsers, seedUsers } from './users.ts';

export interface ExampleOptions {
  // auth needs the service's origin before listening, so the port is fixed up front (not 0).
  readonly port: number;
  // The OIDC provider to sign in with. Its certificate must already be trusted by this process: see launch.ts.
  readonly provider: ProviderConfig;
  readonly loginLimit?: LimitRule;
  readonly logSink?: LogSink;
}

export async function startExample(options: ExampleOptions) {
  const origin = `http://127.0.0.1:${options.port}`;
  // Both databases live in a fresh temporary folder, removed at close: every run starts empty.
  const dir = mkdtempSync(join(tmpdir(), 'skeld-auth-example-'));

  // The application's store: users and documents. Separate from auth's store on purpose.
  const db = new DatabaseSync(join(dir, 'app.db'));
  const users = openUsers(db);
  const hash = async (password: string) => {
    const hashed = await hashPassword(new Secret(password));
    if (hashed.kind !== 'hashed') {
      throw new Error(`hashing a generated password answered ${hashed.kind}`);
    }
    return hashed.hash;
  };
  // Seeded at the helper's default cost, below PASSWORD_COST, so the first sign-in shows a rehash.
  const passwords = await seedUsers(
    db,
    [
      { id: 'alice', tenant: 'acme' },
      { id: 'bob', tenant: 'globex' },
    ],
    hash,
  );
  const dummy = await hashPassword(new Secret(randomBytes(16).toString('base64url')), { cost: PASSWORD_COST });
  if (dummy.kind !== 'hashed') {
    throw new Error(`hashing the dummy password answered ${dummy.kind}`);
  }
  const documents = createDocuments(db, users);

  // auth's store: installing is a deploy step, run here because the folder is new.
  const store = createSqliteStore({ path: join(dir, 'auth.db') });
  const installed = await store.install();
  if (installed.kind === 'mismatch') {
    throw new Error(`auth store holds schema version ${installed.found}`);
  }

  const { provider } = options;
  // The application's identity mapping: provider account p-alice is the user alice. p-mallory maps to no one.
  users.linkIdentity('alice', provider.issuer, 'p-alice');

  const issuer = createLocalIssuer();
  const keys = apiKeys();
  const signIn = oidc({
    providers: {
      local: { issuer: provider.issuer, clientId: provider.clientId, clientSecret: new Secret(provider.clientSecret) },
    },
    failurePath: '/',
    // Called with a verified issuer and subject, and again inside the session handoff. Email is never used
    // to find a user: only an existing mapping signs in.
    resolveUser: (identity) => {
      const user = users.findByIdentity(identity.issuer, identity.subject);
      return user === undefined ? { kind: 'deny' } : { kind: 'user', userId: user.id };
    },
  });
  const reports = definePolicy('reports', { credentials: ['jwt'], actions: { read: () => true } });

  const auth = createAuth({
    store,
    origin,
    policies: [documents.policy, reports],
    limits: {
      login: options.loginLimit ?? { max: 10, windowSeconds: 60 },
      password: { max: 5, windowSeconds: 300 },
    },
    apiKeys: keys,
    jwt: jwt({
      issuer: issuer.issuer,
      audience: issuer.audience,
      algorithms: ['RS256'],
      keys: [issuer.jwk],
      // Runs only after signature, issuer, audience and times have passed. Unknown subjects are denied.
      map: (verified) =>
        users.findById(verified.subject) === undefined
          ? { kind: 'deny' }
          : { kind: 'accept', userId: verified.subject },
    }),
    oidc: signIn,
  });

  // Every route that can carry the session cookie must sit under the strict cross-site check.
  const server = createServer({
    gate: auth.gate,
    publicOrigin: origin,
    csrf: { mode: 'strict' },
    log: options.logSink === undefined ? { access: true } : { access: true, sink: options.logSink },
  });
  server.routes(sessionRoutes, auth.handlers.session);
  server.routes(oidcRoutes, signIn.handlers);

  const changeDeps: ChangeDeps = { subjects: auth.subjects, users, locks: createUserLocks() };
  server.routes(appContract, {
    login: createLogin({ sessions: auth.sessions, limits: auth.limits, users, dummyHash: dummy.hash }),

    readDocument: (request) => ({ status: 200, body: documents.read(request.grant) }),

    writeDocument: (request) => ({ status: 200, body: documents.write(request.grant, request.body.body) }),

    changePassword: async (request) => {
      const userId = sessionUserId(request.principal);
      const verdict = await auth.limits.charge('password', `user:${userId}`, request.signal);
      if (verdict.kind === 'limited') {
        return {
          status: 429,
          body: { status: 429, code: 'RATE_LIMITED', message: 'Too many requests' },
          headers: { 'retry-after': String(verdict.retryAfterSeconds) },
        };
      }
      if (verdict.kind === 'unavailable') {
        throw unavailable();
      }
      const { currentPassword, newPassword } = request.body;
      const outcome = await changePassword(changeDeps, userId, currentPassword, newPassword, request.signal);
      request.log.info('password change', { outcome: outcome.kind });
      switch (outcome.kind) {
        case 'changed':
          return { status: 204 };
        case 'refused':
          return {
            status: 403,
            body: { status: 403, code: 'PASSWORD_NOT_ACCEPTED', message: 'Password not accepted' },
          };
        case 'conflict':
          return {
            status: 409,
            body: { status: 409, code: 'PASSWORD_CHANGED', message: 'Password changed meanwhile' },
          };
        default:
          throw unavailable();
      }
    },

    issueApiKey: async (request) => {
      const userId = sessionUserId(request.principal);
      const issued = await keys.issue({
        userId,
        name: request.body.name,
        scopes: ['documents:read'],
        expiresInSeconds: 3600,
      });
      if (issued.kind === 'refused') {
        return { status: 409, body: { status: 409, code: 'KEY_REFUSED', message: 'API key not issued' } };
      }
      if (issued.kind === 'unavailable') {
        throw unavailable();
      }
      return {
        status: 201,
        body: { keyId: issued.info.keyId, key: expose(issued.key), expiresAt: issued.info.expiresAt },
      };
    },

    revokeApiKey: async (request) => {
      const userId = sessionUserId(request.principal);
      const revoked = await keys.revoke({ userId, keyId: request.params.keyId });
      if (revoked.kind === 'unavailable') {
        throw unavailable();
      }
      if (revoked.kind === 'absent') {
        return { status: 404, body: { status: 404, code: 'KEY_NOT_FOUND', message: 'API key not found' } };
      }
      return { status: 204 };
    },

    readReport: (request) => {
      const { principal } = request;
      if (principal.kind !== 'jwt' || principal.userId === null) {
        throw new HttpError(403, 'ACCESS_DENIED', 'Access denied');
      }
      return { status: 200, body: { issuer: principal.issuer, userId: principal.userId } };
    },
  });

  const release = () => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  };
  try {
    await server.listen({ port: options.port, host: '127.0.0.1' });
  } catch (error) {
    release();
    throw error;
  }

  return {
    origin,
    // One-time values for this run: never logged, and gone at close.
    passwords,
    issuerToken: issuer.token,
    auth,
    users,
    changeDeps,
    close: async () => {
      try {
        await server.close();
      } finally {
        release();
      }
    },
  };
}

// auth.session admits only session credentials, but a handler's principal is typed as every kind.
function sessionUserId(principal: Principal): string {
  if (principal.kind !== 'session') {
    throw new HttpError(403, 'ACCESS_DENIED', 'Access denied');
  }
  return principal.userId;
}
