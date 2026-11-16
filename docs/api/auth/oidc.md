# @skeld/auth/oidc

## Oidc

The OIDC part given to `createAuth`, with the handlers of `oidcRoutes`.

```ts
export interface Oidc extends OidcPart {
  readonly handlers: Handlers<OidcRoutes>;
}
```

| Field      | Summary                                        |
| ---------- | ---------------------------------------------- |
| `handlers` | The handlers of the start and callback routes. |

Source: `packages/auth/src/oidc/types.ts:37`

## OidcClaims

Selected claims of a verified ID Token.

```ts
export interface OidcClaims {
  readonly email: string | null;
  readonly emailVerified: boolean;
  readonly name: string | null;
  readonly all: { readonly [claim: string]: unknown };
}
```

| Field           | Summary                                                                                     |
| --------------- | ------------------------------------------------------------------------------------------- |
| `email`         | The `email` claim when a string of 1 to 254 characters, else `null`; compared with nothing. |
| `emailVerified` | True only for the JSON boolean `true` beside a non-null `email`.                            |
| `name`          | The `name` claim when a string of 1 to 256 characters, else `null`.                         |
| `all`           | Every claim of the ID Token.                                                                |

Source: `packages/auth/src/oidc/types.ts:55`

## OidcIdentity

A verified identity: a provider's issuer and subject, with selected claims.

```ts
export interface OidcIdentity {
  readonly provider: string;
  readonly issuer: string;
  readonly subject: string;
  readonly claims: OidcClaims;
}
```

| Field      | Summary                          |
| ---------- | -------------------------------- |
| `provider` | The provider's name.             |
| `issuer`   | The provider's issuer.           |
| `subject`  | The subject at that issuer.      |
| `claims`   | Selected claims of the ID Token. |

Source: `packages/auth/src/oidc/types.ts:43`

## OidcOptions

The options of `oidc`: 1 to 16 providers, the failure and return paths and the application's user mapper.

The gate's boot refuses a bad option with BootError `GATE_FAILED`; both paths are local paths with no query.

```ts
export interface OidcOptions {
  readonly providers: { readonly [name: string]: OidcProvider };
  readonly failurePath: string;
  readonly returnPath?: string;
  readonly resolveUser: OidcResolveUser;
}
```

| Field         | Summary                                                                            |
| ------------- | ---------------------------------------------------------------------------------- |
| `providers`   | The providers by name: 1 to 32 characters of `a-z` and `0-9`, a letter first.      |
| `failurePath` | Where a failed callback redirects, with `provider` and `error` added to its query. |
| `returnPath`  | Where a start without `returnTo` returns (default `/`).                            |
| `resolveUser` | Maps a verified identity to a user, under 5,000 ms.                                |

Source: `packages/auth/src/oidc/types.ts:13`

## OidcProvider

One provider; its issuer is unique among the providers.

```ts
export interface OidcProvider {
  readonly issuer: string;
  readonly clientId: string;
  readonly clientSecret: Secret<string>;
  readonly scopes?: readonly string[];
}
```

| Field          | Summary                                                                         |
| -------------- | ------------------------------------------------------------------------------- |
| `issuer`       | An `https` URL of at most 255 characters, with no query, fragment or userinfo.  |
| `clientId`     | The client id, 1 to 255 characters of U+0021 to U+007E.                         |
| `clientSecret` | The client secret, 1 to 512 characters, sent with `client_secret_basic`.        |
| `scopes`       | Scopes beyond `openid`, which is always sent: at most 16 of 1 to 64 characters. |

Source: `packages/auth/src/oidc/types.ts:25`

## OidcResolution

The answer of an `OidcResolveUser`.

```ts
export type OidcResolution =
  | {
      readonly kind: 'user';
      readonly userId: string;
    }
  | { readonly kind: 'deny' };
```

| Field    | Summary                                               |
| -------- | ----------------------------------------------------- |
| `kind`   | Whether the identity signs in as a user or is denied. |
| `userId` | The user the identity signs in as.                    |

Source: `packages/auth/src/oidc/types.ts:70`

## OidcResolveUser

Maps a verified identity to a user, or denies it; called twice, and both answers must name the same user.

```ts
export type OidcResolveUser = (identity: OidcIdentity, signal: AbortSignal) => OidcResolution | Promise<OidcResolution>;
```

Source: `packages/auth/src/oidc/types.ts:67`

## oidc

Creates the OIDC part given to `createAuth`, with the handlers of `oidcRoutes`; it signs in through configured providers.

Its options are checked at boot (BootError `GATE_FAILED`, component `oidc`); a handler before boot rejects `NOT_READY`.

```ts
export function oidc(options: OidcOptions): Oidc;
```

```ts
oidc({
  providers: { acme: { issuer: 'https://id.example', clientId: 'app', clientSecret: new Secret('s3cret') } },
  failurePath: '/login',
  resolveUser: () => ({ kind: 'deny' }),
});
```

Source: `packages/auth/src/oidc/oidc.ts:29`
