# @skeld/auth/server

## LimitKey

A text key of 1 to 256 characters, or a client address, counted per IPv4 address or per IPv6 /64.

```ts
export type LimitKey =
  | string
  | {
      readonly clientAddress: string;
    };
```

| Field           | Summary                                                    |
| --------------- | ---------------------------------------------------------- |
| `clientAddress` | The client's address, as `request.clientAddress` gives it. |

Source: `packages/auth/src/limit/types.ts:28`

## LimitRule

A fixed window: at most `max` charges per `windowSeconds`, both integers.

```ts
export interface LimitRule {
  readonly max: number;
  readonly windowSeconds: number;
}
```

| Field           | Summary                                           |
| --------------- | ------------------------------------------------- |
| `max`           | Most charges per window, from 1 to 1,000,000.     |
| `windowSeconds` | The window's length in seconds, from 1 to 86,400. |

Source: `packages/auth/src/limit/types.ts:11`

## Limits

The application's declared limit scopes, charged before its own expensive work; there is no refund.

`charge` rejects AuthError `INVALID_INPUT` for an undeclared scope or a key out of bounds.

```ts
export interface Limits<L> {
  charge(scope: L, key: LimitKey, signal?: AbortSignal): Promise<LimitVerdict>;
}
```

| Field    | Summary                                    |
| -------- | ------------------------------------------ |
| `charge` | Counts one charge of the key in the scope. |

Source: `packages/auth/src/limit/types.ts:22`

## LimitVerdict

The outcome of a charge: a pass, a refusal with the whole seconds to wait (at least 1), or Unavailable.

```ts
export type LimitVerdict =
  | {
      readonly kind: 'pass';
      readonly remaining: number;
      readonly resetAt: number;
    }
  | {
      readonly kind: 'limited';
      readonly retryAfterSeconds: number;
    }
  | Unavailable;
```

| Field               | Summary                                                          |
| ------------------- | ---------------------------------------------------------------- |
| `kind`              | Marks the outcome.                                               |
| `remaining`         | Charges left in the window.                                      |
| `resetAt`           | When the window restarts, in epoch milliseconds.                 |
| `retryAfterSeconds` | Whole seconds until the window restarts, rounded up, at least 1. |

Source: `packages/auth/src/limit/types.ts:36`

## Grant

The authority a policy action granted one request; frozen, and valid only while registered and unreleased.

```ts
export interface Grant<N, K, R> {
  readonly principal: Principal;
  readonly policy: N;
  readonly action: K;
  readonly tenant: string | null;
  readonly resource: R;
  readonly requestId: string;
}
```

| Field       | Summary                                                                                       |
| ----------- | --------------------------------------------------------------------------------------------- |
| `principal` | The principal the grant was issued to.                                                        |
| `policy`    | The policy that issued it.                                                                    |
| `action`    | The action it admits.                                                                         |
| `tenant`    | The resource's tenant, or `null` without a tenant rule.                                       |
| `resource`  | The resource the policy loaded; without `load` its value is `null` and its type is `unknown`. |
| `requestId` | The id of the request it was issued in.                                                       |

Source: `packages/auth/src/policy/types.ts:53`

## EnableRefused

Why `enable` changed nothing: no such subject, already enabled, or disabled at another generation.

```ts
export interface EnableRefused {
  readonly kind: 'refused';
  readonly reason: 'absent' | 'enabled' | 'stale';
}
```

| Field    | Summary                   |
| -------- | ------------------------- |
| `kind`   | Marks the outcome.        |
| `reason` | The state `enable` found. |

Source: `packages/auth/src/session/types.ts:106`

## EstablishInput

What `establish` receives; `verify` must read the credential it judges inside the call.

```ts
export interface EstablishInput {
  readonly rawCookies: RawCookies;
  readonly userId: string;
  readonly verify: (signal: AbortSignal) => boolean | 'unavailable' | Promise<boolean | 'unavailable'>;
  readonly signal?: AbortSignal;
}
```

| Field        | Summary                                                                                                           |
| ------------ | ----------------------------------------------------------------------------------------------------------------- |
| `rawCookies` | The request's cookies; a well-formed session cookie among them is replaced.                                       |
| `userId`     | The user, from trusted server code and never from a request body: 1 to 128 of `A-Z a-z 0-9 - _ . :`.              |
| `verify`     | Judges the credential, once, under 10,000 ms; only `true` establishes, and `'unavailable'` answers `Unavailable`. |
| `signal`     | Aborts the call.                                                                                                  |

Source: `packages/auth/src/session/types.ts:19`

## Established

The outcome of `establish`; `callback` means `verify` threw, answered a non-boolean or passed its deadline.

```ts
export type Established =
  | {
      readonly kind: 'established';
      readonly session: LiveSession;
      readonly cookies: readonly OutgoingCookie[];
    }
  | {
      readonly kind: 'refused';
      readonly reason: 'rejected' | 'disabled' | 'stale' | 'callback';
    }
  | Unavailable;
```

| Field     | Summary                      |
| --------- | ---------------------------- |
| `kind`    | Marks the outcome.           |
| `session` | The new session.             |
| `cookies` | The session cookie to set.   |
| `reason`  | Why the session was refused. |

Source: `packages/auth/src/session/types.ts:31`

## LiveSession

A live session as its holder sees it.

```ts
export interface LiveSession {
  readonly status: 'session';
  readonly userId: string;
  readonly csrfToken: string;
  readonly expiresAt: number;
}
```

| Field       | Summary                                                       |
| ----------- | ------------------------------------------------------------- |
| `status`    | Whether the holder has a live session.                        |
| `userId`    | The subject.                                                  |
| `csrfToken` | The token unsafe requests send as `x-csrf-token`.             |
| `expiresAt` | When the session ends without renewal, in epoch milliseconds. |

Source: `packages/auth/src/session/types.ts:73`

## Rotated

The outcome of `rotate`; the replacement keeps the old session's creation and absolute expiry.

```ts
export type Rotated =
  | {
      readonly kind: 'rotated';
      readonly session: LiveSession;
      readonly cookies: readonly OutgoingCookie[];
    }
  | {
      readonly kind: 'refused';
      readonly reason: 'no_session';
    }
  | Unavailable;
```

| Field     | Summary                                                            |
| --------- | ------------------------------------------------------------------ |
| `kind`    | Marks the outcome.                                                 |
| `session` | The replacement session.                                           |
| `cookies` | The replacement cookie to set.                                     |
| `reason`  | Why the rotation was refused: the request carries no live session. |

Source: `packages/auth/src/session/types.ts:48`

## Sessions

The only writer of session authority: the application's trusted handoff, and rotation of a live session.

Each call rejects AuthError `INVALID_INPUT` for a user id outside its grammar, `NOT_READY` before `listen`, `CLOSED` after.

```ts
export interface Sessions {
  establish(input: EstablishInput): Promise<Established>;
  rotate(input: { readonly rawCookies: RawCookies; readonly signal?: AbortSignal }): Promise<Rotated>;
}
```

| Field       | Summary                                                                                           |
| ----------- | ------------------------------------------------------------------------------------------------- |
| `establish` | Establishes a session after the application's `verify` answers `true` inside the subject's fence. |
| `rotate`    | Spends the request's one well-formed session cookie and issues its replacement in one unit.       |

Source: `packages/auth/src/session/types.ts:11`

## SessionState

The body of `authSession` and of an application's own sign-in reply.

```ts
export type SessionState =
  | {
      readonly status: 'none';
    }
  | LiveSession;
```

| Field    | Summary                                |
| -------- | -------------------------------------- |
| `status` | Whether the holder has a live session. |

Source: `packages/auth/src/session/types.ts:65`

## SubjectChanged

A confirmed change of a subject's fence.

```ts
export interface SubjectChanged {
  readonly kind: 'done';
  readonly enabled: boolean;
  readonly generation: number;
}
```

| Field        | Summary                                          |
| ------------ | ------------------------------------------------ |
| `kind`       | Marks the outcome.                               |
| `enabled`    | Whether the subject is enabled after the change. |
| `generation` | The subject's generation after the change.       |

Source: `packages/auth/src/session/types.ts:114`

## Subjects

The trusted server-side calls on subjects; each writes its record after a confirmed commit.

Each rejects AuthError `INVALID_INPUT`, `NOT_READY` or `CLOSED`; `disable`, `enable` and `revokeSessions` end every session.

```ts
export interface Subjects {
  read(
    userId: string,
  ): Promise<
    | { readonly kind: 'subject'; readonly enabled: boolean; readonly generation: number }
    | { readonly kind: 'absent' }
    | Unavailable
  >;
  disable(userId: string): Promise<SubjectChanged | Unavailable>;
  enable(userId: string, expectedGeneration: number): Promise<SubjectChanged | EnableRefused | Unavailable>;
  revokeSessions(userId: string): Promise<SubjectChanged | Unavailable>;
}
```

| Field            | Summary                                                                                                      |
| ---------------- | ------------------------------------------------------------------------------------------------------------ |
| `read`           | Reads a subject's fence.                                                                                     |
| `disable`        | Disables a subject, raising its generation and ending its sessions; its API keys are refused while disabled. |
| `enable`         | Enables a subject disabled at exactly `expectedGeneration`, raising its generation and ending its sessions.  |
| `revokeSessions` | Raises a subject's generation and ends its sessions; API keys are not revoked.                               |

Source: `packages/auth/src/session/types.ts:88`

## Unavailable

A store or limiter that could not answer; `unknown` means the change may have been applied.

```ts
export interface Unavailable {
  readonly kind: 'unavailable';
  readonly outcome: 'not_applied' | 'unknown';
}
```

| Field     | Summary                                                                                    |
| --------- | ------------------------------------------------------------------------------------------ |
| `kind`    | Marks the outcome.                                                                         |
| `outcome` | Whether nothing changed or the outcome is unknown; `unknown` is never reported as success. |

Source: `packages/auth/src/store/types.ts:10`

## Auth

One server's auth: its gate, its session handlers and its trusted server-side calls.

Every call rejects AuthError `NOT_READY` before the server listens and `CLOSED` after it closes.

```ts
export interface Auth<P extends readonly AnyPolicy[], L extends string> {
  readonly gate: Gate<AuthAccessOf<PolicyEntries<P[number]> | Grant<'auth.session', 'use', null>>>;
  readonly handlers: {
    /** The handlers of `sessionRoutes`. */
    readonly session: GatedHandlers<
      SessionRoutes,
      AuthAccessOf<PolicyEntries<P[number]> | Grant<'auth.session', 'use', null>>
    >;
  };
  readonly sessions: Sessions;
  readonly subjects: Subjects;
  readonly limits: Limits<L>;
}
```

| Field      | Summary                          |
| ---------- | -------------------------------- |
| `gate`     | The gate to give `createServer`. |
| `handlers` | The handlers of auth's routes.   |
| `sessions` | The session handoff.             |
| `subjects` | The subject fence.               |
| `limits`   | The application's limit scopes.  |

Source: `packages/auth/src/server/types.ts:89`

## AuthAccess

The access types an auth gate gives a server: its principal, and a grant per policy action plus `auth.session.use`.

```ts
export type AuthAccess<P extends readonly AnyPolicy[]> = AuthAccessOf<
  PolicyEntries<P[number]> | Grant<'auth.session', 'use', null>
>;
```

Source: `packages/auth/src/server/types.ts:36`

## AuthAccessOf

The access types of an auth gate, by the union of the grants its policies issue.

```ts
export interface AuthAccessOf<G extends Grant<string, string, unknown>> {
  readonly principal: Principal;
  readonly grants: {
    readonly [E in G as E['policy']]: {
      readonly [F in Extract<G, { readonly policy: E['policy'] }> as F['action']]: F;
    };
  };
}
```

| Field       | Summary                                    |
| ----------- | ------------------------------------------ |
| `principal` | The admitted principal.                    |
| `grants`    | The grants by policy name and action name. |

Source: `packages/auth/src/server/types.ts:24`

## AuthOptions

The options of `createAuth`; nothing is checked until the gate's boot, which refuses a bad option with `GATE_FAILED`.

`origin` must be one of the server's `publicOrigin`; policy names are unique and never start `auth.`.

```ts
export interface AuthOptions<P extends readonly AnyPolicy[], L extends string> {
  readonly store: AuthStore;
  readonly origin: string;
  readonly policies?: P;
  readonly session?: SessionOptions;
  readonly limits?: { readonly [S in L]: LimitRule };
  readonly addressLimit?: LimitRule;
  readonly apiKeys?: ApiKeyPart;
  readonly jwt?: JwtPart;
  readonly oidc?: OidcPart;
}
```

| Field          | Summary                                                                                        |
| -------------- | ---------------------------------------------------------------------------------------------- |
| `store`        | Where auth keeps its state.                                                                    |
| `origin`       | The service's origin, as `new URL(x).origin` writes it: `https`, or `http` on a loopback host. |
| `policies`     | The policies routes may name.                                                                  |
| `session`      | The session cookie and its lifetimes.                                                          |
| `limits`       | The application's limit scopes, at most 32, none starting `auth.`.                             |
| `addressLimit` | The limit on auth's public routes per route and client address (default 10 per 60 seconds).    |
| `apiKeys`      | The API-key part, from `apiKeys()`.                                                            |
| `jwt`          | The JWT part, from `jwt()`.                                                                    |
| `oidc`         | The OIDC part, from `oidc()`.                                                                  |

Source: `packages/auth/src/server/types.ts:44`

## CreateAuth

The type of `createAuth`: infers the policy tuple and the limit scope names; it reads and checks nothing.

```ts
export type CreateAuth = <const P extends readonly AnyPolicy[] = readonly [], const L extends string = never>(
  options: AuthOptions<P, L>,
) => Auth<P, L>;
```

See `examples/auth/app.ts`.

Source: `packages/auth/src/server/types.ts:81`

## SessionOptions

The session cookie and its lifetimes; `2 ≤ idleSeconds ≤ absoluteSeconds ≤ 2,592,000`, in whole seconds.

```ts
export interface SessionOptions {
  readonly cookieName?: string;
  readonly idleSeconds?: number;
  readonly absoluteSeconds?: number;
  readonly renewSeconds?: number;
}
```

| Field             | Summary                                                                                                                    |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `cookieName`      | The cookie's name: `__Host-` and an HTTP token, at most 64 characters (default `__Host-skeld`).                            |
| `idleSeconds`     | Seconds a session lives without use (default 3,600).                                                                       |
| `absoluteSeconds` | Seconds a session lives whatever its use (default 86,400).                                                                 |
| `renewSeconds`    | Seconds of use after which a session is renewed, at most half of `idleSeconds` (default the smaller of 300 and that half). |

Source: `packages/auth/src/server/types.ts:66`

## createAuth

Creates one server's auth: its gate, session handlers and trusted calls; it reads and checks nothing until `listen`.

The server's `listen` rejects BootError `GATE_FAILED` for a bad option; one handle serves one server.

```ts
export const createAuth: CreateAuth
```

```ts
const auth = createAuth({ store: createSqliteStore({ path: '/var/lib/app/auth.db' }), origin: 'https://app.example' });
```

Source: `packages/auth/src/server/auth.ts:34`
