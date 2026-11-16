# @skeld/auth/api-key

## ApiKeyInfo

An API key as listed: never its secret or digest.

```ts
export interface ApiKeyInfo {
  readonly keyId: string;
  readonly name: string;
  readonly scopes: readonly string[];
  readonly createdAt: number;
  readonly expiresAt: number | null;
}
```

| Field       | Summary                                                      |
| ----------- | ------------------------------------------------------------ |
| `keyId`     | The key's id, 16 characters.                                 |
| `name`      | The key's name.                                              |
| `scopes`    | The key's scopes, each `<policy>:<action>`.                  |
| `createdAt` | When it was issued, in epoch milliseconds.                   |
| `expiresAt` | When it expires, in epoch milliseconds, or `null` for never. |

Source: `packages/auth/src/api-key/types.ts:42`

## ApiKeyOptions

The options of `apiKeys`.

```ts
export interface ApiKeyOptions {
  readonly maxPerUser?: number;
}
```

| Field        | Summary                                                               |
| ------------ | --------------------------------------------------------------------- |
| `maxPerUser` | Most unexpired keys one user may hold, from 1 to 1,000 (default 100). |

Source: `packages/auth/src/api-key/types.ts:9`

## ApiKeys

The API-key part given to `createAuth`, with its trusted server-side administration calls; there are no key routes.

Each call rejects AuthError `INVALID_INPUT` for an input out of bounds, `NOT_READY` before `listen` and `CLOSED` after.

```ts
export interface ApiKeys extends ApiKeyPart {
  issue(input: {
    readonly userId: string;
    readonly name: string;
    readonly scopes: readonly string[];
    readonly expiresInSeconds?: number;
  }): Promise<
    | { readonly kind: 'issued'; readonly key: Secret<string>; readonly info: ApiKeyInfo }
    | { readonly kind: 'refused'; readonly reason: 'limit' | 'disabled' }
    | Unavailable
  >;
  list(input: {
    readonly userId: string;
  }): Promise<{ readonly kind: 'listed'; readonly keys: readonly ApiKeyInfo[] } | Unavailable>;
  revoke(input: {
    readonly userId: string;
    readonly keyId: string;
  }): Promise<{ readonly kind: 'revoked' } | { readonly kind: 'absent' } | Unavailable>;
}
```

| Field    | Summary                                                        |
| -------- | -------------------------------------------------------------- |
| `issue`  | Issues a key; the secret appears only in the `issued` outcome. |
| `list`   | Lists a user's unexpired keys.                                 |
| `revoke` | Revokes one of a user's keys.                                  |

Source: `packages/auth/src/api-key/types.ts:18`

## apiKeys

Creates the API-key part given to `createAuth`; it checks its options at `listen` (`maxPerUser` 1 to 1,000).

Keys are `skeld1.<id>.<secret>` bearer tokens; administration is these trusted calls, never routes.

```ts
export function apiKeys(options?: ApiKeyOptions): ApiKeys;
```

```ts
const keys = apiKeys({ maxPerUser: 20 });
```

Source: `packages/auth/src/api-key/api-key.ts:93`
