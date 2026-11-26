# Auth behavior reference

`@skeld/auth` supplies the gate that enforces route access on a skeld server, policies and grants, sessions with CSRF tokens, shared limits, API keys, JWT verification, Argon2id password helpers and a generic OpenID Connect client, over SQLite or PostgreSQL. Applications own users, credentials and the mapping from identities to users.

Install it with `npm install @skeld/auth`. It needs Node 26.12 or later (`engines`: `node >=26.12.0`) and depends only on `@skeld/core`. For a guided introduction, read [Add authentication to a service](../guides/auth.md) and [the application's obligations](../guides/auth-obligations.md). Exact signatures are in the [API reference](../api/README.md#auth-api).

## Subpaths

The package has no root export.

| Import                          | Exports                                                                                                                                                                                                                                                                                                                      |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@skeld/auth/server`            | `createAuth`; the types `Auth`, `AuthOptions`, `SessionOptions`, `AuthAccess`, `AuthAccessOf`, `CreateAuth`, `Sessions`, `EstablishInput`, `Established`, `Rotated`, `SessionState`, `LiveSession`, `Subjects`, `SubjectChanged`, `EnableRefused`, `Limits`, `LimitKey`, `LimitRule`, `LimitVerdict`, `Grant`, `Unavailable` |
| `@skeld/auth/policy`            | `definePolicy`, `isPrincipal`, `isGrant`; the types `Policy`, `PolicyOptions`, `DefinePolicy`, `AnyPolicy`, `Grant`, `Principal`, `SessionPrincipal`, `ApiKeyPrincipal`, `JwtPrincipal`, `CredentialKind`                                                                                                                    |
| `@skeld/auth/routes`            | `sessionRoutes`, `oidcRoutes`, `sessionStateSchema`; the types `SessionRoutes`, `OidcRoutes`                                                                                                                                                                                                                                 |
| `@skeld/auth/auth-error`        | `AuthError`; the type `AuthErrorCode`                                                                                                                                                                                                                                                                                        |
| `@skeld/auth/store`             | `StoreFailure`; the store contract types (`AuthStore`, `InstallResult`, `AttachResult`, `StoreOperations`, `Done`, `Lost`, `Unavailable`, `Digest`, …)                                                                                                                                                                       |
| `@skeld/auth/sqlite`            | `createSqliteStore`; the type `SqliteStoreOptions`                                                                                                                                                                                                                                                                           |
| `@skeld/auth/postgres`          | `createPostgresStore`; the types `PostgresStoreOptions`, `PgPool`, `PgClient`                                                                                                                                                                                                                                                |
| `@skeld/auth/store-conformance` | `runStoreConformance`; the types `ConformanceTarget`, `ConformanceReport`                                                                                                                                                                                                                                                    |
| `@skeld/auth/api-key`           | `apiKeys`; the types `ApiKeys`, `ApiKeyOptions`, `ApiKeyInfo`                                                                                                                                                                                                                                                                |
| `@skeld/auth/jwt`               | `jwt`; the types `Jwt`, `JwtOptions`, `Jwk`, `JwtMap`, `JwtMapped`                                                                                                                                                                                                                                                           |
| `@skeld/auth/oidc`              | `oidc`; the types `Oidc`, `OidcOptions`, `OidcProvider`, `OidcIdentity`, `OidcClaims`, `OidcResolveUser`, `OidcResolution`                                                                                                                                                                                                   |
| `@skeld/auth/password`          | `hashPassword`, `verifyPassword`, `needsRehash`; the types `PasswordCost`, `Hashed`, `PasswordVerdict`                                                                                                                                                                                                                       |
| `@skeld/auth/package.json`      | the manifest                                                                                                                                                                                                                                                                                                                 |

Core gained the subpath `@skeld/core/gate` (`GateFault`, `CSRF_TOKEN_HEADER` and the gate types) and the `access` member of a route declaration; see the [core gate API](../api/core/gate.md).

## createAuth options

`createAuth` checks nothing. The server checks every option when it boots the gate at `listen`, and a refused option makes `listen` reject with `BootError` `GATE_FAILED` (see [Boot refusals](#boot-refusals)). Every option object refuses an own key its type does not name.

| Option         | Type and bounds                                                                                                                                                     | Default                          |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------- |
| `store`        | an `AuthStore` from `createSqliteStore` or `createPostgresStore`                                                                                                    | required                         |
| `origin`       | the service's origin as `new URL(x).origin` writes it, port included: `https`, or `http` on `localhost`, `127.x.x.x` or `[::1]`; one of the server's `publicOrigin` | required                         |
| `policies`     | a tuple of `definePolicy` values; names unique, none starting `auth.`                                                                                               | none                             |
| `session`      | `SessionOptions`, below                                                                                                                                             | the defaults below               |
| `limits`       | `{ [scope]: LimitRule }`; at most 32 scopes, each an access name not starting `auth.`                                                                               | none                             |
| `addressLimit` | `LimitRule` for auth's public routes, per route and client address                                                                                                  | `{ max: 10, windowSeconds: 60 }` |
| `apiKeys`      | the value of `apiKeys()`                                                                                                                                            | not installed                    |
| `jwt`          | the value of `jwt()`                                                                                                                                                | not installed                    |
| `oidc`         | the value of `oidc()`                                                                                                                                               | not installed                    |

An access name (a policy, action or limit scope) is 1 to 64 characters: a letter, then letters, digits, `_`, `.` and `-`. A user id is 1 to 128 characters of `A-Z a-z 0-9 - _ . :`.

| `SessionOptions` member | Bounds                                                   | Default                                                    |
| ----------------------- | -------------------------------------------------------- | ---------------------------------------------------------- |
| `cookieName`            | starts `__Host-`; an HTTP token of at most 64 characters | `__Host-skeld`                                             |
| `idleSeconds`           | integer, 2 to 2,592,000                                  | 3,600                                                      |
| `absoluteSeconds`       | integer, `idleSeconds` to 2,592,000                      | 86,400                                                     |
| `renewSeconds`          | integer, 1 to half of `idleSeconds`                      | the smaller of 300 and half of `idleSeconds`, rounded down |

A `LimitRule` is `{ max, windowSeconds }`: integers, `max` 1 to 1,000,000 and `windowSeconds` 1 to 86,400, one fixed window.

## Routes

| Route              | Method and path                     | Access               | Input                                                                           | Responses                                                                                                                                             |
| ------------------ | ----------------------------------- | -------------------- | ------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `authSession`      | `GET /auth/session`                 | `'optional'`         | none                                                                            | 200 `SessionState`, with `cache-control: no-store`; `status: 'session'` only for a session principal                                                  |
| `authSignOut`      | `POST /auth/sign-out`               | `auth.session` `use` | none                                                                            | 204 and the clearing cookie, after the session row is deleted                                                                                         |
| `authSessionClear` | `POST /auth/session/clear`          | `'public'`           | none                                                                            | 204 and the clearing cookie when no live session holds the cookie; 409 `SESSION_LIVE`; 429                                                            |
| `authOidcStart`    | `POST /auth/oidc/:provider/start`   | `'public'`           | `provider` (1 to 32); body `returnTo?` (1 to 512)                               | 200 `{ url }` (at most 4,096) and the attempt cookie; 400 `RETURN_PATH_REFUSED`; 404 `NOT_FOUND`; 429; 503 `PROVIDER_UNAVAILABLE`, `AUTH_UNAVAILABLE` |
| `authOidcCallback` | `GET /auth/oidc/:provider/callback` | `'public'`           | query `state` (43), `code?` (1 to 2,048), `iss?` (1 to 255), `error?` (1 to 64) | 303 to a local path; 404 `NOT_FOUND`; 429; 503 `AUTH_UNAVAILABLE`                                                                                     |

The first three are `sessionRoutes`, served by `auth.handlers.session`; the last two are `oidcRoutes`, served by `oidc().handlers`. Each 429 is `errorBodySchema` with `RATE_LIMITED`, `Too many requests` and `retry-after`. `authSessionClear`, `authOidcStart` and `authOidcCallback` read cookies, so each must sit in a route group whose cross-site check is `strict` and must not be listed in `csrfExempt`.

**The session cookie.** `cookieName`, the token, `Path=/`, `HttpOnly`, `Secure`, `SameSite=Lax`, no `Domain`, and `Max-Age` the whole seconds of absolute lifetime left, at least 1. The clearing cookie has the same name and attributes and `Max-Age=0`. A token is 32 random bytes as 43 base64url characters; only that canonical text is accepted. The OIDC attempt cookie is `<cookieName>-oidc-<provider>` with the same attributes and `Max-Age=600`.

**The CSRF token.** HMAC-SHA-256 keyed by the session token's 32 bytes over the text `skeld.auth.csrf.v1`, as 43 base64url characters. It is recomputed for each request and never stored. It is sent as `x-csrf-token` on POST, PUT, PATCH and DELETE requests that carry a session, and compared in constant time after the session is found live.

**Renewal.** Renewal is the last step of identification, after the CSRF check and the policy limit, so only a request `identify` admits renews, and one refused for its CSRF token or by a policy limit renews nothing. When an admitted request arrives `renewSeconds` or more after the session was last renewed, auth starts one renewal without waiting for it; at twice that it waits, and a failed renewal still admits. A renewal sets the idle expiry to `now + idleSeconds`, never past the absolute expiry.

## Credentials at the gate

For a route that is not `'public'`, the gate counts the request's credentials, checks their grammar, reads the store or calls the bearer verifier, checks the CSRF token for an unsafe request with a session, checks an API key's scope on a policy route, and charges the policy's limit. Then, after the request is validated, the policy runs.

- A session is the cookie named `cookieName`. A bearer token is `authorization: Bearer <token>`, 1 to 4,096 `b64token` characters. A token starting `skeld1.` is an API key; any other is a JWT. A token refused as one kind is never tried as the other.
- Two session cookies, or a session cookie beside an `authorization` header, is a conflict.
- An `'optional'` route accepts every installed kind and admits a request with no credential as `null`, reading nothing.
- A request that needs neither the store nor a limiter is not refused during a store outage: a `'public'` route, an `'optional'` request with no credential, and a JWT on a policy with no `limit`.
- A policy runs `load`, `tenant.of`, `tenant.member` and the action under one 5,000 ms deadline. Only `true` admits.

## Gate refusals

The status, code, message and headers of a refusal are fixed by core. No handler or hook runs, and no `onError` hook or error handler sees it.

| Reason                | When                                                                                                                           | Status | Code                  | Message                              |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ------ | --------------------- | ------------------------------------ |
| `credential_missing`  | No credential on a policy route                                                                                                | 401    | `CREDENTIAL_MISSING`  | `Credential required`                |
| `credential_invalid`  | A malformed, unknown, expired, revoked or disabled credential; a kind not installed or not listed by the policy; a refused JWT | 401    | `CREDENTIAL_INVALID`  | `Credential not accepted`            |
| `credential_conflict` | Two session cookies, or one beside `authorization`                                                                             | 400    | `CREDENTIAL_CONFLICT` | `More than one credential`           |
| `csrf_token`          | An unsafe session request whose `x-csrf-token` is absent or wrong                                                              | 403    | `CSRF_TOKEN_INVALID`  | `CSRF token missing or not accepted` |
| `rate_limited`        | A policy `limit` passed                                                                                                        | 429    | `RATE_LIMITED`        | `Too many requests`                  |
| `access_denied`       | An action answered `false`; an API key without the route's scope                                                               | 403    | `ACCESS_DENIED`       | `Access denied`                      |
| `access_hidden`       | `tenant.member` answered `false`, or an action did under `denial: 'not_found'`                                                 | 404    | `NOT_FOUND`           | `Not found`                          |
| `resource_missing`    | `load` answered `null` or `undefined`                                                                                          | 404    | `NOT_FOUND`           | `Not found`                          |
| `unavailable`         | The store, a limiter or the key set cannot answer; a policy past 5,000 ms                                                      | 503    | `AUTH_UNAVAILABLE`    | `Service unavailable`                |

`credential_missing` and `credential_invalid` add `www-authenticate: Bearer` when the route accepts API keys or JWTs (missing) or the request sent `authorization` (invalid). `rate_limited` adds `retry-after`, 1 to 86,400 seconds. Each refusal writes one core record `skeld.refuse.<reason>` (see [Events](../logging/events.md)).

A policy callback that throws or answers a non-boolean, and a JWT `map` that throws, is late or answers a malformed value, give core's fixed 500 `INTERNAL`, with no handler run. A failing `resolveUser` is the callback code `mapping_failed`.

## Handler errors

| Code                   | Status | Message                        | When                                                                          |
| ---------------------- | ------ | ------------------------------ | ----------------------------------------------------------------------------- |
| `SESSION_LIVE`         | 409    | `Session is live`              | `authSessionClear` for a live session; nothing cleared                        |
| `AUTH_UNAVAILABLE`     | 503    | `Service unavailable`          | A store or limiter failure in one of auth's handlers; nothing cleared         |
| `RETURN_PATH_REFUSED`  | 400    | `Return path not accepted`     | `authOidcStart` with a `returnTo` that `checkRedirect` refuses                |
| `PROVIDER_UNAVAILABLE` | 503    | `Sign-in provider unavailable` | `authOidcStart` when the provider's configuration cannot be had or is refused |
| `NOT_FOUND`            | 404    | `Not found`                    | An OIDC route for an unconfigured provider                                    |

## Boot refusals

`listen` rejects with a `BootError`; nothing is bound and the server does not start.

| Code                  | When                                                                              | Message                                                                      |
| --------------------- | --------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `ACCESS_UNDECLARED`   | A route declares no `access` on a server with a gate                              | `Route <name> (<METHOD> <path>): declares no access on a server with a gate` |
| `ACCESS_WITHOUT_GATE` | A route declares `access` on a server without a gate                              | `Route <name> (<METHOD> <path>): declares access on a server without a gate` |
| `ACCESS_REFUSED`      | The gate refused the route, or a cookie-accepting route is outside a strict group | `Route <name> (<METHOD> <path>): access refused: <finding>`                  |
| `GATE_FAILED`         | The gate's boot refused an option or the store                                    | `gate failed: <component>: <finding>`                                        |
| `GATE_FAILED`         | Any other boot failure, or the boot passed `pluginTimeoutMs`                      | `gate failed`                                                                |

`ACCESS_REFUSED` findings: `unknown policy`, `unknown action`, `policy input not in the route schemas`, `credential kind not installed`, `cookie route outside a strict csrf group`, `cookie route listed in csrfExempt`.

`GATE_FAILED` components and their fixed findings:

| Component                                                            | Findings                                                                                                                   |
| -------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `store`                                                              | `not installed`, `version mismatch`, `version unreadable`, `in use`, `unavailable`; `store: must be an auth store`         |
| `origin`                                                             | `not one of the server's publicOrigin`; `origin: must be an origin, https or http on a loopback host`                      |
| `auth`                                                               | `already booted` (one handle given to a second server)                                                                     |
| `api_key`, `jwt`, `oidc`                                             | `already attached` (one part given to two handles)                                                                         |
| `options`, `session`, `limits`, `policies`, `api_key`, `jwt`, `oidc` | the option's path and its rule, never its value, for example `session.idleSeconds: must be an integer from 2 to 2,592,000` |

An unknown key in an option object:

| Option object              | Component  | Message `listen` gives                                                                     |
| -------------------------- | ---------- | ------------------------------------------------------------------------------------------ |
| `createAuth`'s options     | `options`  | `gate failed: options: sesion: is not a key of AuthOptions`                                |
| `session`                  | `session`  | `gate failed: session: session.idleSecond: is not a key of SessionOptions`                 |
| `limits.<scope>`           | `limits`   | `gate failed: limits: limits.login.mx: is not a key of LimitRule`                          |
| `addressLimit`             | `limits`   | `gate failed: limits: addressLimit.mx: is not a key of LimitRule`                          |
| a policy's options         | `policies` | `gate failed: policies: policies[0].denail: is not a key of PolicyOptions`                 |
| a policy's `limit`         | `policies` | `gate failed: policies: policies[0].limit.mx: is not a key of LimitRule`                   |
| a policy's `tenant`        | `policies` | `gate failed: policies: policies[0].tenant.memberOf: is not a key of PolicyOptions.tenant` |
| the options of `apiKeys()` | `api_key`  | `gate failed: api_key: apiKeys.maxPerUsr: is not a key of ApiKeyOptions`                   |
| the options of `jwt()`     | `jwt`      | `gate failed: jwt: jwt.audiance: is not a key of JwtOptions`                               |
| the options of `oidc()`    | `oidc`     | `gate failed: oidc: oidc.failurPath: is not a key of OidcOptions`                          |
| a provider of `oidc()`     | `oidc`     | `gate failed: oidc: oidc.providers.local.clientID: is not a key of OidcProvider`           |

The store factories check their options when called and throw `BootError` `INVALID_OPTION` with the message `Invalid <sqlite|postgres> store option <name>: <rule>`; for an unknown key the rule is `is not a key of SqliteStoreOptions` or `is not a key of PostgresStoreOptions`. `definePolicy` throws `TypeError` for a name outside the access-name grammar or starting `auth.`.

## AuthError

Every server-side call and every operation rejects or throws `AuthError`, whose message is fixed by its code and holds no value you passed.

| Code              | Message                   | When                                                                                                                             |
| ----------------- | ------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `NOT_READY`       | `auth is not ready`       | A call before the server's `listen` resolved                                                                                     |
| `CLOSED`          | `auth is closed`          | A call after the server closed                                                                                                   |
| `INVALID_INPUT`   | `invalid input`           | A user id, scope, key, name, generation or cost outside its bound; an unknown key in a call's input object                       |
| `UNAVAILABLE`     | `auth is unavailable`     | The platform's hash computation failed                                                                                           |
| `CALLBACK_FAILED` | `callback failed`         | A policy callback or the JWT `map` threw, was late or answered a malformed value inside a gate step; it becomes core's fixed 500 |
| `GRANT_UNKNOWN`   | `grant not issued`        | An operation given a value the gate did not issue, including a copy with any member changed                                      |
| `GRANT_POLICY`    | `grant of another policy` | An operation given another policy's grant                                                                                        |
| `GRANT_ACTION`    | `grant of another action` | An operation given a grant for another action                                                                                    |
| `GRANT_RELEASED`  | `grant released`          | An operation given a grant whose request has ended                                                                               |

A live grant used from another request is none of these and is not refused.

## Server-side calls

| Call                                                               | Answers                                                                                                                                                                                                          |
| ------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `auth.sessions.establish({ rawCookies, userId, verify, signal? })` | `established` with `session` and `cookies`; `refused` with `rejected` (`verify` answered `false`), `disabled`, `stale` or `callback` (`verify` threw, answered another value or passed 10,000 ms); `Unavailable` |
| `auth.sessions.rotate({ rawCookies, signal? })`                    | `rotated` with `session` and `cookies`; `refused` `no_session`; `Unavailable`                                                                                                                                    |
| `auth.subjects.read(userId)`                                       | `subject` with `enabled` and `generation`; `absent`; `Unavailable`                                                                                                                                               |
| `auth.subjects.disable(userId)`                                    | `done` with `enabled: false` and the new `generation`; every session ended; `Unavailable`                                                                                                                        |
| `auth.subjects.enable(userId, expectedGeneration)`                 | `done` (enabled, generation raised, every session ended) only for a subject disabled at exactly `expectedGeneration`; `refused` `absent`, `enabled` or `stale`, changing nothing; `Unavailable`                  |
| `auth.subjects.revokeSessions(userId)`                             | `done`, generation raised and every session ended, `enabled` unchanged; API keys untouched; `Unavailable`                                                                                                        |
| `auth.limits.charge(scope, key, signal?)`                          | `pass` with `remaining` and `resetAt`; `limited` with `retryAfterSeconds` (rounded up, at least 1); `Unavailable`                                                                                                |

`verify` may answer `'unavailable'`, which makes `establish` answer `Unavailable` `not_applied` with no `auth.callback.failed`. A subject's fence row is created on first use and never deleted, so a reused user id cannot revive old authority. Auth never re-enables a subject by itself.

## Store outcomes

Every store result is one of four outcomes, and every caller treats them the same way.

| Outcome       | Means                                                                  | The caller                                                                        |
| ------------- | ---------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `done`        | The change committed, or the read answered                             | acts on the result                                                                |
| `lost`        | A condition did not hold; the unit rolled back and nothing changed     | reads the reason (for example `enable`'s `refused`) and decides                   |
| `not_applied` | The unit failed before its commit was sent; nothing changed            | may repeat the same call                                                          |
| `unknown`     | The commit was sent and its answer never arrived; the change may stand | reads the state before acting again; never treats it as success or as not applied |

At the server-side calls, a failure is `Unavailable` with `outcome: 'not_applied'` or `'unknown'`. Auth repeats no unit by itself. At the gate a store failure is 503 `AUTH_UNAVAILABLE`, and a store read that fails is never taken as "signed out" or "absent".

A store operation called directly through `store.ops` rejects only with `StoreFailure`, whose message is `auth store: <operation>: <reason>`:

| `reason`      | `applied` | When                                                                                                                                                                                                                                       |
| ------------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `unavailable` | `no`      | PostgreSQL: no client within 5 s, 1,000 callers already waiting, a lock or statement timeout, the deadline or a lost connection before the commit was sent. SQLite: still busy after 10 attempts. Either: before `attach` or after `close` |
| `unavailable` | `unknown` | The commit was sent and its answer did not arrive (PostgreSQL), or the commit itself failed (SQLite)                                                                                                                                       |
| `fault`       | `no`      | Any other engine error before the commit; a `limit` outside 1 to 1,000                                                                                                                                                                     |
| `record`      | `no`      | A stored row that does not parse into its record; a `schema_version` table without exactly one integer row                                                                                                                                 |
| `aborted`     | `no`      | The caller's signal aborted before the unit began                                                                                                                                                                                          |

## Stores

|            | SQLite (`createSqliteStore`)                                                                                                        | PostgreSQL (`createPostgresStore`)                                                                                                                                  |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Options    | `path` (absolute, or `':memory:'`); `cleanupIntervalSeconds` 1 to 3,600, default 60                                                 | `pool` (your `pg` Pool, never ended by auth); `maxClients` 1 to `pool.options.max`, default half of it, at least 1; `cleanupIntervalSeconds` 1 to 3,600, default 60 |
| Connection | one `node:sqlite` connection, WAL, `synchronous=FULL`                                                                               | one checked-out client per operation, at most `maxClients`, at most 1,000 callers waiting                                                                           |
| A unit     | `BEGIN IMMEDIATE` to `COMMIT` in one synchronous turn; a busy database is retried 10 times, 1 ms doubling to 256 ms, at most 511 ms | READ COMMITTED, `lock_timeout` 3 s, `statement_timeout` 4 s, idle-in-transaction timeout 5 s; 5,000 ms in all, including the wait for a client                      |
| `install`  | creates the file at mode 0600; an existing file is used as it is                                                                    | creates the schema `skeld_auth`                                                                                                                                     |
| Clock      | the host clock, read by SQLite inside the unit                                                                                      | `clock_timestamp()`                                                                                                                                                 |

`install` answers `installed`, `current` or `mismatch` (with `found`); of concurrent installs one answers `installed`. `attach` is called once by the gate's boot. `close` refuses waiting units at once, lets running units finish, stops cleanup, never ends a Pool and never rejects; after it, every call rejects `unavailable`. Cleanup deletes at most 1,000 expired rows per pass, every `cleanupIntervalSeconds`, starting between half the interval and the whole interval after `attach`; a pass that removed 1,000 runs again after 1 s. Correctness never depends on cleanup.

`runStoreConformance(make)` runs the same cases against any `AuthStore`: each answer of the 18 operations, expiry while a lock is held, concurrent callers, install and attach, and close. A case that needs a hook the target lacks is reported skipped, never passed.

## Policies and grants

`definePolicy(name, options)` returns a frozen policy. Its options are `credentials` (at least one of `session`, `api_key`, `jwt`), `limit?`, `input?`, `load?`, `tenant?` (only with `load`; a tenant name is 1 to 128 characters), `actions` (at least one) and `denial?` (`'forbidden'`, the default, or `'not_found'`). Each `input` schema must be the same schema object under the same key in exactly one of the route's `params`, `query` or `body`. A policy limit counts per policy and per user id, key id or JWT subject.

A grant is frozen and carries `principal`, `policy`, `action`, `tenant`, `resource` (the object `load` returned, or `null` without `load`) and `requestId`. `policy.operation(action, body)` checks, in order, that the grant was issued (`GRANT_UNKNOWN`), by this policy (`GRANT_POLICY`), for this action (`GRANT_ACTION`) and that its request is still running (`GRANT_RELEASED`). It checks no other argument. `isPrincipal` and `isGrant` test membership in the registry, never shape; `isGrant` is `false` for a released grant. The built-in policy `auth.session`, action `use`, admits any live session; its resource is `null`.

## API keys

`apiKeys({ maxPerUser? })`: `maxPerUser` 1 to 1,000, default 100.

- A key is `skeld1.<id>.<secret>`: 16 base64url characters (12 random bytes), a dot, 43 (32 random bytes); 67 in all. Auth stores the SHA-256 of the 32 secret bytes and compares in constant time.
- `issue({ userId, name, scopes, expiresInSeconds? })`: `name` 1 to 64 characters of U+0020 to U+007E; `scopes` 1 to 32 texts `<policy>:<action>`, each once; `expiresInSeconds` 60 to 31,536,000, absent for no expiry. Answers `issued` with `key` (a `Secret`) and `info`; `refused` `limit` or `disabled`; `Unavailable`.
- `list({ userId })` answers `listed` with the unexpired keys' `ApiKeyInfo`; `revoke({ userId, keyId })` answers `revoked`, or `absent` for an unknown key or another user's key.
- A key is refused while its subject is disabled and accepted again after `enable`; neither `disable` nor `revokeSessions` revokes it.

## JWT verification

`jwt({ issuer, audience, algorithms, keys?, jwksUrl?, map })`: `issuer` and `audience` 1 to 255 characters, compared exactly; `algorithms` a non-empty list of `RS256` and `ES256`; exactly one of `keys` (each with a `kid`) and `jwksUrl` (`https`, fetched at first use). A key's type fixes its algorithm: RSA of at least 2,048 bits is RS256, P-256 is ES256; a JWK whose `alg` disagrees is a boot fault.

A token is refused (401 `CREDENTIAL_INVALID`) when it is not three segments; its header is not a JSON object; `alg` is not in `algorithms` or not the algorithm of the key its `kid` selects; the header names `jku`, `x5u`, `jwk`, `x5c` or `crit`; `kid` is missing or matches no key after one shared refresh of the key set; the signature is bad; `iss` is not `issuer`; `aud` is neither `audience` nor a list containing it; `exp` is absent, not a number or more than 60 s past; `nbf` is present and not a number or more than 60 s ahead; `sub` is absent or not 1 to 256 characters; or `map` answers `deny`. `map` runs only after every check passed, under 5,000 ms. While no key set can be had, the verifier answers `unavailable` (503). Auth signs no JWT and cannot revoke one.

## OpenID Connect

`oidc({ providers, failurePath, returnPath?, resolveUser })`: 1 to 16 providers, each named by 1 to 32 characters of `a-z` and `0-9`, a letter first. `failurePath` and `returnPath` (default `/`) are local paths that `checkRedirect` accepts, with no query or fragment. `resolveUser` has 5,000 ms per call.

### OIDC providers

| `OidcProvider` member | Bounds                                                                                                                    |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `issuer`              | an `https` URL of at most 255 characters, no query, fragment or userinfo; unique among providers                          |
| `clientId`            | 1 to 255 characters of U+0021 to U+007E                                                                                   |
| `clientSecret`        | a `Secret` of 1 to 512 characters, sent with `client_secret_basic`                                                        |
| `scopes`              | at most 16 RFC 6749 scope tokens of 1 to 64 characters, each once; `openid` is always sent and listing it is a boot fault |

The redirect URI is `<origin>/auth/oidc/<provider>/callback`. A provider's discovery document is refused, with one `auth.oidc.provider_refused` record, when its `issuer` is not the configured string exactly; `authorization_endpoint`, `token_endpoint` or `jwks_uri` is absent, longer than 2,048 characters, not `https`, or holds userinfo or a fragment; the authorization endpoint's query already names a parameter auth sends; `id_token_signing_alg_values_supported` lacks `RS256`; `code_challenge_methods_supported` is absent or lacks `S256`; or `token_endpoint_auth_methods_supported` is present and lacks `client_secret_basic`.

The callback, in order: the address limit; the attempt, matched to the browser's attempt cookie and spent once (a second browser with the same URL consumes nothing); `iss` equal to the issuer when present, and required when the provider advertises `authorization_response_iss_parameter_supported`; the provider's `error`; the code exchange; the ID Token (RS256 with a `kid`, `iss`, `aud` the client id or a list of only it, `azp` the client id when present, `exp` and `nbf` within 60 s, `iat` present and not more than 60 s ahead, `nonce` the attempt's, `sub` 1 to 255 characters); `resolveUser`; the session handoff, whose `verify` calls `resolveUser` again and accepts only the same user. The access token is dropped and the code and tokens are never stored.

### OIDC callback codes

A failed callback answers 303 to `failurePath?provider=<name>&error=<code>` and clears the attempt cookie.

| Code                   | When                                                                                                                                           |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `attempt_invalid`      | No attempt cookie, an attempt that is spent, expired or another browser's                                                                      |
| `provider_denied`      | The provider returned `error=access_denied`                                                                                                    |
| `provider_error`       | The provider returned any other `error`                                                                                                        |
| `provider_response`    | A refused `iss`; no `code`; a token response that is not 200, is a redirect, is too large, is not JSON or lacks `id_token`; any ID Token check |
| `provider_unavailable` | The configuration, key set or token request failed, or the outbound bound was reached                                                          |
| `mapping_denied`       | `resolveUser` answered `deny`                                                                                                                  |
| `mapping_failed`       | `resolveUser` threw, was late or malformed, or the second answer named another user                                                            |
| `subject_refused`      | The handoff answered `disabled` or `stale`                                                                                                     |

A store failure, or shutdown during the callback, answers 503 `AUTH_UNAVAILABLE` instead of a redirect.

### Outbound requests

Auth fetches discovery documents, key sets and token responses itself, shared by `jwt()` and `oidc()` in one process: `https` only, with the platform's certificate and host-name verification, which no option turns off; Node's default trust and no per-provider certificate option; no redirect followed; one 5,000 ms deadline over connect, head and body; status 200 with a JSON object only; a body of at most 262,144 bytes; at most 16 requests in flight and 64 waiting; no retry and no cookie. A document is fresh for its `max-age` less `age`, else until `expires`, else 300 s, never more than 86,400 s; `no-store`, `no-cache` and `max-age=0` serve only the callers of that fetch. A fetch that was sent and failed starts a 60 s cooldown for that URL. A key set of more than 32 keys, or with a repeated `kid`, is refused.

## Password helpers

| Call                                          | Answers                                                                                                                                                               |
| --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `hashPassword(password, { cost?, signal? })`  | `hashed` with `$argon2id$v=19$m=<m>,t=<t>,p=1$<salt>$<tag>`; `invalid_password` for a password outside 1 to 1,024 bytes of UTF-8; `busy`                              |
| `verifyPassword(password, hash, { signal? })` | `match`; `mismatch` (also for a password outside 1 to 1,024 bytes); `invalid_hash` for a hash outside the accepted bounds, never answered as a wrong password; `busy` |
| `needsRehash(hash, cost?)`                    | `true` when the hash does not parse, is below the cost, has a parallelism other than 1, a salt under 16 bytes or a tag under 32                                       |

The default cost is 19,456 KiB and 2 passes; a given cost may only raise either: `memoryKiB` 19,456 to 262,144, `passes` 2 to 16, and their product at most 1,048,576. Hashes use parallelism 1, a 16-byte salt and a 32-byte tag. `verifyPassword` accepts at most 256 characters, `argon2id` and `v=19` only, `memoryKiB` 8 to 262,144 (at least 8 per lane), `passes` 1 to 16, parallelism 1 to 4, a salt of 8 to 64 bytes and a tag of 16 to 64 bytes, and parses all of it before computing. Two computations run at a time per process and at most 64 callers wait; a caller answers `busy` when the queue is full, after 5,000 ms of waiting, or when its signal aborts. The helpers take part in no server's shutdown.

## Security events

Auth registers ten events at boot. Each writes a record in category `security` at its severity, through the server's logger and its suppression (20 records per event and route in 10 s). Fields are under the record's `fields` and hold ids and members of fixed sets; no address, token, claim, URL or callback text. At the default `security` threshold of `warn`, the three `info` events are not written.

| Event                        | Severity | Written by                                                                                                       | Fields                                                                                                                                                        |
| ---------------------------- | -------- | ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `auth.signin.succeeded`      | info     | `establish`                                                                                                      | `auth.user`; `auth.via`: `handoff` or `oidc`; `auth.provider` for `oidc`                                                                                      |
| `auth.signin.failed`         | warn     | `establish`, for every refusal and `Unavailable` it answers; the OIDC callback, for a failure before the handoff | `auth.user` when known; `auth.via`; `auth.provider`; `auth.reason`: `rejected`, `disabled`, `stale`, `callback`, `unavailable`, or an OIDC callback code      |
| `auth.limit.refused`         | warn     | auth's own limits: a policy `limit` or `addressLimit`; your `charge` writes none                                 | `auth.limit`: `auth.address.<route>` or `auth.policy.<policy>`                                                                                                |
| `auth.session.revoked`       | info     | sign-out, when a session was deleted; `disable` and `revokeSessions`; `enable`, when it ended a session          | `auth.user`; `auth.cause`: `sign_out`, `revoke_all`, `disable`, `enable`                                                                                      |
| `auth.credential.changed`    | info     | `apiKeys().issue` and `revoke`                                                                                   | `auth.user`; `auth.credential`: `api_key`; `auth.change`: `added` or `removed`; `auth.key`                                                                    |
| `auth.subject.changed`       | warn     | `disable` and a successful `enable`                                                                              | `auth.user`; `auth.change`: `disabled` or `enabled`                                                                                                           |
| `auth.callback.failed`       | error    | the code that called the failing callback                                                                        | `auth.callback`: `policy.load`, `policy.tenant`, `policy.action`, `jwt.map`, `oidc.resolve`, `handoff.verify`; `auth.cause`: `threw`, `deadline`, `malformed` |
| `auth.oidc.provider_refused` | error    | the discovery check                                                                                              | `auth.provider`; `auth.reason`: `issuer`, `endpoint`, `signing_alg`, `pkce`, `client_auth`                                                                    |
| `auth.keys.unavailable`      | error    | the JWT verifier and the OIDC flow, once per refused caller                                                      | `auth.source`: `jwt` or a provider's name; `auth.reason`: `fetch`, `document`, `stale`, `bound`                                                               |
| `auth.store.failed`          | error    | every store caller                                                                                               | `auth.operation`; `auth.cause`: `unavailable`, `unknown`, `fault`, `record`, `renew`; `auth.code` (an SQLSTATE or SQLite result code) when present            |

## Not included

Auth is building blocks around an application that owns its accounts. These are outside its scope by design, not missing parts of it; an application supplies them, or uses another library or identity service:

- Sign-up, email or phone verification, password reset and account recovery.
- Sending mail or messages of any kind.
- User provisioning, and any user table: auth keeps only a subject id, whether it is enabled and a generation.
- TOTP, recovery codes, passkeys and other second factors.
- Linking and unlinking external identities: `resolveUser` maps an identity to a user you already have.
- An identity-provider or authorization-server product.
- Refresh tokens, and storage for any provider token.
- JWT signing.
- Per-provider certificate trust: a private authority is trusted only process-wide through `NODE_EXTRA_CA_CERTS` (see [Trust a private certificate authority](../guides/auth-obligations.md#trust-a-private-certificate-authority)).
- Claims about response-time equality or account enumeration: the password helpers make none.

## Compatibility tested

What the repository's proofs and the example exercise, on Linux with Node 26.13.0:

- **Stores:** SQLite through `node:sqlite` (file and `':memory:'`), and PostgreSQL 19.0 through `pg` 8.23.1, each against the same conformance cases and behavior proofs.
- **OpenID Connect:** the generic profile on this page, against local providers over local HTTPS with certificates made for each run. No named provider (Google, Microsoft, Okta, Auth0 or any other) has been tested, and compatibility with one is not claimed.
- **Browser:** none. The sign-in flow and its cookies are exercised by a scripted HTTP client that keeps a cookie jar; no browser engine has been tested.
- **JWT:** RS256 and ES256 tokens from a local issuer.
