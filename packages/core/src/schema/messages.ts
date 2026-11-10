import type { LiteralValue } from './types.ts';

export type ExpectedType = 'string' | 'integer' | 'number' | 'boolean' | 'null' | 'object' | 'array';

export type BoundSide = 'most' | 'least';

const typeNames: Readonly<Record<ExpectedType, string>> = {
  string: 'a string',
  integer: 'an integer',
  number: 'a number',
  boolean: 'a boolean',
  null: 'null',
  object: 'an object',
  array: 'an array',
};

export const isRequired = 'is required';

export const isNotAllowed = 'is not allowed';

export function wrongType(expected: ExpectedType): string {
  return `must be ${typeNames[expected]}`;
}

export function mustEqual(value: LiteralValue): string {
  return `must equal ${JSON.stringify(value)}`;
}

export function stringLength(side: BoundSide, bound: number): string {
  return `must have at ${side} ${bound} UTF-16 code units`;
}

export function numericRange(side: BoundSide, bound: number): string {
  return `must be at ${side} ${bound}`;
}

export function arrayLength(side: BoundSide, bound: number): string {
  return `must have at ${side} ${bound} items`;
}

export function propertyCount(side: BoundSide, bound: number): string {
  return `must have at ${side} ${bound} properties`;
}

export const noAllowedForm = 'must match one of the allowed forms';

export const isNotValid = 'is not valid';
