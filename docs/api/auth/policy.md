# @skeld/auth/policy

## AnyPolicy

Any policy: the constraint of a policy tuple; it reads only the name and the action rules.

```ts
export interface AnyPolicy {
  readonly name: string;
  readonly options: { readonly actions: object };
}
```

| Field     | Summary               |
| --------- | --------------------- |
| `name`    | The policy's name.    |
| `options` | The policy's options. |

Source: `packages/auth/src/policy/types.ts:128`

## ApiKeyPrincipal

A principal admitted on an API key.

```ts
export interface ApiKeyPrincipal {
  readonly kind: 'api_key';
  readonly userId: string;
  readonly keyId: string;
  readonly scopes: readonly string[];
}
```

| Field    | Summary                                     |
| -------- | ------------------------------------------- |
| `kind`   | Marks the credential kind.                  |
| `userId` | The subject.                                |
| `keyId`  | The key's id.                               |
| `scopes` | The key's scopes, each `<policy>:<action>`. |

Source: `packages/auth/src/policy/types.ts:24`

## CredentialKind

A credential kind a policy may accept.

```ts
export type CredentialKind = 'session' | 'api_key' | 'jwt';
```

Source: `packages/auth/src/policy/types.ts:50`

## DefinePolicy

The type of `definePolicy`: infers the name, the input, the resource and the action names.

It throws `TypeError` for a name outside the access-name grammar or starting `auth.`.

```ts
export type DefinePolicy = <const N extends string, I extends { readonly [key: string]: Schema }, R, K extends string>(
  name: N,
  options: PolicyOptions<I, R, K>,
) => Policy<N, I, R, K>;
```

Source: `packages/auth/src/policy/types.ts:139`

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

## JwtPrincipal

A principal admitted on an external JWT, after every check and the application's map passed.

```ts
export interface JwtPrincipal {
  readonly kind: 'jwt';
  readonly issuer: string;
  readonly subject: string;
  readonly userId: string | null;
  readonly claims: { readonly [name: string]: unknown };
}
```

| Field     | Summary                                          |
| --------- | ------------------------------------------------ |
| `kind`    | Marks the credential kind.                       |
| `issuer`  | The token's issuer.                              |
| `subject` | The token's subject.                             |
| `userId`  | The user the application's map named, or `null`. |
| `claims`  | The token's verified claims.                     |

Source: `packages/auth/src/policy/types.ts:36`

## Policy

A frozen policy, bound to routes by the gate at boot.

```ts
export interface Policy<N extends string, I extends { readonly [key: string]: Schema }, R, K extends string> {
  readonly name: N;
  readonly options: PolicyOptions<I, R, K>;
  operation<A extends K, T extends readonly unknown[], U>(
    action: A,
    body: (grant: Grant<N, A, R>, ...args: T) => U,
  ): (grant: Grant<N, A, R>, ...args: T) => U;
}
```

| Field       | Summary                                                                     |
| ----------- | --------------------------------------------------------------------------- |
| `name`      | The policy's name, unique on a server.                                      |
| `options`   | The policy's options as given.                                              |
| `operation` | Wraps a body that may run only with a live grant of this policy and action. |

Source: `packages/auth/src/policy/types.ts:111`

## PolicyOptions

What a policy decides: credentials, an optional limit, the resource to load, its tenant and each action's rule.

Each `input` schema must be the same node, under the same key, in one of the route's `params`, `query` or `body`.

```ts
export interface PolicyOptions<I extends { readonly [key: string]: Schema }, R, K extends string> {
  readonly credentials: readonly CredentialKind[];
  readonly limit?: LimitRule;
  readonly input?: I;
  readonly load?: (context: {
    readonly principal: Principal;
    readonly input: { readonly [P in keyof I]: Infer<I[P]> };
    readonly signal: AbortSignal;
  }) => R | null | undefined | Promise<R | null | undefined>;
  readonly tenant?: {
    /** The resource's tenant name, 1 to 128 characters. */
    readonly of: (resource: R) => string;
    /** Whether the principal belongs to the tenant; only `true` admits. */
    readonly member: (context: {
      readonly principal: Principal;
      readonly tenant: string;
      readonly resource: R;
      readonly signal: AbortSignal;
    }) => boolean | Promise<boolean>;
  };
  readonly actions: {
    readonly [A in K]: (context: {
      readonly principal: Principal;
      readonly resource: R;
      readonly tenant: string | null;
      readonly signal: AbortSignal;
    }) => boolean | Promise<boolean>;
  };
  readonly denial?: 'forbidden' | 'not_found';
}
```

| Field         | Summary                                                                                            |
| ------------- | -------------------------------------------------------------------------------------------------- |
| `credentials` | The credential kinds accepted, at least one.                                                       |
| `limit`       | A limit charged per policy and principal before authorization.                                     |
| `input`       | The route values `load` receives, by key.                                                          |
| `load`        | Loads the resource from the input; `null` or `undefined` answers 404.                              |
| `tenant`      | The resource's tenant and the membership rule; allowed only with `load`; a non-member answers 404. |
| `actions`     | One rule per action; only `true` admits.                                                           |
| `denial`      | How a refused action answers: 403, or 404 as if the resource were absent (default `'forbidden'`).  |

Source: `packages/auth/src/policy/types.ts:72`

## Principal

Who a request's credential resolved to: a session, an API key or an external JWT.

```ts
export type Principal = SessionPrincipal | ApiKeyPrincipal | JwtPrincipal;
```

Source: `packages/auth/src/policy/types.ts:9`

## SessionPrincipal

A principal admitted on a session cookie.

```ts
export interface SessionPrincipal {
  readonly kind: 'session';
  readonly userId: string;
  readonly createdAt: number;
  readonly expiresAt: number;
}
```

| Field       | Summary                                                                                         |
| ----------- | ----------------------------------------------------------------------------------------------- |
| `kind`      | Marks the credential kind.                                                                      |
| `userId`    | The subject.                                                                                    |
| `createdAt` | When the session was first issued, in epoch milliseconds.                                       |
| `expiresAt` | When the session ends without further renewal, judged at this admission, in epoch milliseconds. |

Source: `packages/auth/src/policy/types.ts:12`

## definePolicy

Defines a frozen policy; each grant it issues carries its principal's authority until its request ends, even shared.

Throws `TypeError` for a bad or `auth.`-prefixed name; an operation acts on `grant.resource` and checks no id argument.

```ts
export const definePolicy: DefinePolicy
```

```ts
definePolicy('doc', { credentials: ['session'], actions: { read: () => true } });
```

Source: `packages/auth/src/policy/policy.ts:27`

## isPrincipal

Tells whether a value is a principal auth admitted, by registry membership; a copy is never one.

```ts
export function isPrincipal(value: unknown): value is Principal;
```

```ts
isPrincipal({ kind: 'session', userId: 'u1', createdAt: 0, expiresAt: 0 });
```

Source: `packages/auth/src/policy/policy.ts:38`

## isGrant

Tells whether a value is a grant auth issued and has not released, by registry membership; a clone is never one.

```ts
export function isGrant(value: unknown): value is Grant<string, string, unknown>;
```

```ts
isGrant({ policy: 'documents', action: 'read', resource: null });
```

Source: `packages/auth/src/policy/policy.ts:46`
