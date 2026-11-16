# @skeld/core/boot-error

## BootErrorCode

Why a service could not boot.

The schema codes `UNBOUNDED_FIELD`, `INVALID_BOUND`, `SECRET_IN_RESPONSE` and `NESTED_TOO_DEEP` come from `listen` and name the route, part and JSON pointer.

```ts
export type BootErrorCode =
  | 'INVALID_OPTION'
  | 'ROUTE_DUPLICATE'
  | 'ERROR_HANDLER_ALREADY_SET'
  | 'REGISTRATION_CLOSED'
  | 'PLUGIN_FAILED'
  | 'PLUGIN_TIMEOUT'
  | 'COMPILE_FAILED'
  | 'LISTEN_FAILED'
  | 'ALREADY_LISTENING'
  | 'SERVER_CLOSED'
  | 'UNBOUNDED_FIELD'
  | 'INVALID_BOUND'
  | 'SECRET_IN_RESPONSE'
  | 'NESTED_TOO_DEEP'
  | 'CODEGEN_UNAVAILABLE'
  | 'ACCESS_WITHOUT_GATE'
  | 'ACCESS_UNDECLARED'
  | 'ACCESS_REFUSED'
  | 'GATE_FAILED';
```

Source: `packages/core/src/server/boot-error.ts:10`

## BootError

The error thrown when a service cannot boot: a bad option, a refused route or plugin, or a failed listen.

`code` names the reason; `route` and `plugin` say where, and are `null` when the error belongs to neither.

```ts
export class BootError extends Error {
  override readonly name = 'BootError';
  readonly code: BootErrorCode;
  readonly route: RouteInfo | null;
  readonly plugin: string | null;
  constructor(
    code: BootErrorCode,
    message: string,
    route: RouteInfo | null,
    plugin: string | null,
    options?: ErrorOptions,
  );
}
```

Source: `packages/core/src/server/boot-error.ts:35`
