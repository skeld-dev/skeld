# @darkstart/core/json-schema

## toJsonSchema

Exports a schema as a JSON Schema 2020-12 document.

Closed objects carry `additionalProperties: false`; classes and reasons export as `x-sensitivity`, `x-exposure`, `x-unbounded`, `x-open`.

```ts
export function toJsonSchema(schema: Schema): JsonSchema;
```

```ts
toJsonSchema(t.string({ maxLength: 36 }));
```

Source: `packages/core/src/schema/json-schema.ts:9`

## JsonSchema

A JSON Schema 2020-12 document, as plain JSON.

```ts
export interface JsonSchema {
  readonly [keyword: string]: unknown;
}
```

Source: `packages/core/src/schema/types.ts:363`
