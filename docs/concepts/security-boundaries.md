# Security boundaries

skeld moves recurring boundary checks into the framework so that routes use consistent behavior. Its useful security claim is a set of named mechanisms with defined limits. It does not establish that an application is secure simply because it starts successfully.

For the underlying analysis, read the [core threat model](threat-model.md): its STRIDE register ties each threat to a boundary, treatment and verification evidence.

## What the framework enforces

| Boundary          | Built-in behavior                                                                           | What it does not establish                                                                                         |
| ----------------- | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Request shape     | Schema validation before normal handlers; closed body objects refuse undeclared keys        | The caller's identity, permission, or business entitlement                                                         |
| Request size      | Configured and schema-derived byte caps; bounded schema collections; JSON nesting limit     | A bound on total connections, retained state, database work, or request rate                                       |
| Response shape    | Declared-status serialization; ordinary object projection; mismatch becomes an engine error | Authorization to disclose every field you deliberately declared; raw hook replies need separate review             |
| Secret values     | `Secret` wrappers, redaction, and explicit response exposure                                | Protection after an author deliberately extracts and copies a raw value                                            |
| Personal values   | Redaction when paired with their schema                                                     | Automatic tracking of personal strings in arbitrary messages or scalar fields                                      |
| Failure responses | Fixed public body for arbitrary internal errors; validation messages omit rejected values   | Safe content in author-written `HttpError` messages or custom responses                                            |
| Browser requests  | Cross-site checks before application hooks; explicit CORS grants                            | Authentication; non-browser callers can choose their own origin headers                                            |
| Redirects         | Final 3xx destinations checked against local-path rules and exact allowed origins           | Authorization of the operation at that destination, or a check of 201 `Location`                                   |
| Cookies           | Conservative output defaults, prefix rules, bounds, duplicate-name handling                 | Sessions, signatures, encryption, or user identity                                                                 |
| Response headers  | Default `nosniff`, frame restrictions, and `no-store` on engine-written responses           | A complete browser security policy; author overrides and Node's own parser-level responses have different behavior |
| Proxy addresses   | Forwarded addresses honored only through configured trusted peers                           | Identity or honesty of a trusted proxy; protection from a bad trust configuration                                  |
| Request lifetime  | Deadlines, signals, discarded late replies                                                  | Preemption of JavaScript or rollback of application side effects                                                   |
| Logs              | Bounded records and queues, classified projection, controlled error disclosure              | Guaranteed delivery, unlimited retention, or automatic redaction of author-exposed text                            |

For the exact options, use the [API reference](../api/README.md). For the order in which checks happen, use [the request lifecycle](request-lifecycle.md).

## Review the intentional escape paths

Some applications need an unbounded schema field, an open object, an explicitly exposed secret response, or a raw early reply. Making the choice explicit helps review; it does not make the choice harmless.

For each exception, identify the data it admits or exposes, the caller allowed to use it, and the remaining limit. Prefer a narrow route or schema over a broad policy change. In particular, `open` accepts and drops unknown request fields, while `unbounded` removes a schema bound; neither supplies authorization or a resource budget.

## Keep the application boundary separate

The service still owns authentication, authorization, tenant isolation, database queries, output use in other contexts, durable storage, and abuse controls. A validated string is not automatically safe to concatenate into SQL, a shell command, or HTML. Use the receiving system's appropriate API and escaping rules.

Authorization must follow the resource being accessed. A valid task ID establishes the ID's shape; it does not establish that the current user owns that task. Likewise, a request ID is useful for correlation and useless as an access credential.

## Read evidence at its actual scope

The repository's [tests](../../tests/README.md) group regression checks by behavior, including adversarial input, browser boundaries, lifecycle, and logging. They provide concrete evidence for the cases they exercise. They do not prove the absence of all defects or cover your application's deployment and business rules.

The [examples](../../examples/README.md) demonstrate public APIs without accounts or external services. They intentionally have no authentication or durable storage. Use them to learn the framework, then add and test your application's own boundaries.
