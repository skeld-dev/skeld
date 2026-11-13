# Core API

The Core module is distributed as `@skeld/core`. Its public API is organized into entry points, such as `@skeld/core/server`. Import from these subpaths; there is no `@skeld/core` root export.

| Entry point                        | Use it for                                                           |
| ---------------------------------- | -------------------------------------------------------------------- |
| [contract](core/contract.md)       | Route declarations, request and reply types, shared error bodies     |
| [schema](core/schema.md)           | Bounded schemas, composition, inferred types, sensitivity            |
| [server](core/server.md)           | Servers, plugins, hooks, cookies, origin policies, lifecycle options |
| [client](core/client.md)           | Typed calls and validated replies                                    |
| [http-error](core/http-error.md)   | HTTP failures and client-side call failures                          |
| [boot-error](core/boot-error.md)   | Startup and configuration failures                                   |
| [secret](core/secret.md)           | Wrapped secret values and explicit exposure                          |
| [redact](core/redact.md)           | Schema-aware redacted copies                                         |
| [log](core/log.md)                 | Author loggers, classified fields, options, delivery statistics      |
| [redirect](core/redirect.md)       | Checking redirect destinations                                       |
| [json-schema](core/json-schema.md) | Exporting JSON Schema 2020-12                                        |

The pages in `core/` are generated. Change the public source documentation and run `npm run api-docs`; do not edit those pages by hand. For a learning path, start at the [documentation home](../README.md).
