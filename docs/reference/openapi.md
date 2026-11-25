# OpenAPI behavior reference

`@skeld/openapi` generates an OpenAPI 3.1.2 document from a skeld contract, offline. This page lists what `createOpenApi` accepts, what it emits and when it refuses.

Install it with `npm install @skeld/openapi`. It needs Node 26.12 or later (`engines`: `node >=26.12.0`), takes `@skeld/core` `^0.3.0` as a peer dependency and has no other dependency. For a guided introduction, read [Publish an OpenAPI document](../guides/openapi.md). Exact signatures are in the [API reference](../api/README.md#openapi-api).

## Entry points

| Import                         | Exports                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@skeld/openapi`               | `createOpenApi`; the types `OpenApiOptions`, `RouteDocumentation`, `SecurityScheme`, `SecurityRequirement`, `OpenApiResult`, `OpenApiDiagnostic`, `DiagnosticCode`, `ErrorCode`, and the document types `OpenApiDocument`, `OpenApiInfo`, `OpenApiServer`, `OpenApiPathItem`, `OpenApiOperation`, `OpenApiParameter`, `OpenApiParameterConstraint`, `OpenApiRequestBody`, `OpenApiResponse`, `OpenApiMediaType`, `OpenApiSchema` |
| `@skeld/openapi/openapi-error` | `OpenApiError`; the type `ErrorCode`                                                                                                                                                                                                                                                                                                                                                                                             |
| `@skeld/openapi/package.json`  | the manifest                                                                                                                                                                                                                                                                                                                                                                                                                     |

## createOpenApi

`createOpenApi(contract, options)` returns `{ document, diagnostics }` or throws `OpenApiError`. It runs no handler, reads no file or environment variable, opens no connection and keeps no cache. Each call returns fresh objects that share nothing with the input or with another result.

Each route is checked alone with `defineContract`, in route-name order, so a refusal names the route. The checks then run in this order: options, paths and collisions, then route by route its security and its schemas.

## Options

Options are plain application data: own string keys and JSON values. A field set to `undefined` is read as absent, an entry of the `routes`, `responses` or `securitySchemes` map included. Anything else not listed here refuses `INVALID_METADATA`: an unknown key, a symbol key, a value of the wrong type. A map option (`routes`, `responses`, `securitySchemes`, a security requirement) must be a plain object; a `Map` or a class instance is refused rather than read as empty. Inherited properties are never read, so names such as `__proto__`, `constructor` and `toString` are ordinary keys.

| Option                       | Rules                                                                                                                                                                                                                                                                     | Default            |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ |
| `info.title`, `info.version` | Strings that are not blank                                                                                                                                                                                                                                                | required           |
| `info.description`           | A string                                                                                                                                                                                                                                                                  | none               |
| `servers`                    | A list of `{ url, description? }`. `url` is an absolute `http` or `https` URL without credentials, or a path from the root (`/v1`, not `//host`); no `#` fragment, no `{` or `}` template, no surrounding whitespace and no userinfo, even an empty one (`https://@host`) | no `servers`       |
| `routes`                     | A map from route names of the contract to `RouteDocumentation`; a name the contract lacks is refused                                                                                                                                                                      | nothing documented |
| `securitySchemes`            | A map from scheme names matching `[A-Za-z0-9._-]+` to `SecurityScheme`                                                                                                                                                                                                    | no `components`    |

`RouteDocumentation`:

| Field                    | Rules                                                                                          | Default                 |
| ------------------------ | ---------------------------------------------------------------------------------------------- | ----------------------- |
| `summary`, `description` | Strings                                                                                        | none                    |
| `tags`                   | A list of strings, kept in order                                                               | none                    |
| `operationId`            | A nonempty string, unique across the document                                                  | the route name          |
| `deprecated`             | A boolean                                                                                      | none                    |
| `responses`              | A map from statuses the route declares to description strings; an undeclared status is refused | `Response <status>`     |
| `security`               | A list of `SecurityRequirement` alternatives, checked against the route's access               | `[]` for a public route |

`SecurityScheme`:

| `type`          | Fields                                                             | Rules                                                                          |
| --------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------ |
| `http`          | `scheme: 'bearer'`, `bearerFormat?`, `description?`                | Bearer is the only HTTP scheme                                                 |
| `apiKey`        | `in` (`'header'`, `'query'` or `'cookie'`), `name`, `description?` | `name` is an HTTP token (RFC 9110), also for `query`                           |
| `openIdConnect` | `openIdConnectUrl`, `description?`                                 | An absolute `https` URL without credentials or fragment; copied, never fetched |

A `SecurityRequirement` maps scheme names to scope lists. Every name must be a defined scheme, else `INVALID_SECURITY`. Bearer and API-key scopes must be empty. OpenID Connect scopes are distinct nonempty strings; the list may be empty. An entry set to `undefined` inside a requirement is refused, since dropping it would make the alternative anonymous.

## Security consistency

| Route access         | Accepted `security`                                     | Emitted  |
| -------------------- | ------------------------------------------------------- | -------- |
| absent or `'public'` | absent or `[]`                                          | `[]`     |
| `'optional'`         | at least one `{}` and at least one nonempty alternative | the list |
| `{ policy, action }` | at least one alternative, none of them `{}`             | the list |

Any other combination refuses `INVALID_SECURITY` at `routes.<name>.security`. No root `security` is emitted. The checks cannot compare the metadata with the auth configuration a server runs; see [Describe security](../guides/openapi.md#describe-security).

## Routes and HTTP

| Contract                                                                                     | Document                                                                                                                                                                   |
| -------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET`, `POST`, `PUT`, `PATCH`, `DELETE`                                                      | The lower-case operation under its path; no implicit `HEAD` or `OPTIONS`                                                                                                   |
| `:name` segment                                                                              | `{name}` and a required path parameter, its optional wrapper unwrapped                                                                                                     |
| `*` segment, or `{` or `}` in a segment                                                      | `UNSUPPORTED_PATH`                                                                                                                                                         |
| Same method and path, or the same path with other parameter names (`/a/{id}` and `/a/{key}`) | `COLLISION`; the same path with other methods and the same names is one path item                                                                                          |
| Repeated operation ID                                                                        | `COLLISION`                                                                                                                                                                |
| `params`, `headers` property                                                                 | `style: simple`; a header is required unless optional                                                                                                                      |
| `query` property                                                                             | `style: form`, `explode: true`; required unless optional; an array of scalars is repeated keys                                                                             |
| `cookies` property                                                                           | `content: text/plain` with `{ type: string }`, and `x-skeld-valueSchema`                                                                                                   |
| `accept`, `content-type`, `authorization` header                                             | Omitted, with `RESERVED_HEADER`                                                                                                                                            |
| `minProperties` on a parameter object                                                        | `x-skeld-parameterConstraints`; no object-level `additionalProperties` on parameters                                                                                       |
| `body`                                                                                       | `requestBody` with `required: true`, the outer `t.optional` unwrapped; `application/json`, and `text/plain` with the string and string-literal branches when there are any |
| No `body`                                                                                    | No `requestBody`                                                                                                                                                           |
| Response schema                                                                              | `application/json` content, read as a response; an outer `t.optional` unwrapped, as core serves it                                                                         |
| `null` response, 204, 304                                                                    | A description and no content                                                                                                                                               |
| Undeclared status, engine error, hook response                                               | Not documented                                                                                                                                                             |

Parameters are listed path, query, header, cookie, each by name.

## Schemas

| Schema                  | Request                                                                                                | Response                                                               |
| ----------------------- | ------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------- |
| `t.string`              | `type: string`; bounds as `x-skeld-minLengthUtf16` and `x-skeld-maxLengthUtf16`                        | same                                                                   |
| `t.integer`, `t.number` | `type`, `minimum`, `maximum`                                                                           | same                                                                   |
| `t.boolean`, `t.null`   | `type: boolean`, `type: null`                                                                          | same                                                                   |
| `t.literal`             | `const`                                                                                                | same                                                                   |
| `t.object`              | `properties`, `required` (the non-optional keys), `additionalProperties: false`, or `true` when `open` | `additionalProperties: false` always                                   |
| `minProperties`         | `minProperties`, or `x-skeld-minDeclaredProperties` on an open object                                  | `minProperties`                                                        |
| `t.array`               | `items`, `minItems`, `maxItems`                                                                        | same                                                                   |
| `t.record`              | `type: object`, `propertyNames`, `additionalProperties` (the value schema), `maxProperties`            | same                                                                   |
| `t.union`               | `anyOf`, members in declaration order                                                                  | same                                                                   |
| `t.optional`            | Requiredness of its property                                                                           | same                                                                   |
| `t.exposed`             | The inner schema                                                                                       | The inner schema; secrets below it are allowed                         |
| `sensitivity`           | `x-sensitivity`; a secret also `writeOnly: true`                                                       | `x-sensitivity`; a secret outside `t.exposed` refuses `INVALID_SCHEMA` |

`open`, `unbounded` and exposure reasons are never written. Bounds must be finite and ordered, and counts non-negative integers, else `INVALID_SCHEMA`; an optional anywhere but a property, the outer body or the outer response schema also refuses it. Every occurrence of a shared schema is written in full where it is used. The diagnostics and extension keywords are listed in [What the document cannot say](../guides/openapi.md#what-the-document-cannot-say).

## Ordering

Paths, methods, property maps, requirement keys and every metadata map are sorted by UTF-16 code unit. JavaScript then serializes integer-like keys first, in numeric order, so a property `"9"` comes before `"10"`; response statuses are therefore in numeric order. Union members, tags, servers and security alternatives keep their order. Equal input gives equal `JSON.stringify` output whatever the insertion order of its maps.

## Limits

| Limit                                                                 | Value                                | Refusal                                    |
| --------------------------------------------------------------------- | ------------------------------------ | ------------------------------------------ |
| Routes in the contract                                                | 10,000                               | `LIMIT_EXCEEDED` at `[]`                   |
| Schema occurrences visited in one call, shared ones counted each time | 100,000                              | `LIMIT_EXCEEDED` at the occurrence past it |
| Nested schema nodes on one path                                       | 64                                   | `LIMIT_EXCEEDED` at the node past it       |
| Option values visited in one call                                     | 100,000, with a counter of their own | `LIMIT_EXCEEDED`                           |

The limits are fixed. The output size is not capped separately.

## Errors

`OpenApiError` has `name: 'OpenApiError'`, a `code` and a `location` list. The message is fixed per code. Contract locations start at the route name; option locations start at the option key, such as `['routes', 'getTask', 'operationId']`. A repeated default operation ID is located at the route; a supplied one at its `operationId`.

| Code               | When                                                                                                                                          | Message                                  |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| `INVALID_CONTRACT` | The contract is not an object, or `defineContract` refuses a route                                                                            | `Invalid contract`                       |
| `INVALID_METADATA` | An unknown key, a wrong type, a blank title or version, a bad URL, scheme name or API-key name, an undeclared status, an empty operation ID   | `Invalid documentation metadata`         |
| `UNSUPPORTED_PATH` | A wildcard or a literal brace in a path                                                                                                       | `Unsupported OpenAPI path`               |
| `COLLISION`        | A repeated method and path, a renamed path parameter, a repeated operation ID                                                                 | `Conflicting OpenAPI operation`          |
| `INVALID_SCHEMA`   | An invalid bound or node, an optional anywhere but a property, the outer body or the outer response schema, an unexposed secret in a response | `Invalid documentation schema`           |
| `INVALID_SECURITY` | Security that contradicts the access, an undefined scheme, a scope where none is allowed, an empty or repeated OpenID Connect scope           | `Invalid documentation security`         |
| `LIMIT_EXCEEDED`   | A limit above                                                                                                                                 | `Documentation traversal limit exceeded` |

A refused call returns no partial document.

## Not included

- No YAML, no OpenAPI 3.0, 2.0 or 3.2, no `components.schemas`, no `$ref` to other documents.
- No route discovery from a server, no hidden routes, no hooks or custom transforms.
- No example values, no documentation UI, no serving.
- No OAuth flows; policies and actions are not turned into scopes.
- No check that security metadata matches the auth configuration.
