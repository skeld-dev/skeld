# @skeld/openapi

Generates an OpenAPI 3.1.2 document from a Skeld contract. A declaration it cannot describe, such as a wildcard path or an unexposed secret in a response, is refused with a located `OpenApiError`, and no partial document is returned. Where OpenAPI has no keyword for a rule core enforces, such as string lengths counted in UTF-16 code units, the document carries an `x-skeld-` extension and the result a located diagnostic. Each route's security alternatives are checked against its declared access, every scheme they name must be defined and each scope list must fit its scheme; whether they match your auth configuration is not checked. Generation is offline: no server, network, file or environment variable is touched.

## Install

```sh
npm install @skeld/openapi
```

Requires Node.js 26.12+, an ES module project and `@skeld/core` `^0.3.0` as a peer dependency. No other dependency.

- [Publish an OpenAPI document](../../docs/guides/openapi.md): generate a document, describe security, and read its diagnostics.
- [OpenAPI behavior reference](../../docs/reference/openapi.md): options, mappings, limits and refusals.
- [`examples/openapi`](../../examples/openapi/README.md): a runnable generation script whose security names come from its auth configuration.

[Website & documentation](https://skeld.dev) · [GitHub repository](https://github.com/skeld-dev/skeld)
