# Add authentication to a service

`@skeld/auth` puts access control in front of your handlers. Every route declares who may call it, a gate checks that declaration before the handler runs, and a policy decides each protected request and hands the handler a grant. Around that, auth supplies sessions with CSRF tokens, shared rate limits, API keys, JWT verification, password hashing helpers and an OpenID Connect client, over SQLite or PostgreSQL.

Your application keeps its users, their passwords and the mapping from external identities to users. Auth never stores or looks up a user. It calls back into your code when it needs a decision, and it leaves you a short list of [obligations](auth-obligations.md) that only the application can meet.

`@skeld/auth` 0.2.0 is not released: it is not on npm and exists only in this repository, beside `@skeld/core`, its one dependency. A workspace package uses it the way [`examples/auth`](../../examples/auth/README.md) does:

```json
{ "dependencies": { "@skeld/auth": "workspace:*", "@skeld/core": "workspace:*" } }
```

It needs Node 26.12 or later. The SQLite store uses Node's built-in `node:sqlite`; the PostgreSQL store uses a `pg` Pool that your application creates.

## A complete service

This file is a whole service: a user table, a sign-in route, a note that only its owner may read, and auth's session routes. It is checked by the consumer compile of this page and was run to produce the output below.

```ts
import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { resolve } from 'node:path';
import { hashPassword, verifyPassword } from '@skeld/auth/password';
import { definePolicy } from '@skeld/auth/policy';
import { sessionRoutes, sessionStateSchema } from '@skeld/auth/routes';
import { createAuth } from '@skeld/auth/server';
import { createSqliteStore } from '@skeld/auth/sqlite';
import { defineContract, errorBodySchema } from '@skeld/core/contract';
import { HttpError } from '@skeld/core/http-error';
import * as t from '@skeld/core/schema';
import { Secret } from '@skeld/core/secret';
import { createServer } from '@skeld/core/server';

// The application's own data: users with password hashes, and notes. A real service keeps them in its database.
interface User {
  readonly id: string;
  hash: string;
}
interface Note {
  readonly id: string;
  readonly owner: string;
  readonly text: string;
}

async function hash(password: string): Promise<string> {
  const hashed = await hashPassword(new Secret(password));
  if (hashed.kind !== 'hashed') {
    throw new Error(`hashing answered ${hashed.kind}`);
  }
  return hashed.hash;
}

const password = randomBytes(12).toString('base64url');
const users = new Map<string, User>([['ada', { id: 'ada', hash: await hash(password) }]]);
const notes = new Map<string, Note>([['n1', { id: 'n1', owner: 'ada', text: 'Buy milk.' }]]);
// Verified when there is no user, so an unknown name costs one hash computation like a wrong password.
const dummyHash = await hash(randomBytes(16).toString('base64url'));

const noteId = t.string({ minLength: 1, maxLength: 64 });

const notePolicy = definePolicy('notes', {
  credentials: ['session'],
  input: { id: noteId },
  load: ({ input }) => notes.get(input.id) ?? null,
  actions: { read: ({ principal, resource }) => resource.owner === principal.userId },
});
const readNote = notePolicy.operation('read', (grant) => grant.resource);

const contract = defineContract({
  health: { method: 'GET', path: '/health', access: 'public', responses: { 204: null } },
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
  readNote: {
    method: 'GET',
    path: '/notes/:id',
    access: { policy: 'notes', action: 'read' },
    params: t.object({ id: noteId }),
    responses: {
      200: t.object({
        id: t.string({ maxLength: 64 }),
        owner: t.string({ maxLength: 128 }),
        text: t.string({ maxLength: 500 }),
      }),
    },
  },
});

const port = Number(process.env.PORT ?? 3000);
const origin = `http://127.0.0.1:${port}`;
const store = createSqliteStore({ path: resolve('auth.db') });
const installed = await store.install();
if (installed.kind === 'mismatch') {
  throw new Error(`auth.db holds schema version ${installed.found}`);
}

const auth = createAuth({
  store,
  origin,
  policies: [notePolicy],
  limits: { login: { max: 10, windowSeconds: 60 } },
});

const server = createServer({ gate: auth.gate, publicOrigin: origin, csrf: { mode: 'strict' } });
server.routes(sessionRoutes, auth.handlers.session);

const loginFailed = { status: 401, code: 'LOGIN_FAILED', message: 'Username or password not accepted' } as const;
const unavailable = () => new HttpError(503, 'UNAVAILABLE', 'Service unavailable');

server.routes(contract, {
  health: () => ({ status: 204 }),
  readNote: (request) => ({ status: 200, body: readNote(request.grant) }),
  login: async (request) => {
    const { username, password } = request.body;
    const { signal } = request;
    const verdict = await auth.limits.charge('login', { clientAddress: request.clientAddress }, signal);
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
    const user = users.get(username);
    let verified = false;
    const result =
      user === undefined
        ? null
        : await auth.sessions.establish({
            rawCookies: request.rawCookies,
            userId: user.id,
            signal,
            verify: async (verifySignal) => {
              verified = true;
              // Read the stored hash here, inside the call, never before establish.
              const current = users.get(user.id)?.hash ?? dummyHash;
              const checked = await verifyPassword(password, current, { signal: verifySignal });
              return checked.kind === 'busy' ? 'unavailable' : checked.kind === 'match';
            },
          });
    if (result?.kind === 'established') {
      return { status: 200, body: result.session, cookies: result.cookies };
    }
    if (result?.kind === 'unavailable' || result?.reason === 'callback') {
      throw unavailable();
    }
    if (!verified) {
      const checked = await verifyPassword(password, dummyHash, { signal });
      if (checked.kind === 'busy') {
        throw unavailable();
      }
    }
    return { status: 401, body: loginFailed };
  },
});

await server.listen({ port, host: '127.0.0.1' });
process.stderr.write(`listening on ${origin}; the password of ada is ${password}\n`);
await Promise.race([once(process, 'SIGINT'), once(process, 'SIGTERM')]);
await server.close();
```

Save it as `service.ts` in a workspace package that depends on both packages and start it with `node --conditions=skeld-source service.ts` (the condition runs the packages from source, as the repository's own examples do). It creates `auth.db` in the current folder and prints the password it generated for `ada`:

```text
listening on http://127.0.0.1:3000; the password of ada is WV-_x2JLdDToUAJQ
```

In a second shell, with that password:

```sh
curl -i -c jar http://127.0.0.1:3000/login -H 'origin: http://127.0.0.1:3000' \
  -H 'content-type: application/json' --data '{"username":"ada","password":"WV-_x2JLdDToUAJQ"}'
```

```text
HTTP/1.1 200 OK
set-cookie: __Host-skeld=6k-AVT0Ne9_HMZ-llNuWeWDYmnPtqym746AGCLA8XYQ; Path=/; Max-Age=86400; HttpOnly; Secure; SameSite=Lax
{"status":"session","userId":"ada","csrfToken":"ORz6VVoegIu8eC7uJDlbDi0_dSkcYr4jJts6h4-OJZc","expiresAt":1794780548133}
```

The note is readable with the cookie and refused without it:

```sh
curl -b jar http://127.0.0.1:3000/notes/n1
curl http://127.0.0.1:3000/notes/n1
curl -b jar http://127.0.0.1:3000/notes/n2
```

```text
{"id":"n1","owner":"ada","text":"Buy milk."}
{"status":401,"code":"CREDENTIAL_MISSING","message":"Credential required"}
{"status":404,"code":"NOT_FOUND","message":"Not found"}
```

Signing out is an unsafe request on a session, so it needs the CSRF token from the sign-in reply as `x-csrf-token`, and the `Origin` header that the strict cross-site check requires:

```sh
curl -i -b jar -X POST http://127.0.0.1:3000/auth/sign-out \
  -H 'origin: http://127.0.0.1:3000' -H 'x-csrf-token: ORz6VVoegIu8eC7uJDlbDi0_dSkcYr4jJts6h4-OJZc'
```

```text
HTTP/1.1 204 No Content
set-cookie: __Host-skeld=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax
```

Without the token the same request is refused with 403 `CSRF_TOKEN_INVALID`; without `Origin` it is refused by the cross-site check with 403 `CROSS_ORIGIN`. After sign-out the old cookie gets 401 `CREDENTIAL_INVALID`. Stop the server with Ctrl-C.

The rest of this page explains each part. [`examples/auth`](../../examples/auth/README.md) is a larger service with tenants, API keys, JWTs, OpenID Connect and password changes, and a walkthrough that checks every behavior described here.

## Install the store

Auth keeps subject fences, sessions, API keys, limit windows and sign-in attempts in a store of its own, separate from your application's database. It holds no user record, address or password.

| Store      | Create it with                                                                              | Suits             |
| ---------- | ------------------------------------------------------------------------------------------- | ----------------- |
| SQLite     | `createSqliteStore({ path })` from `@skeld/auth/sqlite`; `path` is absolute or `':memory:'` | one instance      |
| PostgreSQL | `createPostgresStore({ pool })` from `@skeld/auth/postgres`, with your `pg` Pool            | several instances |

Neither factory opens or queries anything; each checks its options and throws `BootError` `INVALID_OPTION` for a bad one, for example `Invalid sqlite store option paht: is not a key of SqliteStoreOptions`.

`store.install()` creates the schema. It is a deploy step, run once before the service starts: it answers `installed` for a new schema, `current` when version 1 is already there, and `mismatch` with the `found` version otherwise, and it never alters or drops anything. On SQLite it creates the file at mode 0600; an existing file is used with the permissions it has. On PostgreSQL it creates the schema `skeld_auth`.

The service itself never installs. At `listen` the gate attaches to the store and refuses to start when the schema is missing: `listen` rejects with `BootError` `GATE_FAILED` and the message `gate failed: store: not installed` (or `version mismatch`, `version unreadable`, `in use`, `unavailable`).

For PostgreSQL, the store takes your Pool and never ends it:

```ts
import { createPostgresStore, type PgPool } from '@skeld/auth/postgres';

export function authStore(pool: PgPool) {
  return createPostgresStore({ pool, maxClients: 8 });
}
```

Pass a `pg` Pool (`new pg.Pool({ connectionString, max: 16, connectionTimeoutMillis: 5_000 })`). `maxClients` defaults to half of the Pool's `max`. Set `connectionTimeoutMillis` to 5,000 ms or less: pg waits for a connection without limit by default, and auth gives each operation 5,000 ms in all. The [operator requirements](auth-obligations.md#operate-the-store) say what else PostgreSQL needs.

## Create auth and give the server its gate

`createAuth(options)` from `@skeld/auth/server` returns one server's auth. It reads and checks nothing when called; the server checks every option when it boots the gate at `listen`. The handle has:

| Member                  | What it is                                                |
| ----------------------- | --------------------------------------------------------- |
| `auth.gate`             | The gate to pass as `createServer({ gate })`              |
| `auth.handlers.session` | The handlers of `sessionRoutes`                           |
| `auth.sessions`         | `establish` (your sign-in hands a user over) and `rotate` |
| `auth.subjects`         | `read`, `disable`, `enable`, `revokeSessions`             |
| `auth.limits`           | `charge` on your declared limit scopes                    |

Before `listen` resolves, every call on the handle rejects `AuthError` `NOT_READY`; after the server closes, `CLOSED`. One handle serves one server.

Three options tie auth to the server:

- `origin` is your service's origin as `new URL(x).origin` writes it: `https`, or `http` on `localhost`, `127.x.x.x` or `[::1]`. It must also be one of the server's `publicOrigin`, or `listen` rejects with `gate failed: origin: not one of the server's publicOrigin`.
- Auth needs `origin`, port included, before the server listens: the session cookie and each provider's redirect URI are bound to it. A service with auth therefore listens on a port chosen before start. Never use port 0.
- Every route that can accept the session cookie must run under the strict cross-site check, `csrf: { mode: 'strict' }` on the server or on its route group. See [Connect a browser](browser-security.md) for what that check does.

Every option, its bounds and its default are in the [auth reference](../reference/auth.md#createauth-options). A misspelt option key is refused at boot rather than ignored: `gate failed: session: session.idleSecond: is not a key of SessionOptions`.

## Declare access on every route

On a server with a gate, every route declares `access`:

| `access`             | Who passes                                                                      | What the handler receives               |
| -------------------- | ------------------------------------------------------------------------------- | --------------------------------------- |
| `'public'`           | Everyone; no gate step runs                                                     | `principal` and `grant` are `undefined` |
| `'optional'`         | Everyone, with or without a credential; a credential that is sent must be valid | `principal` or `null`; no grant         |
| `{ policy, action }` | A request the policy admits                                                     | `principal` and the policy's `grant`    |

The server refuses to start when a declaration is missing or wrong, naming the route:

| Mistake                                                                                                  | `listen` rejects with                                                                                   |
| -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| A route without `access` on a server with a gate                                                         | `ACCESS_UNDECLARED`: `Route readNote (GET /notes/:id): declares no access on a server with a gate`      |
| A route with `access` on a server without a gate                                                         | `ACCESS_WITHOUT_GATE`: `Route readNote (GET /notes/:id): declares access on a server without a gate`    |
| An unknown policy or action, a policy `input` missing from the route, a credential kind no part installs | `ACCESS_REFUSED`: `Route readNote (GET /notes/:id): access refused: unknown policy`                     |
| A cookie-accepting route outside a strict group, or listed in `csrfExempt`                               | `ACCESS_REFUSED` with `cookie route outside a strict csrf group` or `cookie route listed in csrfExempt` |

The built-in policy `auth.session` with the action `use` admits any live session: use it for routes that only need a signed-in user.

## Decide access with a policy

`definePolicy(name, options)` from `@skeld/auth/policy` describes one kind of resource. For each request to a route that names it, the gate runs, in this order and under one 5,000 ms deadline:

1. `load` with the values named by `input`; `null` or `undefined` answers 404 `NOT_FOUND`.
2. `tenant.of` on the resource, then `tenant.member`; anything but `true` answers 404 `NOT_FOUND`.
3. The route's action; `false` answers 403 `ACCESS_DENIED`, or 404 `NOT_FOUND` with `denial: 'not_found'`.

Only `true` admits. A callback that throws, returns a non-boolean or passes the deadline admits nothing: the request gets the fixed 500, or 503 `AUTH_UNAVAILABLE` past the deadline, and the callback's text reaches no response.

This policy loads a project, hides projects of other tenants, and refuses to archive one twice:

```ts
import { definePolicy } from '@skeld/auth/policy';
import * as t from '@skeld/core/schema';

interface Project {
  readonly id: string;
  readonly tenant: string;
  readonly archived: boolean;
}

const projects = new Map<string, Project>();
const tenantOfUser = new Map<string, string>();

export const projectId = t.string({ minLength: 1, maxLength: 64 });

export const projectPolicy = definePolicy('projects', {
  credentials: ['session', 'api_key'],
  limit: { max: 120, windowSeconds: 60 },
  input: { id: projectId },
  load: ({ input }) => projects.get(input.id) ?? null,
  tenant: {
    of: (project) => project.tenant,
    member: ({ principal, tenant }) => principal.userId !== null && tenantOfUser.get(principal.userId) === tenant,
  },
  actions: {
    read: () => true,
    archive: ({ resource }) => !resource.archived,
  },
});

export const archiveProject = projectPolicy.operation('archive', (grant) => {
  projects.set(grant.resource.id, { ...grant.resource, archived: true });
});
```

- `credentials` lists the credential kinds the policy accepts: `session`, `api_key`, `jwt`. A kind the server does not install is a boot refusal.
- Each `input` schema must be the same schema object, under the same key, as in the route's `params`, `query` or `body`; here `projectId` is shared with the route's `params`.
- `limit` charges one count per policy and principal before `load`; past it the gate answers 429 `RATE_LIMITED` with `retry-after`.
- `tenant` is allowed only with `load`. Without `load` the grant's resource is `null`.

The handler receives `request.grant` and passes it to an operation. `policy.operation(action, body)` wraps the code that acts on the resource: before the body runs it throws `AuthError` if the grant was not issued by the gate (`GRANT_UNKNOWN`), was issued by another policy (`GRANT_POLICY`) or for another action (`GRANT_ACTION`), or belongs to a request that has ended (`GRANT_RELEASED`). It checks nothing else, so the body acts on `grant.resource`, never on an id passed beside the grant. [The obligations for grants](auth-obligations.md#keep-a-grant-inside-its-request) explain why.

## Sessions, cookies and the CSRF token

`sessionRoutes` from `@skeld/auth/routes` declares three routes, and `auth.handlers.session` serves them:

| Route              | Method and path            | Access               | Answers                                                                                                                         |
| ------------------ | -------------------------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `authSession`      | `GET /auth/session`        | `'optional'`         | 200 `{ status: 'none' }`, or the live session with its `csrfToken`                                                              |
| `authSignOut`      | `POST /auth/sign-out`      | `auth.session` `use` | 204 and the clearing cookie, once the session is deleted                                                                        |
| `authSessionClear` | `POST /auth/session/clear` | `'public'`           | 204 and the clearing cookie when no live session holds the cookie; 409 `SESSION_LIVE` when one does; 429 past the address limit |

The session cookie is `__Host-skeld` by default, with `Path=/`, `HttpOnly`, `Secure`, `SameSite=Lax`, no `Domain`, and a `Max-Age` of the absolute lifetime left. A session ends after 3,600 s without use or 86,400 s after it began, whichever comes first. A request that auth admits 300 s or more after the session was last renewed renews it, moving its idle expiry forward but never past the absolute one; a request refused for its CSRF token or by a policy limit renews nothing. Change these with the `session` option.

The CSRF token is derived from the session; auth stores it nowhere. Your page reads it from the sign-in reply or from `GET /auth/session` and sends it as `x-csrf-token` on every POST, PUT, PATCH and DELETE that carries the session cookie. A missing or wrong token is 403 `CSRF_TOKEN_INVALID`. The typed client sends it for you:

```ts
import { sessionRoutes } from '@skeld/auth/routes';
import { createClient } from '@skeld/core/client';

let csrfToken: string | null = null;

const client = createClient(sessionRoutes, {
  baseUrl: 'https://app.example',
  credential: { kind: 'session', csrfToken: () => csrfToken },
});

const state = await client.authSession();
if (state.status === 200 && state.body.status === 'session') {
  csrfToken = state.body.csrfToken;
}
await client.authSignOut();
```

With a session credential the client sends cookies (`credentials: 'include'`) and adds `x-csrf-token` only to unsafe requests to routes that are not `'public'`. A bearer credential (`{ kind: 'bearer', token }`) sends `authorization: Bearer <token>` instead. A browser keeps the cookie; Node's fetch has no cookie jar.

`auth.sessions.rotate({ rawCookies })` replaces the request's one session cookie with a new token that keeps the session's creation time and absolute expiry, and answers `rotated` with the new cookie, `refused` `no_session`, or `Unavailable`.

## Sign people in with your own login

Auth has no sign-in route for passwords. Your route checks the request, then hands the user over with `auth.sessions.establish`, as the `login` handler above does:

1. Charge a limit before any hashing.
2. Look the user up in your store. For an unknown user, verify the password against a dummy hash and answer as for a wrong password.
3. Call `establish` with the user id and a `verify` callback. Auth takes a snapshot of the user's fence, then calls `verify` once, under 10,000 ms. `verify` reads the stored hash inside the call and answers `true`, `false`, or `'unavailable'` when it cannot judge (for example, `verifyPassword` answered `busy`).
4. On `established`, reply with `result.session` and set `result.cookies`. On `refused` (`rejected`, `disabled`, `stale` or `callback`) or `Unavailable`, there is no session and no cookie.

Each of these steps exists because of an obligation; [Sign people in](auth-obligations.md#sign-people-in) states them with what happens when one is skipped.

The password helpers in `@skeld/auth/password` hash with the platform's Argon2id. `hashPassword` answers `hashed`, `invalid_password` (outside 1 to 1,024 bytes) or `busy`; `verifyPassword` answers `match`, `mismatch`, `invalid_hash` or `busy`; `needsRehash(hash, cost)` says whether a stored hash is below a cost. They compute; they never store or look anything up. Two computations run at once in the process and at most 64 callers wait, each for at most 5,000 ms.

## Limit expensive work

Declare the scopes your application charges, then charge before the work:

- `limits: { login: { max: 10, windowSeconds: 60 } }` in `createAuth`'s options declares a scope; at most 32 scopes, none starting `auth.`.
- `auth.limits.charge('login', key, signal)` counts one charge. The key is a text of 1 to 256 characters or `{ clientAddress }`, which counts an IPv6 address by its /64 and an IPv4-mapped IPv6 address as the IPv4 address.
- The verdict is `pass` with `remaining` and `resetAt`, `limited` with `retryAfterSeconds`, or `Unavailable` when the store cannot answer. A store failure is never a pass. There is no refund.

Your handler answers a `limited` verdict itself, with its own 429. Auth also has two limits of its own, which answer 429 `RATE_LIMITED` with `retry-after` for you: a policy's `limit`, and `addressLimit` (default 10 per 60 s per route and client address) on its public routes `authSessionClear`, `authOidcStart` and `authOidcCallback`.

## Accept API keys

`apiKeys(options)` from `@skeld/auth/api-key` makes the API-key part. Give it to `createAuth` and keep it: its methods are trusted server-side calls, and there are no API-key routes.

```ts
import { apiKeys } from '@skeld/auth/api-key';
import { createAuth } from '@skeld/auth/server';
import { createSqliteStore } from '@skeld/auth/sqlite';
import { expose } from '@skeld/core/secret';

export const keys = apiKeys({ maxPerUser: 20 });

export const auth = createAuth({
  store: createSqliteStore({ path: '/var/lib/app/auth.db' }),
  origin: 'https://app.example',
  apiKeys: keys,
});

// Call only after deciding that the caller may issue a key for this user.
export async function issueKey(userId: string): Promise<string | null> {
  const issued = await keys.issue({ userId, name: 'CI deploy', scopes: ['projects:read'], expiresInSeconds: 86_400 });
  return issued.kind === 'issued' ? expose(issued.key) : null;
}
```

- A key is `skeld1.<16 characters>.<43 characters>`, sent as `authorization: Bearer <key>`. Show it once: auth stores only a digest, and `list` never returns it.
- `scopes` holds 1 to 32 texts `<policy>:<action>`. A key passes a policy route only when the policy lists `api_key` and the key holds that route's scope. Scopes are checked for their grammar only: a misspelt scope issues a key that matches no route.
- `issue` answers `issued`, `refused` (`limit`, past `maxPerUser`, or `disabled`) or `Unavailable`; `list` answers `listed`; `revoke` answers `revoked` or `absent`.
- Disabling a subject refuses its keys until it is enabled again; it does not revoke them.

## Accept JWTs from an external issuer

`jwt(options)` from `@skeld/auth/jwt` verifies bearer tokens that another service issued. Auth never signs a token.

```ts
import { jwt } from '@skeld/auth/jwt';

const knownUsers = new Set(['ada']);

export const bearer = jwt({
  issuer: 'https://login.example',
  audience: 'https://api.example',
  algorithms: ['RS256'],
  jwksUrl: 'https://login.example/.well-known/jwks.json',
  map: (verified) =>
    knownUsers.has(verified.subject) ? { kind: 'accept', userId: verified.subject } : { kind: 'deny' },
});
```

Give it as `createAuth({ jwt: bearer, ... })`. A bearer token that does not start with `skeld1.` goes to the JWT verifier and is never tried as an API key, nor an API key as a JWT. It checks the header, the signature with a key from `keys` or `jwksUrl`, `iss`, `aud`, `exp` and `nbf` (60 s of leeway each) and `sub`, then calls `map` under 5,000 ms. `map` accepts with a `userId`, or `null` for a token that is no user of yours, or denies. The [reference](../reference/auth.md#jwt-verification) lists every check.

A JWT stays valid until it expires: signing out, disabling the subject or revoking sessions does not affect it.

## Sign in with OpenID Connect

`oidc(options)` from `@skeld/auth/oidc` is a generic authorization-code client with PKCE, `state` and `nonce`. It finds each provider through its discovery document and hands the verified identity to your `resolveUser`.

```ts
import { oidc } from '@skeld/auth/oidc';
import { Secret } from '@skeld/core/secret';

const userOfIdentity = new Map<string, string>();
const clientSecret = process.env.ACME_CLIENT_SECRET;
if (clientSecret === undefined) {
  throw new Error('ACME_CLIENT_SECRET is not set');
}

export const signIn = oidc({
  providers: {
    acme: { issuer: 'https://id.acme.example', clientId: 'notes-app', clientSecret: new Secret(clientSecret) },
  },
  failurePath: '/sign-in',
  resolveUser: (identity) => {
    const userId = userOfIdentity.get(`${identity.issuer} ${identity.subject}`);
    return userId === undefined ? { kind: 'deny' } : { kind: 'user', userId };
  },
});
```

Give the part to `createAuth({ oidc: signIn, ... })` and register its routes with `server.routes(oidcRoutes, signIn.handlers)`. At the provider, register the redirect URI `<origin>/auth/oidc/<provider name>/callback`, here `https://app.example/auth/oidc/acme/callback` for an origin of `https://app.example`.

1. The page sends `POST /auth/oidc/acme/start` with an optional `returnTo` local path. Auth answers 200 `{ url }` and sets the attempt cookie `__Host-skeld-oidc-acme` for 600 s. A start that fails sets no cookie and answers 400 `RETURN_PATH_REFUSED` for a return path auth refuses, 404 `NOT_FOUND` for an unconfigured provider, 429 `RATE_LIMITED` over the address limit, 503 `PROVIDER_UNAVAILABLE` when the provider's configuration cannot be had or is refused, or 503 `AUTH_UNAVAILABLE` when the store fails.
2. The page navigates to `url`. The person signs in at the provider, which redirects to the callback route.
3. The callback spends the attempt, exchanges the code with `client_secret_basic`, verifies the ID Token, and calls `resolveUser`. On `user`, it establishes a session and answers 303 to the return path with the session cookie.
4. A sign-in that fails at the attempt, the provider, the token checks or the mapping answers 303 to `failurePath` with `provider` and `error` in the query, for example `/sign-in?provider=acme&error=mapping_denied`, and clears the attempt cookie. The [reference](../reference/auth.md#oidc-callback-codes) lists the codes. Three answers are not a redirect: 404 `NOT_FOUND` for an unconfigured provider, 429 `RATE_LIMITED` over the address limit, and 503 `AUTH_UNAVAILABLE` when the store fails or the service shuts down during the callback.

`resolveUser` receives the issuer and subject that auth verified, with the `email`, `emailVerified` and `name` claims for your own use. It is called twice, the second time inside the session handoff, and both answers must name the same user. Only an existing user signs in: attaching an account by its email is not a supported mapping. Provider requirements, such as RS256 ID Tokens and PKCE with `S256`, are in the [reference](../reference/auth.md#oidc-providers).

Auth reaches providers over HTTPS with Node's default certificate trust, and certificate and host-name verification cannot be turned off. A provider behind a private certificate authority is covered in [Trust a private certificate authority](auth-obligations.md#trust-a-private-certificate-authority).

## Shut down

Stop the service with `server.close()`, as the complete service above does on SIGINT and SIGTERM. Once HTTP work has drained, auth stops admitting, aborts the signals it gave pending callbacks and calls `store.close()` within the server's `pluginCloseTimeoutMs`. It never ends a PostgreSQL Pool you passed it: end the Pool yourself after `server.close()` resolves.

## Read auth's records

Auth writes ten security events through the server's logger, such as `auth.signin.failed` and `auth.store.failed`. Their fields are under the record's `fields` object and hold ids and fixed words, never a password, token, address or claim:

```text
{"severity_text":"warn","event_name":"auth.signin.failed","skeld.category":"security","fields":{"auth.user":"ada","auth.via":"handoff","auth.reason":"rejected"}}
```

Three of them are `info` (`auth.signin.succeeded`, `auth.session.revoked`, `auth.credential.changed`), so the default `security` threshold of `warn` does not write them; set `log: { thresholds: { security: 'info' } }` to keep them. Gate refusals are core's `skeld.refuse.*` records. A sign-in your application refuses before calling `establish`, such as an unknown user, writes no auth record: log it yourself. The [reference](../reference/auth.md#security-events) lists every event and field.

**Next:** [meet the application's obligations](auth-obligations.md). Reference: [auth behavior](../reference/auth.md) and the [auth API](../api/auth/server.md).
