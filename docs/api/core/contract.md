# @skeld/core/contract

## ContractRoutes

A contract: route definitions by route name.

```ts
export interface ContractRoutes {
  readonly [name: string]: RouteDefinition;
}
```

Source: `packages/core/src/contract/types.ts:59`

## Empty

The type of a request part the route does not declare: an object with no keys.

```ts
export interface Empty {
  readonly [key: string]: never;
}
```

Source: `packages/core/src/contract/types.ts:137`

## EngineErrorCode

The error codes the server and the client produce themselves.

```ts
export type EngineErrorCode =
  | 'BAD_REQUEST'
  | 'VALIDATION'
  | 'NOT_FOUND'
  | 'PAYLOAD_TOO_LARGE'
  | 'URI_TOO_LONG'
  | 'UNSUPPORTED_MEDIA_TYPE'
  | 'TIMEOUT'
  | 'CROSS_ORIGIN'
  | 'INTERNAL'
  | 'NETWORK'
  | 'INVALID_RESPONSE'
  | 'RESPONSE_TOO_LARGE';
```

Source: `packages/core/src/contract/types.ts:122`

## ErrorBody

The one error body every skeld server writes.

```ts
export interface ErrorBody {
  readonly status: number;
  readonly code: string;
  readonly message: string;
  readonly details?: readonly ErrorDetail[];
}
```

| Field     | Summary                                                        |
| --------- | -------------------------------------------------------------- |
| `status`  | The HTTP status, from 400 to 599.                              |
| `code`    | The machine-readable code, upper-case letters, digits and `_`. |
| `message` | A message for people.                                          |
| `details` | The validation details, when the error has them.               |

Source: `packages/core/src/contract/types.ts:107`

## ErrorDetail

One reason a request or a response failed validation.

```ts
export interface ErrorDetail {
  readonly path: string;
  readonly message: string;
}
```

| Field     | Summary                                                                            |
| --------- | ---------------------------------------------------------------------------------- |
| `path`    | The JSON pointer of the failing value, starting with the part, as in `/body/name`. |
| `message` | What is wrong; it never holds the received value.                                  |

Source: `packages/core/src/contract/types.ts:64`

## HttpMethod

The HTTP methods a route can declare.

```ts
export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
```

Source: `packages/core/src/contract/types.ts:7`

## ResponseSchemas

A route's responses by status: a schema for a body, `null` for none.

Statuses run from 200 to 599; 204 and 304 must be `null`; at least one is declared.

```ts
export interface ResponseSchemas {
  readonly [status: number]: Schema | null;
}
```

Source: `packages/core/src/contract/types.ts:13`

## RouteDefinition

One route of a contract: its method, its path and the schemas of its request parts and responses.

```ts
export interface RouteDefinition {
  readonly method: HttpMethod;
  readonly path: string;
  readonly params?: ObjectSchema;
  readonly query?: ObjectSchema;
  readonly headers?: ObjectSchema;
  readonly cookies?: ObjectSchema;
  readonly body?: Schema;
  readonly responses: ResponseSchemas;
}
```

| Field       | Summary                                                                                                       |
| ----------- | ------------------------------------------------------------------------------------------------------------- |
| `method`    | The HTTP method; a HEAD request is served by the GET route of the same path.                                  |
| `path`      | The path pattern: static segments, `:name` parameters and a final `*` wildcard.                               |
| `params`    | The path parameters' schema: one key per `:name` segment, and `*` for the wildcard.                           |
| `query`     | The query string's schema; the handler receives only the declared keys and others are ignored.                |
| `headers`   | The request headers' schema, with lower-case keys; the handler receives only the declared ones.               |
| `cookies`   | The request cookies' schema; names are case-sensitive tokens and the handler receives only the declared ones. |
| `body`      | The JSON body's schema; a GET route declares none.                                                            |
| `responses` | The responses the route may write, by status.                                                                 |

Source: `packages/core/src/contract/types.ts:18`

## errorBodySchema

The schema of the error body every skeld server writes: `{ status, code, message, details? }`.

Its strings and its `details` are `unbounded`, so a client accepts a server's error message of any length.

```ts
export const errorBodySchema: import("../schema/types.ts").ObjectSchema<{
    status: import("../schema/types.ts").IntegerSchema<number>;
    code: import("../schema/types.ts").StringSchema<string>;
    message: import("../schema/types.ts").StringSchema<string>;
    details: import("../schema/types.ts").OptionalSchema<import("../schema/types.ts").ArraySchema<import("../schema/types.ts").ObjectSchema<{
        path: import("../schema/types.ts").StringSchema<string>;
        message: import("../schema/types.ts").StringSchema<string>;
    }, undefined>, import("../schema/types.ts").ObjectStatic<{
        path: import("../schema/types.ts").StringSchema<string>;
        message: import("../schema/types.ts").StringSchema<string>;
    }>[]>>;
}, undefined>
```

Source: `packages/core/src/contract/contract.ts:26`

## defineContract

Declares a service's routes, checks each one and returns the contract with its literal types kept.

Throws `TypeError` `Route <name> (<METHOD> <path>): <reason>` for a bad path, part schema, parameter, body, status or header key.

```ts
export function defineContract<const C extends ContractRoutes>(routes: C): C;
```

```ts
defineContract({ health: { method: 'GET', path: '/health', responses: { 204: null } } });
```

Source: `packages/core/src/contract/contract.ts:46`
