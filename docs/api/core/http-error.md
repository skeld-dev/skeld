# @skeld/core/http-error

## HttpErrorOptions

The options of `new HttpError`.

```ts
export interface HttpErrorOptions {
  readonly details?: readonly ErrorDetail[];
  readonly cookies?: readonly OutgoingCookie[];
  readonly cause?: unknown;
}
```

| Field     | Summary                                                                                                     |
| --------- | ----------------------------------------------------------------------------------------------------------- |
| `details` | The details written in the error body's `details`.                                                          |
| `cookies` | The cookies the error's response sets, checked as a reply's are; one invalid cookie makes it the fixed 500. |
| `cause`   | The underlying cause, kept on the error and never written to the client.                                    |

Source: `packages/core/src/contract/types.ts:97`

## OutgoingCookie

A cookie a response sets, written as one `Set-Cookie` line; unset attributes take the secure defaults.

An invalid cookie is refused, never encoded: a handler's reply becomes the fixed 500, `setCookie` throws `Error`.

```ts
export interface OutgoingCookie {
  readonly name: string;
  readonly value: string;
  readonly path?: string;
  readonly domain?: string;
  readonly maxAge?: number;
  readonly httpOnly?: boolean;
  readonly secure?: boolean;
  readonly sameSite?: 'Strict' | 'Lax' | 'None';
  readonly partitioned?: boolean;
}
```

| Field         | Summary                                                                                                                              |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `name`        | The name, an HTTP token; a `__Host-` name needs `secure`, path `/` and no domain, a `__Secure-` one `secure`.                        |
| `value`       | The value, sent as given: printable ASCII except space, `"`, `,`, `;` and `\`; name and value fit 4,096 bytes.                       |
| `path`        | The path it is sent back on (default `/`): it starts with `/`, is printable ASCII without `;`, at most 1,024 bytes.                  |
| `domain`      | The domain it is sent back to, widening it to subdomains (default this host only); printable ASCII without `;`, at most 1,024 bytes. |
| `maxAge`      | Its lifetime in whole seconds, from 0 to 34,560,000 (400 days); `0` clears it (default: until the browser closes).                   |
| `httpOnly`    | Whether page scripts are denied it (default true).                                                                                   |
| `secure`      | Whether it is sent only over HTTPS (default true); `sameSite: 'None'` and `partitioned` need it.                                     |
| `sameSite`    | Which cross-site requests carry it (default `Lax`).                                                                                  |
| `partitioned` | Whether it is keyed to the top-level site it was set under (default false).                                                          |

Source: `packages/core/src/contract/types.ts:75`

## HttpError

An error with an HTTP status and a code, written to the client as the one error body.

A `null` status marks a client-side failure and is written as 500; throws `RangeError` for a status outside 400-599 or a code other than upper-case letters, digits and `_`.

```ts
export class HttpError extends Error {
  override readonly name = 'HttpError';
  readonly status: number | null;
  readonly code: string;
  readonly details: readonly ErrorDetail[] | null;
  readonly cookies: readonly OutgoingCookie[] | null;
  constructor(status: number | null, code: string, message: string, options?: HttpErrorOptions);
}
```

```ts
new HttpError(404, 'NOT_FOUND', 'No such user');
```

Source: `packages/core/src/contract/http-error.ts:19`
