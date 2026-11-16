# @skeld/auth/password

## Hashed

The outcome of `hashPassword`.

```ts
export type Hashed =
  | {
      readonly kind: 'hashed';
      readonly hash: string;
    }
  | { readonly kind: 'invalid_password' }
  | { readonly kind: 'busy' };
```

| Field  | Summary                                                                                            |
| ------ | -------------------------------------------------------------------------------------------------- |
| `kind` | Whether the password was hashed, refused for its length, or not hashed because the queue was full. |
| `hash` | The encoded hash, `$argon2id$v=19$m=<m>,t=<t>,p=1$<salt>$<tag>`.                                   |

Source: `packages/auth/src/password/types.ts:13`

## PasswordCost

An Argon2id cost; a given cost may only raise the default of 19,456 KiB and 2 passes.

```ts
export interface PasswordCost {
  readonly memoryKiB: number;
  readonly passes: number;
}
```

| Field       | Summary                                                                  |
| ----------- | ------------------------------------------------------------------------ |
| `memoryKiB` | Memory in KiB, from 19,456 to 262,144; times `passes` at most 1,048,576. |
| `passes`    | Passes, from 2 to 16.                                                    |

Source: `packages/auth/src/password/types.ts:5`

## PasswordVerdict

The outcome of `verifyPassword`.

```ts
export type PasswordVerdict =
  | {
      readonly kind: 'match';
    }
  | { readonly kind: 'mismatch' }
  | { readonly kind: 'invalid_hash' }
  | { readonly kind: 'busy' };
```

| Field  | Summary                                                                                     |
| ------ | ------------------------------------------------------------------------------------------- |
| `kind` | Whether the password matched, did not match, met a hash out of bounds, or met a full queue. |

Source: `packages/auth/src/password/types.ts:24`

## hashPassword

Hashes a password with Argon2id; `busy` when the two computations run and 64 callers wait.

A password not 1 to 1,024 bytes is `invalid_password`; a bad cost or option key rejects AuthError `INVALID_INPUT`.

```ts
export async function hashPassword(
  password: Secret<string>,
  options?: { readonly cost?: PasswordCost; readonly signal?: AbortSignal },
): Promise<Hashed>;
```

```ts
await hashPassword(new Secret('correct horse battery staple'));
```

Source: `packages/auth/src/password/password.ts:166`

## verifyPassword

Verifies a password against an encoded Argon2id hash with the parameters it holds.

A hash out of bounds is `invalid_hash`, never `mismatch`; an unknown option key rejects AuthError `INVALID_INPUT`.

```ts
export async function verifyPassword(
  password: Secret<string>,
  hash: string,
  options?: { readonly signal?: AbortSignal },
): Promise<PasswordVerdict>;
```

```ts
await verifyPassword(
  new Secret('correct horse battery staple'),
  '$argon2id$v=19$m=19456,t=2,p=1$sq6p/F+NCx9MMbhP5H+RyA$v9Qea79zKt24VcM7xMpNxSekAOB65j1RAIspflkC+x4',
);
```

Source: `packages/auth/src/password/password.ts:201`

## needsRehash

Checks whether a hash falls below a cost (default 19,456 KiB, 2 passes) or does not parse; writes nothing.

Throws AuthError `INVALID_INPUT` for a cost out of bounds.

```ts
export function needsRehash(hash: string, cost?: PasswordCost): boolean;
```

```ts
needsRehash('$argon2id$v=19$m=19456,t=2,p=1$sq6p/F+NCx9MMbhP5H+RyA$v9Qea79zKt24VcM7xMpNxSekAOB65j1RAIspflkC+x4', {
  memoryKiB: 65_536,
  passes: 3,
});
```

Source: `packages/auth/src/password/password.ts:236`
