import type { ErrorDetail } from '../contract/types.ts';

export type PartName = 'params' | 'query' | 'headers' | 'body';

export type PartOutcome =
  | { readonly kind: 'ok'; readonly value: unknown }
  | { readonly kind: 'failed'; readonly details: readonly ErrorDetail[] };

export interface PartValidator {
  run(value: unknown): PartOutcome;
}

export interface RequestValidators {
  readonly params: PartValidator | null;
  readonly query: PartValidator | null;
  readonly headers: PartValidator | null;
  readonly body: PartValidator | null;
}

export type Serializer = (body: unknown) => string;

export type ResponseSerializers = ReadonlyMap<number, Serializer | null>;
