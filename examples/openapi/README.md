# Generate an OpenAPI document

This example declares a small notes service, the auth instance it runs with, and a script that writes the service's OpenAPI document. The document's session cookie and CSRF header names come from the same values the service passes to auth: `SESSION_COOKIE` in `service.ts` and `CSRF_TOKEN_HEADER` from `@skeld/core/gate`.

It needs no server, database or account. It needs Node 26.

## Run it

From the repository root, after `pnpm install`:

```sh
pnpm --filter @skeld/example-openapi run generate
```

The document goes to standard output and the diagnostics to standard error. The security part of the output:

```json
"securitySchemes": {
  "apiKey": { "type": "http", "scheme": "bearer", "description": "An API key issued by the service." },
  "csrf": { "type": "apiKey", "in": "header", "name": "x-csrf-token" },
  "session": { "type": "apiKey", "in": "cookie", "name": "__Host-notes" }
}
```

`PUT /notes/{id}` lists two alternatives: `{ "csrf": [], "session": [] }`, the cookie and the CSRF header together, and `{ "apiKey": [] }`. `GET /notes/{id}` needs no CSRF header, and `GET /health` has `"security": []`.

Standard error lists seven `UTF16_LENGTH` diagnostics, one per bounded string, such as:

```text
UTF16_LENGTH readNote.params.properties.id: String length bounds count UTF-16 code units and appear only as x-skeld extensions
```

## The files

- `service.ts`: the contract, the `notes` policy, `SESSION_COOKIE` and `createNotesAuth`, which passes the cookie name to auth and accepts API keys.
- `generate.ts`: calls `createOpenApi` with the security schemes and route documentation, then prints the result. The library itself writes nothing.

To keep the document true, change a credential name in one place: the constant both files read. The [guide](../../docs/guides/openapi.md#describe-security) explains what generation checks and what it cannot.
