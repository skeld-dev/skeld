# @darkstart/core/secret

## Secret

A value marked `secret`: it prints, stringifies and serializes as `[secret]`.

It is not assignable to the value it holds; only `expose` returns that value.

```ts
export class Secret<T> {
  constructor(value: T);
  toString(): string;
  toJSON(): string;
  [Symbol.for('nodejs.util.inspect.custom')](): string;
}
```

```ts
String(new Secret('hunter2'));
```

Source: `packages/core/src/schema/secret.ts:11`

## expose

Returns the value a `Secret` holds.

The one way to read a secret, so a search for `expose(` finds every place one leaves.

```ts
export function expose<T>(secret: Secret<T>): T;
```

```ts
expose(new Secret('hunter2'));
```

Source: `packages/core/src/schema/secret.ts:41`
