# @skeld/data/sql

## Parameter

A value a query sends as a parameter, never as text.

```ts
export type Parameter = string | number | bigint | boolean | null | Uint8Array | Date;
```

Source: `packages/data/src/sql/types.ts:7`

## Query

A frozen, opaque query built by `sql` or `identifier`; recognised by registration, never by shape.

An object of the same shape is refused with `DataError` `INVALID_QUERY` when it runs.

```ts
export interface Query {
  readonly [queryBrand]: true;
}
```

| Field          | Summary                             |
| -------------- | ----------------------------------- |
| `[queryBrand]` | Marks the type; absent at run time. |

Source: `packages/data/src/sql/types.ts:13`

## sql

Builds a query; each interpolated value is sent as a parameter and each interpolated `Query` nests with its own.

A refused value (`undefined`, a non-finite number, an invalid `Date`, any other object) fails the query with `INVALID_QUERY` when it runs.

```ts
export function sql(parts: TemplateStringsArray, ...values: readonly (Parameter | Query)[]): Query;
```

```ts
sql`select id from users where id = ${7}`;
```

Source: `packages/data/src/sql/sql.ts:15`

## identifier

Builds a quoted identifier from its parts, joined by `.`, with each `"` doubled.

Throws `DataError` `INVALID_QUERY` for no part, an empty part or a NUL.

```ts
export function identifier(...parts: readonly string[]): Query;
```

```ts
identifier('app', 'users');
```

Source: `packages/data/src/sql/sql.ts:24`
