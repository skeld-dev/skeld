# Connect a browser

A browser frontend introduces several separate decisions: which origins may read responses, which cross-site requests may reach handlers, which cookies it sends, and where redirects may lead. Configure each for its own purpose.

This example assumes an API at `https://api.example.com` and a frontend at `https://app.example.com`. Replace both with your actual public origins:

```ts
import { createServer } from '@skeld/core/server';

export const server = createServer({
  publicOrigin: 'https://api.example.com',
  cors: {
    origins: ['https://app.example.com'],
    credentials: true,
    exposedHeaders: ['x-request-id'],
  },
  csrf: { trustedOrigins: ['https://app.example.com'] },
});
```

This configures policy; it does not create a session, authenticate a user, or start listening.

## Grant response access with CORS

`cors.origins` says which browser origins may read responses. Credentialed requests need explicit origins; `'*'` with `credentials: true` is refused. Expose `x-request-id` if cross-origin browser code needs to read that header.

A disallowed origin receives no CORS grant. An actual request can still execute: CORS controls browser access to the response, so it cannot substitute for authorization or the cross-site check.

Preflight is different. An `OPTIONS` preflight for a configured route is processed before hooks: an allowed origin gets a 204 grant, a disallowed one gets 403, and a missing route or route without CORS gets 404. The header grant lists the route's declared headers, `content-type` for a body, and configured `allowedHeaders`; it does not echo arbitrary requested headers. See the [complete CORS rules](../../docs/reference/core.md#browsers-on-other-origins-cors-and-the-cross-site-check).

## Admit cross-site mutations separately

The cross-site check runs on POST, PUT, PATCH, and DELETE, after routing and before `onRequest`. Its allowed origins are `publicOrigin` plus `csrf.trustedOrigins`. CORS origins are not automatically trusted here; a cross-origin frontend usually needs both declarations.

| Caller evidence                                               | Default `baseline` | `strict` |
| ------------------------------------------------------------- | ------------------ | -------- |
| Exact allowed `Origin`                                        | Passes             | Passes   |
| `Sec-Fetch-Site: same-origin`                                 | Passes             | Passes   |
| No `Origin`, `Sec-Fetch-Site: none`                           | Passes             | Passes   |
| Neither header, as with a typical Node client                 | Passes             | Refused  |
| Other evidence, such as an untrusted origin with `cross-site` | Refused            | Refused  |

`strict` requires `publicOrigin`. The public origin is the browser-facing origin, including scheme and non-default port, even if a proxy forwards to plain HTTP on loopback. It is not inferred from an arbitrary incoming Host header.

This check is based on browser origin evidence. Non-browser callers can set those headers themselves, so passing it is not authentication. A webhook still needs its signature verified. Under strict mode, an explicitly named `csrfExempt` route can admit a headerless webhook, but exemption does not verify its sender.

GET and HEAD are not checked. Keep them free of state-changing behavior.

## Let the browser manage cookies

Cookies emitted through the cookie API default to `Secure`, `HttpOnly`, `SameSite=Lax`, and `Path=/`. Use the cookie API rather than setting the reserved `set-cookie` header. Secure cookies require an appropriate secure browser context; a plain HTTP development setup is not equivalent to production HTTPS.

Cross-origin and cross-site are different. Two HTTPS subdomains may be different origins while remaining the same site. Choose SameSite behavior for the actual deployment; a cross-site cookie with `SameSite=None` must also be secure. Browser policies can still restrict third-party cookies.

The typed client has no cookie input field. Browser fetch owns the cookie jar. For a cross-origin request that should use eligible browser cookies, provide a fetch implementation with credentials enabled:

```ts
import { createClient } from '@skeld/core/client';
import { defineContract } from '@skeld/core/contract';

const contract = defineContract({
  session: { method: 'GET', path: '/session', responses: { 204: null } },
});

export const client = createClient(contract, {
  baseUrl: 'https://api.example.com',
  fetch: (input, init) => globalThis.fetch(input, { ...init, credentials: 'include' }),
});
```

This shows the client configuration for an assumed `/session` contract; it does not implement a session endpoint. Credentials mode does not bypass CORS, SameSite, or other browser cookie policies. Node's fetch does not supply a browser cookie jar.

On the server, declared cookie fields arrive validated on `request.cookies`. Raw cookie reads deliberately preserve the wire value; duplicate names read as absent through `get(name)`, while a duplicate declared name is refused. See the [cookie API and limits](../../docs/reference/core.md#redirects-and-cookies).

## Restrict redirect destinations

Use a local path for an ordinary redirect within the service. Absolute HTTP(S) destinations must have an exact origin in `redirectOrigins`; the default allows none. `publicOrigin` and `cors.origins` do not add redirect permissions.

The engine checks the final `Location` of 3xx responses. It refuses ambiguous local paths, credentials in absolute URLs, and other prohibited forms. A 201 `Location` is outside this redirect check. Keep authorization and any return-path policy in the application even when the destination passes the engine's URL check.

**Next:** [run behind a proxy](running-a-service.md). Reference: [server policies](../api/core/server.md) and [redirect checks](../api/core/redirect.md).
