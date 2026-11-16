# @skeld/auth/jwt

## Jwk

A JSON Web Key; its type fixes its algorithm: RSA of at least 2,048 bits is RS256, P-256 is ES256.

```ts
export interface Jwk {
  readonly kty: string;
  readonly kid: string;
  readonly alg?: string;
  /** The key's other members. */
  readonly [member: string]: unknown;
}
```

| Field | Summary                                            |
| ----- | -------------------------------------------------- |
| `kty` | The key type.                                      |
| `kid` | The key id.                                        |
| `alg` | The algorithm, which must agree with the key type. |

Source: `packages/auth/src/jwt/types.ts:26`

## Jwt

The JWT part given to `createAuth`.

```ts
export type Jwt = JwtPart;
```

Source: `packages/auth/src/jwt/types.ts:58`

## JwtMap

Maps a verified token's issuer, subject and claims to a user, or denies it.

```ts
export type JwtMap = (
  verified: {
    readonly issuer: string;
    readonly subject: string;
    readonly claims: { readonly [name: string]: unknown };
  },
  signal: AbortSignal,
) => JwtMapped | Promise<JwtMapped>;
```

Source: `packages/auth/src/jwt/types.ts:38`

## JwtMapped

The answer of a `JwtMap`.

```ts
export type JwtMapped =
  | {
      readonly kind: 'accept';
      readonly userId: string | null;
    }
  | { readonly kind: 'deny' };
```

| Field    | Summary                                                          |
| -------- | ---------------------------------------------------------------- |
| `kind`   | Whether the token is accepted or denied.                         |
| `userId` | The user the token acts for, or `null` when it acts for no user. |

Source: `packages/auth/src/jwt/types.ts:48`

## JwtOptions

The options of `jwt`: one issuer, one audience, the accepted algorithms and exactly one of `keys` and `jwksUrl`.

The gate's boot refuses any other shape with BootError `GATE_FAILED`; there is no signing or refresh.

```ts
export interface JwtOptions {
  readonly issuer: string;
  readonly audience: string;
  readonly algorithms: readonly ('RS256' | 'ES256')[];
  readonly keys?: readonly Jwk[];
  readonly jwksUrl?: string;
  readonly map: JwtMap;
}
```

| Field        | Summary                                              |
| ------------ | ---------------------------------------------------- |
| `issuer`     | The one accepted `iss`.                              |
| `audience`   | The one accepted `aud`.                              |
| `algorithms` | The accepted algorithms, at least one.               |
| `keys`       | The verification keys, each with a `kid`.            |
| `jwksUrl`    | An `https` URL of the key set, fetched at first use. |
| `map`        | Maps verified claims to a user, under 5,000 ms.      |

Source: `packages/auth/src/jwt/types.ts:10`

## jwt

Creates the JWT part given to `createAuth`; it verifies tokens of one issuer and audience and issues none.

Its options are checked at boot (BootError `GATE_FAILED`, component `jwt`); exactly one of `keys` and `jwksUrl`.

```ts
export function jwt(options: JwtOptions): Jwt;
```

```ts
jwt({
  issuer: 'https://id.example',
  audience: 'api',
  algorithms: ['RS256'],
  jwksUrl: 'https://id.example/jwks.json',
  map: (v) => ({ kind: 'accept', userId: v.subject }),
});
```

Source: `packages/auth/src/jwt/jwt.ts:123`
