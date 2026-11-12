# @skeld/core/http-error

## HttpErrorOptions

The options of `new HttpError`.

```ts
export interface HttpErrorOptions {
  readonly details?: readonly ErrorDetail[];
  readonly cause?: unknown;
}
```

| Field     | Summary                                                                  |
| --------- | ------------------------------------------------------------------------ |
| `details` | The details written in the error body's `details`.                       |
| `cause`   | The underlying cause, kept on the error and never written to the client. |

Source: `packages/core/src/contract/types.ts:64`

## HttpError

An error with an HTTP status and a code, written to the client as the one error body.

A `null` status marks a client-side failure and is written as 500; throws `RangeError` for a status outside 400-599 or a code other than upper-case letters, digits and `_`.

```ts
export class HttpError extends Error {
  override readonly name = 'HttpError';
  readonly status: number | null;
  readonly code: string;
  readonly details: readonly ErrorDetail[] | null;
  constructor(status: number | null, code: string, message: string, options?: HttpErrorOptions);
}
```

```ts
new HttpError(404, 'NOT_FOUND', 'No such user');
```

Source: `packages/core/src/contract/http-error.ts:19`
