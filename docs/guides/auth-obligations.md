# Meet the application's obligations

Auth enforces what it can see from its boundary: credentials, policies, grants, sessions and its own store. Some guarantees depend on code only your application runs, such as reading a password hash, writing a new one or deciding which account an external identity belongs to. This page states each of those obligations and what happens when it is not met.

[`examples/auth`](../../examples/auth/README.md) meets every obligation here, and its walkthrough checks each one, including every interruption of a password change. Build [the service in the guide](auth.md) first if you have not.

## Sign people in

Your sign-in route does these things in this order. The `login` handler of [the complete service](auth.md#a-complete-service) is a working version.

**Charge a limit before any password hashing.** Call `auth.limits.charge` first and stop on `limited` or `Unavailable`, so a limited attempt computes nothing. If you hash first, every request costs an Argon2id computation whether it is limited or not. The process runs two computations at a time with at most 64 callers waiting, so a flood of guesses makes real sign-ins answer `busy`.

**Read the credential inside `verify`.** `establish` takes a snapshot of the user's fence before it calls `verify`. A hash read inside `verify` is judged against that snapshot: if a password change finished first, `verify` reads the new hash. A hash read before `establish` is outside that fence, and a change that completed in between is judged on the old value.

**Answer `'unavailable'` when you cannot judge.** When `verifyPassword` answers `busy` or your own store is down, return `'unavailable'` from `verify`. `establish` then answers `Unavailable` and your route answers 503. Returning `false` would report a loaded service as a wrong password; throwing is answered as `refused` `callback` with an `auth.callback.failed` record.

**Answer every sign-in failure identically.** An unknown user, a wrong password and a user auth refused (`disabled` or `stale`) get one response. For an unknown user, verify the password against a dummy hash made at start. When `establish` refuses without calling `verify` (the user is disabled), run the dummy verification anyway, so that failure also costs one hash. If the responses differ, a caller can learn which users exist or which are in the middle of a password change. These steps remove the cheapest difference; they make no claim about equal response times or about account enumeration, and the helpers make none either.

**Take the user id from your own lookup.** The `userId` you give `establish` comes from your user table, never from a request body.

## Change a credential

A password lives in your database and sessions live in auth's store, and no transaction spans both. A change uses an order in which every interruption leaves the user signed out rather than signed in on the wrong password:

1. `auth.subjects.disable(userId)`. Continue only on `done`, and keep the `generation` it answered: every session has ended and no sign-in can get a session while the user is disabled. On `Unavailable` `not_applied`, stop: nothing changed. On `Unavailable` `unknown`, stop and reconcile.
2. Write the new hash, conditionally on the hash you verified, so a write that landed meanwhile is never overwritten.
3. Only after that write is confirmed, `auth.subjects.enable(userId, generation)` with the generation your own `disable` answered. `enable` succeeds only for a user still disabled at exactly that generation, and in the same step raises the generation and ends every session. A `refused` answer (`absent`, `enabled` or `stale`) changed nothing and stops the attempt: never repeat `disable` and `enable` without reconciling.

Run every change and every reconciliation of one user under one serialization your application owns, held from before step 1 until the attempt ends. Auth supplies none. An in-process lock covers one process only; several processes need a serialization they share, such as a row lock on the user held for the whole attempt, or a single writer.

```ts
import { hashPassword, verifyPassword } from '@skeld/auth/password';
import type { Subjects } from '@skeld/auth/server';
import type { Secret } from '@skeld/core/secret';

export interface PasswordStore {
  read(userId: string): Promise<string | undefined>;
  // Replaces the hash only if it still equals `expected`; answers whether it did.
  replace(userId: string, expected: string, next: string): Promise<boolean>;
}

export interface UserLock {
  run<T>(userId: string, work: () => Promise<T>): Promise<T>;
}

export type ChangeOutcome = 'changed' | 'conflict' | 'refused' | 'busy' | 'not_started' | 'pending' | 'stopped';

export function changePassword(
  subjects: Subjects,
  passwords: PasswordStore,
  lock: UserLock,
  userId: string,
  current: Secret<string>,
  next: Secret<string>,
): Promise<ChangeOutcome> {
  return lock.run(userId, async (): Promise<ChangeOutcome> => {
    const stored = await passwords.read(userId);
    if (stored === undefined) {
      return 'refused';
    }
    const checked = await verifyPassword(current, stored);
    if (checked.kind !== 'match') {
      return checked.kind === 'busy' ? 'busy' : 'refused';
    }
    const hashed = await hashPassword(next);
    if (hashed.kind !== 'hashed') {
      return hashed.kind === 'busy' ? 'busy' : 'refused';
    }
    const disabled = await subjects.disable(userId);
    if (disabled.kind === 'unavailable') {
      return disabled.outcome === 'not_applied' ? 'not_started' : 'pending';
    }
    let written: boolean;
    try {
      written = await passwords.replace(userId, stored, hashed.hash);
    } catch {
      return 'pending';
    }
    const enabled = await subjects.enable(userId, disabled.generation);
    if (enabled.kind === 'refused') {
      return 'stopped';
    }
    if (enabled.kind === 'unavailable') {
      return 'pending';
    }
    return written ? 'changed' : 'conflict';
  });
}

export function reconcile(subjects: Subjects, lock: UserLock, userId: string): Promise<string> {
  return lock.run(userId, async () => {
    const subject = await subjects.read(userId);
    if (subject.kind !== 'subject') {
      return subject.kind;
    }
    const done = subject.enabled
      ? await subjects.revokeSessions(userId)
      : await subjects.enable(userId, subject.generation);
    return done.kind === 'done' ? 'reconciled' : 'unavailable';
  });
}
```

**Reconcile after any interruption.** A `pending` or `stopped` attempt leaves the user disabled, or enabled by someone else, until you reconcile. Auth never re-enables a user by itself. Under the same serialization, and after any write whose outcome you do not know is settled in your own store, read the subject: disabled at generation `r`, call `enable(userId, r)`; enabled, call `revokeSessions(userId)`, because a sign-in may have been admitted on a password that is no longer stored.

**What each interruption leaves.**

| Interrupted at                                   | State                                                    | Your next step                                                              |
| ------------------------------------------------ | -------------------------------------------------------- | --------------------------------------------------------------------------- |
| `disable` answers `not_applied`                  | enabled, old password                                    | report the failure                                                          |
| `disable` answers `unknown`, or a crash after it | perhaps disabled, old password                           | reconcile                                                                   |
| The write's outcome is unknown                   | disabled, password uncertain                             | settle the write in your store, then reconcile                              |
| A crash after the write                          | disabled, new password                                   | reconcile                                                                   |
| `enable` answers `not_applied`                   | disabled at `generation`, new password                   | call the same `enable` again                                                |
| `enable` answers `unknown`                       | disabled at `generation`, or enabled at `generation + 1` | read: enabled at `generation + 1` is your own `enable`; otherwise reconcile |
| `enable` answers `refused` `stale` or `enabled`  | another actor wrote the fence since `disable`            | stop, reconcile, and end old sessions with `revokeSessions`                 |

**Without the serialization.** A generation names a version of the fence, not who holds it. A reconciliation that reads the generation and calls `enable` while a change sits between its `disable` and its write enables the user early, and a sign-in on the old password is admitted. The change's own `enable` is then refused as `enabled`. A session issued on the old password in that window lasts until a reconciliation revokes it.

**A rehash is not a credential change.** When `needsRehash` says a stored hash is below your cost, replace it after a successful sign-in, conditionally on the hash you just verified, with no `disable`. The password stays the same, and the condition keeps a rehash from undoing a change that landed first.

An OpenID Connect mapping change, such as attaching or removing an external identity, follows the same `disable`, write, `enable` order.

## Keep a grant inside its request

A live grant carries the authority of the principal it was issued to, for its policy, action and resource, until the request that received it ends.

- Keep it inside that request. Never put it in a module variable, a cache or a queue that another request can reach. Whoever holds a live grant holds its authority: sharing it with another request shares that authority until the original request ends.
- An operation acts on `grant.resource`, or checks the target it was asked for against `grant.resource` before using it. The operation wrapper checks the grant's origin, policy, action and liveness; it does not check an id passed beside the grant. An operation that takes an id argument and uses it unchecked acts on whatever the caller names.
- Work that outlives the request cannot use the grant: once the request has ended, every operation given it throws before its body runs, `GRANT_RELEASED` when the policy and action match.

Revocation is enforced at the next admission. A request already admitted completes after its session is revoked, and a handler that is still running after its deadline holds a released grant. Code that writes to your database without going through an operation is outside every check auth makes.

## Map identities to existing users

`resolveUser` (OpenID Connect) and the JWT `map` callback accept only users that already exist. Look the identity up by the pair of issuer and subject. Never use an email address to find or attach an account; auth passes the email claim to you and compares it with nothing. Creating users, linking identities and recovering accounts are your application's.

`resolveUser` is called twice, the second time inside the session handoff, and both answers must name the same user. A different answer refuses the sign-in.

## Issue and revoke API keys

Issuing, listing and revoking keys are trusted server-side calls: your application decides who may call them. Two behaviors catch people out:

- Disabling a subject refuses its API keys while it is disabled, and `enable` restores them. It does not revoke them. When a change should end a user's keys, revoke them with `apiKeys().revoke`.
- A scope is checked only for its grammar, `<policy>:<action>`. A misspelt scope issues a key that matches no route.

## Fix the origin before listen

Auth binds the session cookie and every provider's redirect URI to `origin`, which it needs before the server listens. A service with auth listens on a fixed port, never on port 0, and its `origin` is one of the server's `publicOrigin`.

## Operate the store

- **PostgreSQL.** Run one primary with durable commits. Without them, a revocation that auth saw committed can be lost, or a lifetime lengthened.
- **The Pool.** Set `connectionTimeoutMillis` on your `pg` Pool to 5,000 ms or less. pg waits for a connection without limit by default, and auth keeps a store slot for every connect that has not settled: once `maxClients` connects hang, every operation answers `Unavailable` until the driver settles them.
- **The clock.** The store's clock is the one source of time for every expiry: `clock_timestamp()` on PostgreSQL, the host clock on SQLite. A database clock stepped backwards lengthens lifetimes.
- **SQLite files.** `install` creates a new file at mode 0600. The permissions of a file that already exists are yours to set.
- **Choosing a store.** SQLite runs its writes on the event loop and suits a single instance. Use PostgreSQL for several instances or heavier load.
- **Unknown outcomes.** When a commit was sent and its answer never arrived, auth reports `Unavailable` `unknown`: the change may have applied. A client can see 503 for a change that took effect. Auth never repeats it; your code reads the state before acting again.

## Trust a private certificate authority

Auth has no per-provider certificate option. A provider or key-set URL behind a private certificate authority is reached only by setting [`NODE_EXTRA_CA_CERTS`](https://nodejs.org/api/cli.html#node_extra_ca_certsfile) before Node starts. It extends the default trust of the whole process, not one provider's: every outbound HTTPS request of that process then trusts the added authority. Certificate and host-name verification cannot be turned off. `examples/auth` uses this for its local provider: it starts the service as a child process with `NODE_EXTRA_CA_CERTS` naming that run's certificate.

A provider's configured endpoints are trusted configuration: they receive the client secret and the authorization code. Configure only issuers you choose.

**Next:** look up exact behavior in the [auth reference](../reference/auth.md), including [what auth does not include](../reference/auth.md#not-included).
