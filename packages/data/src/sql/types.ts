// Does:  Declares the values a query may carry and the opaque query a tagged template builds.
// Holds: A Query has no member a caller can read at run time; its one member exists only in the type.

declare const queryBrand: unique symbol;

/** A value a query sends as a parameter, never as text. */
export type Parameter = string | number | bigint | boolean | null | Uint8Array | Date;

/**
 * A frozen, opaque query built by `sql` or `identifier`; recognised by registration, never by shape.
 * An object of the same shape is refused with `DataError` `INVALID_QUERY` when it runs.
 */
export interface Query {
  /** Marks the type; absent at run time. */
  readonly [queryBrand]: true;
}
