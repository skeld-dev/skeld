# @skeld/auth

Access control and authentication building blocks for Skeld services: route policies and grants, sessions with CSRF tokens, shared rate limits, API keys, JWT verification, OpenID Connect sign-in and Argon2id password helpers, over SQLite or PostgreSQL.

Your application keeps its users, credentials and identity mapping; auth enforces each route's declared access before the handler runs and calls back into your code for every decision about a user.

**Not released.** Version 0.2.0 is built and tested in this repository beside `@skeld/core`, its only dependency, and is not published to npm. Inside the repository a workspace package depends on it with `"@skeld/auth": "workspace:*"`. It needs Node 26.12 or later.

- [Add authentication to a service](../../docs/guides/auth.md): from the store to a working service.
- [The application's obligations](../../docs/guides/auth-obligations.md): what auth relies on your code to do.
- [Auth behavior reference](../../docs/reference/auth.md): options, routes, refusals, events and what is not included.
- [`examples/auth`](../../examples/auth/README.md): a runnable service with a walkthrough of every behavior.

[Website & documentation](https://skeld.dev) · [GitHub repository](https://github.com/skeld-dev/skeld)
