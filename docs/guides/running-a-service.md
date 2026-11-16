# Run a service

skeld's server runs on `node:http` and requires Node 26.12 or later. This repository pins its development version in [`.nvmrc`](../../.nvmrc). The server compiles validators and serializers at `listen()`, so a runtime that prohibits code generation from strings cannot start it.

A documentation website hosted on a Cloudflare Worker would be a separate application. It would not make the skeld server compatible with the Workers runtime.

## Set the network boundary deliberately

`listen()` defaults to loopback. Set an explicit host when a container network or another machine must reach the process, and configure the network so only intended callers or proxies can reach it.

Behind a reverse proxy, these settings answer different questions:

| Setting                  | Question it answers                                                |
| ------------------------ | ------------------------------------------------------------------ |
| `listen({ host, port })` | Where does this process accept connections?                        |
| `publicOrigin`           | Which public origin does the browser use for this service?         |
| `trustProxy`             | Which peer addresses may supply a forwarded client-address chain?  |
| `cors` and `csrf`        | Which browser origins receive grants or pass the cross-site check? |

Without `trustProxy`, `request.clientAddress` is the socket peer. With trusted peers, skeld walks `X-Forwarded-For` from right to left and stops at the first untrusted address. Trust only your actual proxy addresses or ranges and control direct access to the origin. A forwarded address is still not user identity. See [the exact walk and refusal rules](../../docs/reference/core.md#timeouts-client-address-and-headers).

## Budget time at each layer

| Option                 | Default    | Scope                                                            |
| ---------------------- | ---------- | ---------------------------------------------------------------- |
| `headersTimeout`       | 60,000 ms  | Node receiving request headers                                   |
| `requestTimeout`       | 300,000 ms | Node receiving the request                                       |
| `handlerTimeoutMs`     | 30,000 ms  | Route match through hooks, body read, handler, and response work |
| `pluginTimeoutMs`      | 10,000 ms  | A plugin's startup work                                          |
| `closeTimeoutMs`       | 10,000 ms  | HTTP shutdown/draining                                           |
| `pluginCloseTimeoutMs` | 10,000 ms  | Each registered resource disposer                                |
| `log.flushTimeoutMs`   | 1,000 ms   | Final log flush                                                  |

These are distinct budgets, not interchangeable names for one deadline. A handler timeout returns HTTP 503 `TIMEOUT`, aborts the request signal, and discards a later result. Pass the signal to downstream work that supports cancellation. It cannot interrupt blocking JavaScript or roll back a completed side effect.

Choose downstream, service, and proxy timeouts together so the application has time to finish or report a failure before an outer layer gives up. Include cleanup callbacks when setting the process supervisor's termination grace period: each has its own deadline, so total cleanup can exceed one `pluginCloseTimeoutMs` interval.

## Decide which records you need

Default logging writes boot, engine errors, and security refusals, plus author records at enabled levels. Enable `log: { access: true }` when each covered request needs a terminal access record. Keep incidental console output off the same stdout pipe if a collector expects intact JSON lines.

Monitor `server.logStats()` through a path that does not depend on a working log destination. The queue is bounded and records can be dropped. A sink that never settles stops its own delivery; a successful write says nothing about whether an external collector retained the data. See [logging guarantees and risks](../logging/logging.md).

Error text, stack frames, custom error identifiers, client addresses, and inbound correlation each have disclosure implications. Enable only the fields your operation needs; [the error reference](../logging/errors.md) explains the defaults and opt-ins.

## Shut down through the server

The runnable examples handle SIGINT and SIGTERM and await `server.close()`. Follow that lifecycle instead of calling `process.exit()` as the first step: the server needs an opportunity to drain HTTP work, release plugin resources, and flush logs.

`close()` can reject when resource cleanup fails. Make that failure visible to the process supervisor. Do not assume the final `skeld.server.closed` record proves every log was delivered: it is a snapshot before the last flush. Post-close statistics distinguish queued drops from still-pending delivery.

## Keep application obligations visible

Before exposing a service, implement its authentication, authorization, durable storage rules, and any abuse controls it needs. [Add authentication](auth.md) covers what `@skeld/auth` supplies and what it leaves to the application. Verify origin and proxy behavior through the real deployment path, not only on loopback. Configure TLS and secret storage in that environment.

The hello, logging and service examples intentionally omit identity and persistent storage; `examples/auth` adds identity with temporary local stores. Passing their checks establishes that the examples work; it does not establish production readiness for your application. The [security boundary guide](../concepts/security-boundaries.md) separates framework behavior from those obligations.

**Next:** [troubleshoot a specific symptom](troubleshooting.md). Reference: [server options](../api/core/server.md).
