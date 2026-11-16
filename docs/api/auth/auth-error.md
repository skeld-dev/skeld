# @skeld/auth/auth-error

## AuthErrorCode

Why an auth call failed; each code has one fixed message.

```ts
export type AuthErrorCode =
  | 'NOT_READY'
  | 'CLOSED'
  | 'INVALID_INPUT'
  | 'UNAVAILABLE'
  | 'CALLBACK_FAILED'
  | 'GRANT_UNKNOWN'
  | 'GRANT_POLICY'
  | 'GRANT_ACTION'
  | 'GRANT_RELEASED';
```

Source: `packages/auth/src/auth-error/auth-error.ts:5`

## AuthError

The error an auth call rejects or throws with; `code` names the reason and the message is fixed per code.

The cause, when kept, is never written to a response or a record.

```ts
export class AuthError extends Error {
  override readonly name = 'AuthError';
  readonly code: AuthErrorCode;
  constructor(code: AuthErrorCode, options?: ErrorOptions);
}
```

```ts
new AuthError('INVALID_INPUT');
```

Source: `packages/auth/src/auth-error/auth-error.ts:33`
