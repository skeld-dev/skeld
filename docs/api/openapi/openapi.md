# @skeld/openapi

## DiagnosticCode

What a diagnostic reports: a constraint the document describes more weakly than core enforces it.

```ts
export type DiagnosticCode =
  | 'UTF16_LENGTH'
  | 'DECLARED_PROPERTY_COUNT'
  | 'TEXT_PARAMETER'
  | 'PARAMETER_OBJECT_CONSTRAINT'
  | 'RESERVED_HEADER';
```

Source: `packages/openapi/src/openapi/types.ts:276`

## OpenApiDiagnostic

One located diagnostic; the message is fixed by the code.

```ts
export interface OpenApiDiagnostic {
  readonly code: DiagnosticCode;
  readonly location: readonly (string | number)[];
  readonly message: string;
}
```

| Field      | Summary                                                                        |
| ---------- | ------------------------------------------------------------------------------ |
| `code`     | What the diagnostic reports.                                                   |
| `location` | The route, request or response part and property keys the diagnostic is about. |
| `message`  | The fixed message of the code.                                                 |

Source: `packages/openapi/src/openapi/types.ts:284`

## OpenApiDocument

An OpenAPI 3.1.2 document: the subset createOpenApi emits, with schemas inline.

```ts
export interface OpenApiDocument {
  readonly openapi: '3.1.2';
  readonly jsonSchemaDialect: 'https://json-schema.org/draft/2020-12/schema';
  readonly info: OpenApiInfo;
  readonly servers?: readonly OpenApiServer[];
  readonly paths: { readonly [path: string]: OpenApiPathItem };
  readonly components?: { readonly securitySchemes: { readonly [name: string]: SecurityScheme } };
}
```

| Field               | Summary                                        |
| ------------------- | ---------------------------------------------- |
| `openapi`           | The OpenAPI version.                           |
| `jsonSchemaDialect` | The dialect of every schema in the document.   |
| `info`              | The document's title, version and description. |
| `servers`           | The servers the API is served from.            |
| `paths`             | The operations, by path template.              |
| `components`        | The security schemes the operations name.      |

Source: `packages/openapi/src/openapi/types.ts:260`

## OpenApiInfo

The document's title, version and description.

```ts
export interface OpenApiInfo {
  readonly title: string;
  readonly version: string;
  readonly description?: string;
}
```

| Field         | Summary                                                               |
| ------------- | --------------------------------------------------------------------- |
| `title`       | The API's title; it must not be blank.                                |
| `version`     | The API's version, as the application names it; it must not be blank. |
| `description` | A description of the API.                                             |

Source: `packages/openapi/src/openapi/types.ts:8`

## OpenApiMediaType

A media type's content: the schema of its value.

```ts
export interface OpenApiMediaType {
  readonly schema: OpenApiSchema;
}
```

| Field    | Summary                  |
| -------- | ------------------------ |
| `schema` | The schema of the value. |

Source: `packages/openapi/src/openapi/types.ts:146`

## OpenApiOperation

One operation: one route's method on its path.

```ts
export interface OpenApiOperation {
  readonly operationId: string;
  readonly summary?: string;
  readonly description?: string;
  readonly tags?: readonly string[];
  readonly deprecated?: boolean;
  readonly parameters?: readonly OpenApiParameter[];
  readonly requestBody?: OpenApiRequestBody;
  readonly responses: { readonly [status: string]: OpenApiResponse };
  readonly security: readonly SecurityRequirement[];
  readonly 'x-skeld-parameterConstraints'?: {
    /** The path parameters' constraint. */
    readonly params?: OpenApiParameterConstraint;
    /** The query's constraint. */
    readonly query?: OpenApiParameterConstraint;
    /** The headers' constraint. */
    readonly headers?: OpenApiParameterConstraint;
    /** The cookies' constraint. */
    readonly cookies?: OpenApiParameterConstraint;
  };
}
```

| Field                          | Summary                                                                                  |
| ------------------------------ | ---------------------------------------------------------------------------------------- |
| `operationId`                  | The operation ID: the supplied one or the route's name.                                  |
| `summary`                      | A one-line summary of the operation.                                                     |
| `description`                  | A description of the operation.                                                          |
| `tags`                         | The operation's tags, in the order given.                                                |
| `deprecated`                   | Marks the operation deprecated.                                                          |
| `parameters`                   | The route's path, query, header and cookie parameters.                                   |
| `requestBody`                  | The request body, when the route declares one.                                           |
| `responses`                    | The declared responses, by status.                                                       |
| `security`                     | The alternatives that admit a caller; empty for a public route.                          |
| `x-skeld-parameterConstraints` | Minimum counts of declared properties on the route's parameter objects, by request part. |

Source: `packages/openapi/src/openapi/types.ts:213`

## OpenApiOptions

The options of createOpenApi: the document's info, servers, per-route documentation and security schemes.

Every key of `routes` is a route of the contract; an unknown field or a value of the wrong type is refused.

```ts
export interface OpenApiOptions<C extends ContractRoutes> {
  readonly info: OpenApiInfo;
  readonly servers?: readonly OpenApiServer[];
  readonly routes?: { readonly [K in keyof C]?: RouteDocumentation };
  readonly securitySchemes?: { readonly [name: string]: SecurityScheme };
}
```

| Field             | Summary                                                             |
| ----------------- | ------------------------------------------------------------------- |
| `info`            | The document's title, version and description.                      |
| `servers`         | The servers the API is served from; omitted by default.             |
| `routes`          | The documentation of each route, by route name.                     |
| `securitySchemes` | The security schemes the routes' requirements name, by scheme name. |

Source: `packages/openapi/src/openapi/types.ts:89`

## OpenApiParameter

A request parameter: a path, query or header value described by a schema, or a raw cookie described as text.

A cookie's logical value schema is in `x-skeld-valueSchema`; core's strict text grammar decides what parses.

```ts
export type OpenApiParameter =
  | {
      readonly name: string;
      readonly in: 'path' | 'query' | 'header';
      readonly required: boolean;
      readonly style: 'simple' | 'form';
      readonly explode?: boolean;
      readonly schema: OpenApiSchema;
    }
  | {
      readonly name: string;
      readonly in: 'cookie';
      readonly required: boolean;
      readonly content: { readonly 'text/plain': OpenApiMediaType };
      readonly 'x-skeld-valueSchema': OpenApiSchema;
    };
```

| Field                 | Summary                                                                         |
| --------------------- | ------------------------------------------------------------------------------- |
| `name`                | The parameter's name.                                                           |
| `in`                  | Where the parameter is sent.                                                    |
| `required`            | Whether the parameter must be sent; a path parameter always is.                 |
| `style`               | How the value is serialized: `simple` for a path or header, `form` for a query. |
| `explode`             | Whether an array is sent as repeated values; true for a query parameter.        |
| `schema`              | The schema of the parameter's logical value.                                    |
| `content`             | The cookie's raw value, as text.                                                |
| `x-skeld-valueSchema` | The schema of the cookie's logical scalar value.                                |

Source: `packages/openapi/src/openapi/types.ts:155`

## OpenApiParameterConstraint

A collective constraint on a parameter object that independent OpenAPI parameters cannot express.

```ts
export interface OpenApiParameterConstraint {
  readonly minDeclaredProperties: number;
  readonly properties: readonly string[];
}
```

| Field                   | Summary                                              |
| ----------------------- | ---------------------------------------------------- |
| `minDeclaredProperties` | The fewest of the listed properties a request sends. |
| `properties`            | The parameter object's declared properties.          |

Source: `packages/openapi/src/openapi/types.ts:205`

## OpenApiPathItem

The operations of one path, by lower-case method; only declared methods appear.

```ts
export interface OpenApiPathItem {
  readonly get?: OpenApiOperation;
  readonly put?: OpenApiOperation;
  readonly post?: OpenApiOperation;
  readonly delete?: OpenApiOperation;
  readonly patch?: OpenApiOperation;
}
```

| Field    | Summary               |
| -------- | --------------------- |
| `get`    | The GET operation.    |
| `put`    | The PUT operation.    |
| `post`   | The POST operation.   |
| `delete` | The DELETE operation. |
| `patch`  | The PATCH operation.  |

Source: `packages/openapi/src/openapi/types.ts:246`

## OpenApiRequestBody

A request body: JSON, and plain text when the body accepts a string.

```ts
export interface OpenApiRequestBody {
  readonly required: boolean;
  readonly content: {
    /** The JSON body. */
    readonly 'application/json': OpenApiMediaType;
    /** The plain-text body, present only when the body accepts a string. */
    readonly 'text/plain'?: OpenApiMediaType;
  };
}
```

| Field      | Summary                                                                                                      |
| ---------- | ------------------------------------------------------------------------------------------------------------ |
| `required` | Whether a body must be sent: always true, as core refuses a request without one, even for an outer optional. |
| `content`  | The body's media types.                                                                                      |

Source: `packages/openapi/src/openapi/types.ts:184`

## OpenApiResponse

One declared response: its description and, unless it has no body, its JSON content.

```ts
export interface OpenApiResponse {
  readonly description: string;
  readonly content?: { readonly 'application/json': OpenApiMediaType };
}
```

| Field         | Summary                                              |
| ------------- | ---------------------------------------------------- |
| `description` | The supplied description, or `Response <status>`.    |
| `content`     | The JSON body; absent for a response without a body. |

Source: `packages/openapi/src/openapi/types.ts:197`

## OpenApiResult

A generated document and its diagnostics, sorted by location then code; fresh data no later call shares.

```ts
export interface OpenApiResult {
  readonly document: OpenApiDocument;
  readonly diagnostics: readonly OpenApiDiagnostic[];
}
```

| Field         | Summary                                                                                |
| ------------- | -------------------------------------------------------------------------------------- |
| `document`    | The OpenAPI document.                                                                  |
| `diagnostics` | What the document describes more weakly than core enforces, with each case's location. |

Source: `packages/openapi/src/openapi/types.ts:294`

## OpenApiSchema

A JSON Schema 2020-12 node as the document emits it, with Skeld's `x-skeld-` extensions.

String length bounds count UTF-16 code units and appear only as extensions, never as `minLength` or `maxLength`.

```ts
export interface OpenApiSchema {
  readonly type?: 'string' | 'integer' | 'number' | 'boolean' | 'null' | 'object' | 'array';
  readonly const?: LiteralValue;
  readonly minimum?: number;
  readonly maximum?: number;
  readonly 'x-skeld-minLengthUtf16'?: number;
  readonly 'x-skeld-maxLengthUtf16'?: number;
  readonly properties?: { readonly [name: string]: OpenApiSchema };
  readonly required?: readonly string[];
  readonly additionalProperties?: boolean | OpenApiSchema;
  readonly minProperties?: number;
  readonly 'x-skeld-minDeclaredProperties'?: number;
  readonly maxProperties?: number;
  readonly propertyNames?: OpenApiSchema;
  readonly items?: OpenApiSchema;
  readonly minItems?: number;
  readonly maxItems?: number;
  readonly anyOf?: readonly OpenApiSchema[];
  readonly writeOnly?: true;
  readonly 'x-sensitivity'?: Sensitivity;
}
```

| Field                           | Summary                                                                                    |
| ------------------------------- | ------------------------------------------------------------------------------------------ |
| `type`                          | The JSON type the value has.                                                               |
| `const`                         | The one value a literal accepts.                                                           |
| `minimum`                       | The smallest number accepted.                                                              |
| `maximum`                       | The largest number accepted.                                                               |
| `x-skeld-minLengthUtf16`        | The fewest UTF-16 code units a string holds.                                               |
| `x-skeld-maxLengthUtf16`        | The most UTF-16 code units a string holds.                                                 |
| `properties`                    | An object's declared properties, by name.                                                  |
| `required`                      | The properties an object must have.                                                        |
| `additionalProperties`          | Whether an object may hold undeclared properties, or the schema of a record's values.      |
| `minProperties`                 | The fewest properties an object holds.                                                     |
| `x-skeld-minDeclaredProperties` | The fewest declared properties an open request object holds; undeclared ones do not count. |
| `maxProperties`                 | The most properties a record holds.                                                        |
| `propertyNames`                 | The schema of a record's keys.                                                             |
| `items`                         | The schema of an array's items.                                                            |
| `minItems`                      | The fewest items an array holds.                                                           |
| `maxItems`                      | The most items an array holds.                                                             |
| `anyOf`                         | The members of a union, in declaration order; a value matches at least one.                |
| `writeOnly`                     | Marks a secret request value that a response never returns.                                |
| `x-sensitivity`                 | The sensitivity class the contract declares for the value.                                 |

Source: `packages/openapi/src/openapi/types.ts:104`

## OpenApiServer

A server the API is served from.

```ts
export interface OpenApiServer {
  readonly url: string;
  readonly description?: string;
}
```

| Field         | Summary                                                                                               |
| ------------- | ----------------------------------------------------------------------------------------------------- |
| `url`         | An absolute `http` or `https` URL, or a path from the root; no credentials, fragment or `{` template. |
| `description` | A description of the server.                                                                          |

Source: `packages/openapi/src/openapi/types.ts:18`

## RouteDocumentation

The documentation of one route: its summary, tags, operation ID, response descriptions and security.

```ts
export interface RouteDocumentation {
  readonly summary?: string;
  readonly description?: string;
  readonly tags?: readonly string[];
  readonly operationId?: string;
  readonly deprecated?: boolean;
  readonly responses?: { readonly [status: number]: string };
  readonly security?: readonly SecurityRequirement[];
}
```

| Field         | Summary                                                                                                 |
| ------------- | ------------------------------------------------------------------------------------------------------- |
| `summary`     | A one-line summary of the operation.                                                                    |
| `description` | A description of the operation.                                                                         |
| `tags`        | The operation's tags, in the order given.                                                               |
| `operationId` | The operation ID; the default is the route's name. IDs are nonempty and unique across the document.     |
| `deprecated`  | Marks the operation deprecated.                                                                         |
| `responses`   | Descriptions of the route's declared statuses; a status the route does not declare is refused.          |
| `security`    | The alternatives that admit a caller, any one of which suffices; it must agree with the route's access. |

Source: `packages/openapi/src/openapi/types.ts:68`

## SecurityRequirement

One alternative of a route's security: each named scheme with the scopes it needs, all required together.

An empty object admits an anonymous caller; bearer and API-key schemes take no scopes.

```ts
export interface SecurityRequirement {
  readonly [scheme: string]: readonly string[];
}
```

Source: `packages/openapi/src/openapi/types.ts:29`

## SecurityScheme

A security scheme the document defines: an HTTP bearer token, an API key or an OpenID Connect provider.

Names match `[A-Za-z0-9._-]+`; an OpenID Connect URL is absolute `https` with no credentials or fragment.

```ts
export type SecurityScheme =
  | {
      readonly type: 'http';
      readonly scheme: 'bearer';
      readonly bearerFormat?: string;
      readonly description?: string;
    }
  | {
      readonly type: 'apiKey';
      readonly in: 'header' | 'query' | 'cookie';
      readonly name: string;
      readonly description?: string;
    }
  | {
      readonly type: 'openIdConnect';
      readonly openIdConnectUrl: string;
      readonly description?: string;
    };
```

| Field              | Summary                                                                   |
| ------------------ | ------------------------------------------------------------------------- |
| `type`             | An HTTP authentication scheme.                                            |
| `scheme`           | The bearer scheme, the only one supported.                                |
| `bearerFormat`     | A hint of the token's format, such as `JWT`.                              |
| `description`      | A description of the scheme.                                              |
| `in`               | Where the key is sent.                                                    |
| `name`             | The header, parameter or cookie name, valid for where it is sent.         |
| `openIdConnectUrl` | The provider's discovery URL, copied into the document and never fetched. |

Source: `packages/openapi/src/openapi/types.ts:37`

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

## createOpenApi

Generates an OpenAPI 3.1.2 document and its diagnostics from a contract, offline and synchronously.

Throws `OpenApiError` for a refused contract, metadata, path, schema or security; nothing is written or fetched.

```ts
export function createOpenApi<const C extends ContractRoutes>(contract: C, options: OpenApiOptions<C>): OpenApiResult;
```

```ts
createOpenApi({}, { info: { title: 'Notes API', version: '1.0.0' } });
```

Source: `packages/openapi/src/openapi/openapi.ts:74`
