# Publish an OpenAPI document

`@skeld/openapi` turns a contract into an OpenAPI 3.1.2 document. A declaration it cannot describe, such as a wildcard path or an unexposed secret in a response, is [refused with a located error](#when-generation-refuses), and no partial document is returned. Where OpenAPI has no keyword for a rule core enforces, such as string lengths counted in UTF-16 code units, the document carries an `x-skeld-` extension and the result a [located diagnostic](#what-the-document-cannot-say). Each route's [security alternatives](#describe-security) are checked against its declared access, every scheme they name must be defined and each scope list must fit its scheme; whether they match the auth configuration your server runs is not checked. Generation is offline and synchronous: `createOpenApi` reads the contract and the documentation you pass, returns the document with its diagnostics, and reads no file, environment variable or network. Writing or serving the result is your code's choice.

```sh
npm install @skeld/openapi
```

It needs Node 26.12 or later and `@skeld/core` `^0.4.0` as a peer dependency, and depends on nothing else. Exact signatures are in the [OpenAPI API reference](../api/openapi/openapi.md); every rule and refusal is in the [OpenAPI behavior reference](../reference/openapi.md).

## Generate a document

Pass the contract and at least a title and a version:

```ts
import { defineContract } from '@skeld/core/contract';
import * as t from '@skeld/core/schema';
import { createOpenApi } from '@skeld/openapi';

const contract = defineContract({
  getTask: {
    method: 'GET',
    path: '/tasks/:id',
    params: t.object({ id: t.integer({ minimum: 1 }) }),
    responses: { 200: t.object({ id: t.integer(), title: t.string({ maxLength: 120 }) }), 404: null },
  },
});

const { document, diagnostics } = createOpenApi(contract, {
  info: { title: 'Tasks', version: '1.0.0' },
  routes: { getTask: { summary: 'Read a task', responses: { 404: 'No such task' } } },
});

process.stdout.write(`${JSON.stringify(document, null, 2)}\n`);
for (const { code, location } of diagnostics) {
  process.stderr.write(`${code} ${location.join('.')}\n`);
}
```

The operation it prints, shortened:

```json
"/tasks/{id}": {
  "get": {
    "operationId": "getTask",
    "summary": "Read a task",
    "parameters": [
      { "name": "id", "in": "path", "required": true, "style": "simple", "schema": { "type": "integer", "minimum": 1 } }
    ],
    "responses": {
      "200": {
        "description": "Response 200",
        "content": {
          "application/json": {
            "schema": {
              "type": "object",
              "properties": { "id": { "type": "integer" }, "title": { "type": "string", "x-skeld-maxLengthUtf16": 120 } },
              "required": ["id", "title"],
              "additionalProperties": false
            }
          }
        }
      },
      "404": { "description": "No such task" }
    },
    "security": []
  }
}
```

And on standard error:

```text
TEXT_PARAMETER getTask.params.properties.id
UTF16_LENGTH getTask.responses.200.properties.title
```

The route name is the default operation ID, and a status without a supplied description gets `Response <status>`. The same input always gives the same JSON: paths, methods and every map are sorted, and lists with a meaning in their order (union members, tags, security alternatives) keep it. Each call returns fresh objects, so changing a result never changes your contract or a later result.

The [`examples/openapi`](../../examples/openapi/README.md) folder is a complete script with sessions and API keys.

## Choose what to publish

The document describes the contract you pass, nothing more. It does not know which routes a server mounts, so a route you serve but leave out of the contract is missing from the document, and the library cannot tell. Build the object you want published (for example by spreading several contracts into one) and pass that; when two contracts share a route name, the later one replaces the earlier one before `createOpenApi` sees it.

Only what the contract declares appears:

- the declared methods: no `HEAD` or `OPTIONS` operation, although core answers `HEAD` from the `GET` route;
- the declared statuses: no engine error (400 validation, 404, 413 and the rest) and no response a hook writes. Declare `errorBodySchema` from `@skeld/core/contract` on the statuses you want documented.

There is no option to hide a route. Pass a contract without it.

## Describe security

A contract names a route's access (`'public'`, `'optional'` or a policy and action) but not the credentials your auth configuration reads. You describe those: security schemes under `securitySchemes`, and per route a list of alternatives under `routes.<name>.security`.

- One requirement object lists schemes that are all needed together (AND).
- The list holds alternatives; any one admits the caller (OR).
- An empty object `{}` is an anonymous alternative.

Generation checks the list against the route's access and refuses `INVALID_SECURITY` when they disagree:

| Access               | Security you supply                                       | Emitted        |
| -------------------- | --------------------------------------------------------- | -------------- |
| absent or `'public'` | nothing or `[]`; any credential alternative is refused    | `security: []` |
| `'optional'`         | at least one `{}` and at least one credential alternative | your list      |
| a policy and action  | at least one alternative and no `{}`                      | your list      |

Three scheme shapes are supported: an HTTP bearer token, an API key in a header, query parameter or cookie, and an OpenID Connect discovery URL, which is copied and never fetched. Bearer and API-key requirements take no scopes; an OpenID Connect requirement takes a list of distinct, nonempty scopes, possibly empty. Policy and action names never become scopes.

A route that accepts a session for an unsafe method needs the session cookie and the CSRF header together, as one alternative. Name them with the values your auth configuration uses, so the document cannot drift from them:

```ts
import { apiKeys } from '@skeld/auth/api-key';
import { definePolicy } from '@skeld/auth/policy';
import { createAuth } from '@skeld/auth/server';
import { createSqliteStore } from '@skeld/auth/sqlite';
import { defineContract } from '@skeld/core/contract';
import { CSRF_TOKEN_HEADER } from '@skeld/core/gate';
import * as t from '@skeld/core/schema';
import { createOpenApi } from '@skeld/openapi';

const SESSION_COOKIE = '__Host-tasks';

const tasks = definePolicy('tasks', { credentials: ['session', 'api_key'], actions: { write: () => true } });

export const auth = createAuth({
  store: createSqliteStore({ path: ':memory:' }),
  origin: 'https://tasks.example.com',
  policies: [tasks],
  session: { cookieName: SESSION_COOKIE },
  apiKeys: apiKeys(),
});

const contract = defineContract({
  renameTask: {
    method: 'PUT',
    path: '/tasks/:id',
    access: { policy: 'tasks', action: 'write' },
    params: t.object({ id: t.integer({ minimum: 1 }) }),
    body: t.object({ title: t.string({ maxLength: 120 }) }),
    responses: { 204: null },
  },
});

export const { document } = createOpenApi(contract, {
  info: { title: 'Tasks', version: '1.0.0' },
  securitySchemes: {
    session: { type: 'apiKey', in: 'cookie', name: SESSION_COOKIE },
    csrf: { type: 'apiKey', in: 'header', name: CSRF_TOKEN_HEADER },
    apiKey: { type: 'http', scheme: 'bearer' },
  },
  routes: { renameTask: { security: [{ session: [], csrf: [] }, { apiKey: [] }] } },
});
```

The checks catch missing and contradictory metadata. They cannot see your auth configuration: a scheme you leave out, a wrong cookie name or a credential the policy does not accept goes into the document as written. Keeping the two in agreement is your code's job; reading the names from the same constants, as above, is the simplest way.

## What the document describes

The document targets OpenAPI 3.1.2 with the JSON Schema 2020-12 dialect (`jsonSchemaDialect`). Every schema is written inline where it is used, so one model can read differently in a request and a response; there is no `components.schemas`.

- **Paths.** `:id` becomes `{id}`. A wildcard `*` or a literal `{` or `}` in a path is refused (`UNSUPPORTED_PATH`): an OpenAPI parameter matches one segment.
- **Parameters.** Path and header parameters use `style: simple`; query parameters use `style: form` and `explode: true`. A path parameter is always required; the others are required unless declared optional.
- **Bodies.** A declared body is described as `application/json`. It also gets `text/plain` with only its string and string-literal branches, and none when it has no string branch.
- **Responses.** A schema gives `application/json` content. A `null` entry, and 204 and 304, give a description only. `t.null()` is a JSON `null` body, not the absence of one.
- **Objects.** In a request, an open object (`open`) has `additionalProperties: true`. In a response every object has `additionalProperties: false`, because core writes declared keys only.
- **Data classes.** A schema marked `sensitivity` keeps `x-sensitivity`. A request secret also gets `writeOnly: true`. A response secret must be inside `t.exposed`, or generation refuses `INVALID_SCHEMA`; it is described without `writeOnly`.

### Request facts that may surprise a client author

- **A declared body is always required.** `requestBody.required` is `true` even for `t.optional(...)`: core answers 400 `/body is required` to a request with no body on a route that declares one. The outer optional is unwrapped for the schema.
- **Query arrays repeat the key.** `?tag=a&tag=b` sends two items, and a single `?tag=a` arrives as a one-item array. An empty array cannot be sent: it is the same request as leaving the key out.
- **Cookies are raw text.** A cookie is described with `content: text/plain` and its declared schema under `x-skeld-valueSchema`. Core does not percent-decode cookie values.
- **Text parameters are converted by core's own grammar.** A number, boolean or such a literal in a path, query, header or cookie value is described by its logical schema; core decides which text converts.

## What the document cannot say

Some constraints core enforces have no standard OpenAPI or JSON Schema keyword. Generation then writes a `x-skeld-` extension, or omits the parameter, and adds a diagnostic with the location of the case. A tool that ignores the extensions validates less than core does; it never validates more. Use the document to describe the API, and core to enforce it.

| Diagnostic                    | When                                                                                                                       | What the document writes                                                                                            | What a standard-only tool misses                                                                                                               |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `UTF16_LENGTH`                | A string has `minLength` or `maxLength`, also a record key                                                                 | `x-skeld-minLengthUtf16`, `x-skeld-maxLengthUtf16`; never `minLength` or `maxLength`                                | Every length bound: core counts UTF-16 code units, JSON Schema counts characters, so the standard keywords would disagree on astral characters |
| `DECLARED_PROPERTY_COUNT`     | An open request object has `minProperties`                                                                                 | `x-skeld-minDeclaredProperties` instead of `minProperties`                                                          | The minimum: undeclared keys do not count toward it in core                                                                                    |
| `TEXT_PARAMETER`              | A path, query, header or cookie value that core converts from text (a number, boolean or such a literal), and every cookie | The logical schema; for a cookie, `content: text/plain` and `x-skeld-valueSchema`                                   | Core's strict text grammar: which spellings convert, and which union member is tried first                                                     |
| `PARAMETER_OBJECT_CONSTRAINT` | A `params`, `query`, `headers` or `cookies` object has `minProperties`                                                     | `x-skeld-parameterConstraints` on the operation, keyed by part: `minDeclaredProperties` and the part's `properties` | The minimum count of parameters sent                                                                                                           |
| `RESERVED_HEADER`             | A declared `accept`, `content-type` or `authorization` header                                                              | Nothing: the parameter is left out, as OpenAPI ignores these headers                                                | The header's declared schema; media types and security schemes describe these headers                                                          |

Each diagnostic is `{ code, location, message }`. The location starts at the route name, then the part (`params`, `query`, `headers`, `cookies`, `body`, `responses` and the status), then schema steps (`properties` and a key, `items`, `anyOf` and an index, `propertyNames`, `additionalProperties`). Diagnostics are sorted by location, then code, each pair once. They are returned, never logged.

The extension keywords in one place:

| Keyword                                            | On                           | Holds                                             |
| -------------------------------------------------- | ---------------------------- | ------------------------------------------------- |
| `x-skeld-minLengthUtf16`, `x-skeld-maxLengthUtf16` | string schemas               | The bound in UTF-16 code units                    |
| `x-skeld-minDeclaredProperties`                    | open request object schemas  | The fewest declared properties present            |
| `x-skeld-valueSchema`                              | cookie parameters            | The cookie's logical scalar schema                |
| `x-skeld-parameterConstraints`                     | operations                   | Per part, `{ minDeclaredProperties, properties }` |
| `x-sensitivity`                                    | any schema with a data class | `secret` or `personal`                            |

## Keep private text out

The reasons you give core (`open`, `unbounded`, the reason of `t.exposed`) explain decisions to readers of your code; they never enter the document. Descriptions, summaries, tags, server URLs and literal values do: they are public text you wrote, and the library cannot tell a secret typed into them. It generates no example values.

## When generation refuses

A refused call throws `OpenApiError` from `@skeld/openapi/openapi-error` and returns no partial document. The error has a fixed `message` per `code` and a `location`; it never repeats a value you passed or a message it caught. Contract errors are located from the route name, metadata errors from the option key:

```ts
import { createOpenApi } from '@skeld/openapi';
import { OpenApiError } from '@skeld/openapi/openapi-error';

try {
  createOpenApi({}, { info: { title: ' ', version: '1.0.0' } });
} catch (error) {
  if (error instanceof OpenApiError) {
    process.stderr.write(`${error.code} ${error.location.join('.')}: ${error.message}\n`);
  }
}
```

This prints `INVALID_METADATA info.title: Invalid documentation metadata`. The [behavior reference](../reference/openapi.md#errors) lists every code and the fixed work limits.

**Next:** run the [OpenAPI example](../../examples/openapi/README.md). Reference: [OpenAPI behavior](../reference/openapi.md) and the [OpenAPI API](../api/openapi/openapi.md).
