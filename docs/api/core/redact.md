# @darkstart/core/redact

## redact

Returns a copy of a value with each `secret` value as `[secret]` and each `personal` value as `[personal]`.

A marked container is replaced whole; a value not of the schema's shape is kept unless marked; the input is never changed.

```ts
export function redact(schema: Schema, value: unknown): unknown;
```

```ts
redact(t.object({ token: t.string({ maxLength: 64, sensitivity: 'secret' }) }), { token: 'abc' });
```

Source: `packages/core/src/schema/redact.ts:32`
