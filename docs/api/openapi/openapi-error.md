# @skeld/openapi/openapi-error

## ErrorCode

Why generation was refused; each code has one fixed message.

```ts
export type ErrorCode =
  | 'INVALID_CONTRACT'
  | 'INVALID_METADATA'
  | 'UNSUPPORTED_PATH'
  | 'COLLISION'
  | 'INVALID_SCHEMA'
  | 'INVALID_SECURITY'
  | 'LIMIT_EXCEEDED';
```

Source: `packages/openapi/src/openapi/openapi-error.ts:5`

## OpenApiError

The error generation throws; `code` names the reason, `location` the route, part or key, and the message is fixed.

A refused call returns no partial document.

```ts
export class OpenApiError extends Error {
  override readonly name = 'OpenApiError';
  readonly code: ErrorCode;
  readonly location: readonly (string | number)[];
  constructor(code: ErrorCode, location: readonly (string | number)[]);
}
```

```ts
new OpenApiError('INVALID_METADATA', ['info', 'title']);
```

Source: `packages/openapi/src/openapi/openapi-error.ts:29`
