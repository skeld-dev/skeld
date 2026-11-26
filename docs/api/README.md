# API reference

skeld's packages publish their public API as entry points, such as `@skeld/core/server`. Import from these subpaths. Core, auth and data have no root export; `@skeld/openapi` has one, `@skeld/openapi` itself.

## Core API

`@skeld/core` is the framework.

| Entry point                        | Use it for                                                           |
| ---------------------------------- | -------------------------------------------------------------------- |
| [contract](core/contract.md)       | Route declarations, request and reply types, shared error bodies     |
| [schema](core/schema.md)           | Bounded schemas, composition, inferred types, sensitivity            |
| [server](core/server.md)           | Servers, plugins, hooks, cookies, origin policies, lifecycle options |
| [client](core/client.md)           | Typed calls and validated replies                                    |
| [http-error](core/http-error.md)   | HTTP failures and client-side call failures                          |
| [boot-error](core/boot-error.md)   | Startup and configuration failures                                   |
| [gate](core/gate.md)               | The access gate a server boots and binds, and its refusals           |
| [secret](core/secret.md)           | Wrapped secret values and explicit exposure                          |
| [redact](core/redact.md)           | Schema-aware redacted copies                                         |
| [log](core/log.md)                 | Author loggers, classified fields, options, delivery statistics      |
| [redirect](core/redirect.md)       | Checking redirect destinations                                       |
| [json-schema](core/json-schema.md) | Exporting JSON Schema 2020-12                                        |

## Auth API

`@skeld/auth` adds access control and authentication. Start with [Add authentication to a service](../guides/auth.md).

| Entry point                                    | Use it for                                                          |
| ---------------------------------------------- | ------------------------------------------------------------------- |
| [server](auth/server.md)                       | `createAuth`, its options, sessions, subjects, limits, access types |
| [policy](auth/policy.md)                       | Policies, grants, principals                                        |
| [routes](auth/routes.md)                       | The session and OIDC route sets and the session state schema        |
| [auth-error](auth/auth-error.md)               | The error of server-side calls and grant operations                 |
| [store](auth/store.md)                         | The store contract and `StoreFailure`                               |
| [sqlite](auth/sqlite.md)                       | The SQLite store                                                    |
| [postgres](auth/postgres.md)                   | The PostgreSQL store over your `pg` Pool                            |
| [store-conformance](auth/store-conformance.md) | The conformance kit for a store                                     |
| [api-key](auth/api-key.md)                     | The API-key part and its administration calls                       |
| [jwt](auth/jwt.md)                             | JWT verification                                                    |
| [oidc](auth/oidc.md)                           | OpenID Connect sign-in                                              |
| [password](auth/password.md)                   | Argon2id hashing and verification helpers                           |

## OpenAPI API

`@skeld/openapi` generates OpenAPI documents from a contract. Start with [Publish an OpenAPI document](../guides/openapi.md).

| Entry point                               | Use it for                                                      |
| ----------------------------------------- | --------------------------------------------------------------- |
| [openapi](openapi/openapi.md)             | `createOpenApi`, its options, its result and the document types |
| [openapi-error](openapi/openapi-error.md) | The error a refused generation throws                           |

## Data API

`@skeld/data` connects a service to PostgreSQL or SQLite. Start with [Store data in PostgreSQL or SQLite](../guides/data.md).

| Entry point                      | Use it for                                                                   |
| -------------------------------- | ---------------------------------------------------------------------------- |
| [sql](data/sql.md)               | The `sql` template tag, quoted identifiers and the parameter types           |
| [postgres](data/postgres.md)     | `createPostgresDatabase` and its options                                     |
| [sqlite](data/sqlite.md)         | `createSqliteDatabase` and its options                                       |
| [database](data/database.md)     | The database, owner, query, transaction and reserved-connection types        |
| [data-error](data/data-error.md) | `DataError`, its codes and `exposeDetail`                                    |
| [pg-pool](data/pg-pool.md)       | `toPgPool`, which runs `@skeld/auth`'s PostgreSQL store on a database's pool |
| [limit](data/limit.md)           | `limitRoutes`, `installLimitTable` and the limiter's options                 |

The pages in `core/`, `auth/`, `openapi/` and `data/` are generated. Change the public source documentation and run `pnpm run api-docs`; do not edit those pages by hand. For a learning path, start at the [documentation home](../README.md).
