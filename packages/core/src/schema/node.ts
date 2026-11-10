import type {
  ArraySchema,
  BooleanSchema,
  ExposedSchema,
  IntegerSchema,
  Kind,
  LiteralSchema,
  NullSchema,
  NumberSchema,
  ObjectSchema,
  OptionalSchema,
  RecordSchema,
  Schema,
  StringSchema,
  UnionSchema,
} from './types.ts';

export interface RuntimeNode {
  readonly kind: Kind;
}

export type ModelSchema =
  | StringSchema
  | IntegerSchema
  | NumberSchema
  | BooleanSchema
  | NullSchema
  | LiteralSchema
  | ObjectSchema
  | ArraySchema
  | RecordSchema
  | UnionSchema
  | OptionalSchema
  | ExposedSchema<unknown>;

export const nodePrototype = {};

export function isNode(value: unknown): value is Schema {
  return typeof value === 'object' && value !== null && Object.getPrototypeOf(value) === nodePrototype;
}

export function isModelSchema(value: unknown): value is ModelSchema {
  return isNode(value);
}
