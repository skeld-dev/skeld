# skeld documentation

Build a service around one contract. Use it to validate incoming data, constrain outgoing data, and type the client that calls it.

If you are new to skeld, start with [Install skeld](guides/install.md): it takes you from `npm install @skeld/core` to a running server and a typed client call. Then follow [your first request](guides/first-request.md) in a checkout of the repository. You will run a larger example, send an invalid request, and see exactly where the contract takes effect. Neither needs an external service.

## Learn the model

```mermaid
flowchart TD
    Contract["Contract<br/>Routes and schemas"] -->|Defines| Client["Client<br/>Typed calls<br/>Validate replies"]
    Contract -->|Defines| Server["Server<br/>Validate input<br/>Serialize output"]
    Client -->|HTTP<br/>request| Server
    Server -->|HTTP<br/>response| Client
```

The contract supplies both sides. HTTP still crosses a trust boundary: server validation protects the handler, and client validation checks responses for declared statuses. Sharing TypeScript types alone would establish neither property.

Read these in order, or jump to the task you are working on:

| Guide                                                            | What you will be able to do                                                                                       |
| ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| [Install skeld](guides/install.md)                               | Add the package to a new project, run one route, and call it through its contract                                 |
| [Your first request](guides/first-request.md)                    | Run the hello service and distinguish validation from application behavior                                        |
| [Design a contract](guides/contracts.md)                         | Choose bounds, response fields, and explicit application outcomes                                                 |
| [Call a service and handle errors](guides/client-and-errors.md)  | Narrow responses by status and separate HTTP outcomes from failed calls                                           |
| [Organize a service](guides/plugins-and-lifecycle.md)            | Give a feature its own routes, hooks, state, and cleanup                                                          |
| [Classify data](guides/classification.md)                        | Keep secret and personal values out of schema-aware logs and control response exposure                            |
| [Connect a browser](guides/browser-security.md)                  | Configure CORS, cross-site checks, cookies, and redirects together                                                |
| [Run a service](guides/running-a-service.md)                     | Set the public origin, proxy trust, timeouts, logging, and shutdown behavior                                      |
| [Troubleshoot](guides/troubleshooting.md)                        | Diagnose startup failures, refused requests, missing logs, and invalid responses                                  |
| [Add authentication](guides/auth.md)                             | Declare route access, decide it with policies, and sign people in with sessions, API keys, JWTs or OpenID Connect |
| [Meet the application's obligations](guides/auth-obligations.md) | Sign people in, change credentials and keep grants in the order auth relies on                                    |

These explanations connect the guides: [the request lifecycle](concepts/request-lifecycle.md) shows when each stage runs; [security boundaries](concepts/security-boundaries.md) names what skeld enforces and what the application must supply. The [core threat model](concepts/threat-model.md) maps actors, data flows and trust boundaries to STRIDE threats, controls and residual responsibilities.

## Look up a detail

- [API reference](api/README.md): signatures and rules generated from the public source documentation.
- [Logging](logging/logging.md): options, delivery behavior, and limits; [record format](logging/record-format.md), [events](logging/events.md), [error disclosure](logging/errors.md), and [Collector ingestion](logging/collector.md).
- [Runnable examples](../examples/README.md): hello, classified logging, a scoped task service, and [authentication](../examples/auth/README.md).
- [Core behavior reference](reference/core.md): runtime requirements for each entry point and a compact feature reference.
- [Auth behavior reference](reference/auth.md): `@skeld/auth` options, routes, refusals, events, store outcomes, and what is not included. The package is not released yet.

To improve skeld or its documentation, see the repository's [contribution guide](../CONTRIBUTING.md).
