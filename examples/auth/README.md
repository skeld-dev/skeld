# Authentication in an application

This example is a small service that signs people in with its own user table and uses `@skeld/auth` for everything around that: sessions and CSRF, route policies with tenant checks, API keys, JWT verification, OpenID Connect sign-in and rate limits. It shows where auth stops and the application starts, and runs each obligation auth leaves to the application.

It runs on one machine with no account, provider or certificate to set up. It needs Node 26 and `openssl` on the `PATH` (for the local provider's throwaway certificate).

## Run the walkthrough

From the repository root, after `pnpm install`:

```sh
pnpm --filter @skeld/example-auth run walkthrough
```

The walkthrough runs through `with-local-provider.ts` (see [Trusting the local provider](#trusting-the-local-provider)). It starts the example on a free local port, drives it over HTTP the way a browser and an API client would, checks each answer and exits with status 0 only if every check passes. It prints one line per check, grouped like this:

```text
Login failures: limit first, then one verification, one answer
  ok  wrong password for a known user is 401
  ok  unknown user is 401
  ok  both bodies are byte-identical
...
Password change, interrupted at each point
  - step 1 (disable) not applied
  ok  the change answers not_started
...
walkthrough passed
```

## Run the server

```sh
pnpm --filter @skeld/example-auth run start
```

It runs `server.ts` through `with-local-provider.ts` and listens on a free local port (set `PORT` to choose one; the address is the first line on stderr). It writes its JSON log to stdout. On stderr it prints this run's generated passwords for the fake users `alice` (tenant `acme`) and `bob` (tenant `globex`), a JWT for `alice` and the local provider's accounts. Every value is new on each start and stops working when the process ends. Stop it with Ctrl-C; both databases and the certificate file are deleted.

Every route sits under the strict cross-site check, so an unsafe request needs an `Origin` header naming the service:

```sh
PORT=3003 pnpm --filter @skeld/example-auth run start
# in a second terminal:
curl -i http://127.0.0.1:3003/login \
  -H 'origin: http://127.0.0.1:3003' -H 'content-type: application/json' \
  --data '{"username":"alice","password":"<printed password>"}'
```

The answer carries the `__Host-skeld` cookie and, in its body, the CSRF token to send as `x-csrf-token` on every later unsafe request.

## What each file does

| File                                             | What it shows                                                                                        |
| ------------------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| [app.ts](app.ts)                                 | Wiring: the two stores, `createAuth` with its policies, limits and parts, the server and every route |
| [contract.ts](contract.ts)                       | The application's routes and the access each declares                                                |
| [users.ts](users.ts)                             | The application's user table in its own SQLite file, with a conditional hash replacement             |
| [login.ts](login.ts)                             | Sign-in: the limit before any hashing, the dummy verification, the session handoff, the rehash       |
| [documents.ts](documents.ts)                     | A tenant-scoped resource: its policy, and the operations that act on `grant.resource`                |
| [credential-change.ts](credential-change.ts)     | The password change in the order that fails closed, and reconciliation                               |
| [user-locks.ts](user-locks.ts)                   | The application's per-user lock that changes and reconciliation share (one process only)             |
| [local-issuer.ts](local-issuer.ts)               | A stand-in for an external JWT issuer: a key pair made at start                                      |
| [local-oidc-provider.ts](local-oidc-provider.ts) | A minimal OpenID Connect provider for local use; **not a real provider**                             |
| [with-local-provider.ts](with-local-provider.ts) | Starts the local provider and runs the service in a child process that trusts its certificate        |
| [launch.ts](launch.ts)                           | The child's side: receives its port and the provider's configuration over IPC                        |
| [server.ts](server.ts)                           | Starts the example and prints the one-time values                                                    |
| [walkthrough.ts](walkthrough.ts)                 | The scripted run of everything above                                                                 |
| [postgres-store.ts](postgres-store.ts)           | The PostgreSQL store over your own `pg` Pool, and what you own; the example itself runs on SQLite    |

## What the application is responsible for

Auth keeps a subject fence (a user id, whether it is enabled, and a generation) and the sessions, keys, limit windows and sign-in attempts. It keeps no user, address, password or identity link. Everything below is the application's job, and this example does each one.

**Users and credentials.** The application stores users and password hashes in its own database. `hashPassword` and `verifyPassword` compute; they never look anything up or store anything.

**Sign-in.** `login.ts` does these steps in this order:

1. Charge a limit (`auth.limits.charge`) before any hashing. A limited attempt never computes a hash.
2. For an unknown user, verify the password against a dummy hash made at start, and give the same answer as for a wrong password.
3. For a known user, call `auth.sessions.establish` with a `verify` that reads the stored hash **inside** the call. Auth takes a snapshot of the subject first; a credential change that finished before the read is then judged on the new hash. A hash read before `establish` would be outside that fence.
4. Answer every failure identically: no user, wrong password, or a subject auth refused. When auth refused without calling `verify`, the handler still verifies the dummy hash, so every failure costs one hash computation.
5. When the hash helper is saturated, `verify` answers `'unavailable'` and the client gets 503 `UNAVAILABLE`, not 401. A busy helper says the service is loaded, not whether the user exists: the unknown-user path answers 503 the same way.
6. After a successful sign-in, `needsRehash` decides whether to replace the hash. The replacement is conditional on the hash just verified, so it can never undo a password change that landed first. A rehash keeps the same password, so it is not a credential change.

The `userId` given to `establish` comes from the application's own lookup, never from a request body.

**Credential changes.** A password lives in the application's database and sessions in auth's; nothing makes a change to both atomic. `credential-change.ts` uses the order that fails closed:

1. `auth.subjects.disable(userId)`. Continue only on `done`: every session has ended and no sign-in that verified the old password can still get a session. On `not_applied`, stop; nothing changed. Keep the generation `disable` answered.
2. Write the new hash, conditionally on the hash that was verified.
3. Only after that write is confirmed, `auth.subjects.enable(userId, generation)`. Auth enables only a subject still disabled at exactly that generation, and in the same step raises the generation and ends every session. Any other state is a refusal that changes nothing, and the attempt stops there: the example never repeats `disable` and `enable` blindly.

Interrupted at any point after step 1, the subject stays disabled, every old session stays ended and no one signs in with either password until the application reconciles. Reconciliation (`reconcile` in `credential-change.ts`) reads the subject: disabled at generation `r`, it calls `enable(userId, r)`; enabled, it ends every session with `revokeSessions`, since a sign-in may have been admitted on a password that is no longer stored. Auth never re-enables a subject by itself. The walkthrough runs each interruption, a stale `enable`, and an `enable` from outside the lock, with their reconciliation. An OIDC mapping change follows the same order.

**One user, one change at a time.** A generation names a version of the fence, not who holds it: a reconciliation that reads the generation and enables while a change is between its disable and its write would let a sign-in on the old password through. So every change and every reconciliation of a user runs under one lock the application owns (`user-locks.ts`), held for the whole attempt; a reconciliation that arrives during a change waits for it, so the change's write is settled before reconciliation enables. That lock is in one process's memory. A deployment with several processes needs a serialization they share, such as a row lock on the user held for the whole attempt, or a single writer.

**Grants.** A grant is authority for one request. Keep it inside the request that received it: never in a module variable, a cache or a queue another request can reach. An operation acts on `grant.resource`, or checks the target it was asked for against `grant.resource`; the wrapper does not check an id passed beside the grant. Work that outlives the request cannot use the grant: every use fails once the request ends.

**Identity mapping.** `resolveUser` receives a verified issuer and subject and answers an existing user or `deny`. It is called twice, the second time inside the session handoff, and must name the same user. Email is never used to find or attach an account. The JWT `map` callback likewise accepts only subjects that are existing users.

**API keys.** Issuing, listing and revoking are trusted server-side calls; the application decides who may call them. Here a signed-in user issues a key scoped to `documents:read` from a route that requires a session and the CSRF token. A scope is plain text `<policy>:<action>`, checked for its grammar only: a misspelt scope issues a key that matches no route.

**A fixed origin.** auth binds the session cookie and each provider's redirect URI to `origin`, which it needs before the server listens. A service with auth therefore listens on a port chosen before start, never on port 0.

### Trusting the local provider

auth has no per-provider certificate option. The local provider serves `https` with a certificate made for each run, and the service process trusts it because `with-local-provider.ts` starts the service as a child process with `NODE_EXTRA_CA_CERTS` naming that certificate. `NODE_EXTRA_CA_CERTS` must be set before Node starts, and it extends the default trust of the whole process, not one provider's ([Node documentation](https://nodejs.org/api/cli.html#node_extra_ca_certsfile)). Per-provider trust is not supported. Certificate and hostname verification stay on: nothing sets `NODE_TLS_REJECT_UNAUTHORIZED` or `rejectUnauthorized: false`.

## What this example does not show or claim

- **No timing claim.** The dummy verification removes the cheapest way to tell a known user from an unknown one. Response times still differ: the user lookup, the session write on success, a rehash, and the case where auth refuses a disabled subject all take different paths. Nothing here is evidence of equal response-time distributions.
- **The local OIDC provider is not a real provider.** It signs in whichever account `login_hint` names without asking for any credential. It exists so the sign-in flow runs on one machine. Compatibility with any named provider is not established by it.
- **The local JWT issuer is not an issuer service.** Auth verifies JWTs and never signs them. A JWT stays valid until it expires; signing out or disabling a subject does not revoke it.
- **No sign-up, reset, recovery, email or second factor.** Those are the application's, and this example has none.
- **No production storage.** Both databases are in a temporary folder deleted at exit. For several processes or heavier load, use the PostgreSQL store with your own `pg` pool.
- **Local HTTP only.** The service runs on loopback `http`, which auth accepts as an origin. The session cookie is still `Secure` and `__Host-`; whether a browser stores a `Secure` cookie from plain loopback `http` is the browser's decision, so the walkthrough uses a scripted client and this example has no browser page. A deployed service runs behind HTTPS with an `https` origin.

## Copy into your project

Copy the files you need and install `@skeld/core` and `@skeld/auth`. The `skeld-source` condition and the relative `tsconfig.json` are repository wiring. Keep `local-issuer.ts`, `local-oidc-provider.ts` and `with-local-provider.ts` out of a deployed service, and give `startExample` your provider's configuration directly: configure your real issuer's keys or key-set URL and your real provider's issuer instead.
