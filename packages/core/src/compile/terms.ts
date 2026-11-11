import { isModelSchema } from '../schema/node.ts';
import type {
  BooleanSchema,
  IntegerSchema,
  LiteralSchema,
  LiteralValue,
  NullSchema,
  NumberSchema,
  Schema,
  StringSchema,
} from '../schema/types.ts';

export interface Names {
  next: number;
}

export type Terms = readonly (string | null)[];

export type ScalarSchema = StringSchema | IntegerSchema | NumberSchema | BooleanSchema | NullSchema | LiteralSchema;

export function fresh(prefix: string, names: Names): string {
  names.next += 1;
  return `${prefix}${names.next}`;
}

export function test(terms: Terms, fail: string): string {
  const failing = terms.filter((term) => term !== null);
  return failing.length === 0 ? '' : `if (${failing.join(' || ')}) ${fail}\n`;
}

export function above(subject: string, bound: number | undefined): string | null {
  if (bound === undefined || bound === Number.POSITIVE_INFINITY) {
    return null;
  }
  return Number.isFinite(bound) ? `${subject} > ${String(bound)}` : 'true';
}

export function below(subject: string, bound: number | undefined): string | null {
  if (bound === undefined || bound === Number.NEGATIVE_INFINITY) {
    return null;
  }
  return Number.isFinite(bound) ? `${subject} < ${String(bound)}` : 'true';
}

function differs(subject: string, value: LiteralValue): string {
  if (typeof value === 'string' || typeof value === 'boolean') {
    return `${subject} !== ${JSON.stringify(value)}`;
  }
  return Number.isFinite(value) ? `${subject} !== ${String(value)}` : 'true';
}

export function objectTest(value: string): readonly string[] {
  return [`typeof ${value} !== "object"`, `${value} === null`, `Array.isArray(${value})`];
}

export function optionalInner(node: Schema): Schema | null {
  return isModelSchema(node) && node.kind === 'optional' ? node.inner : null;
}

export function scalarTerms(node: ScalarSchema, value: string): Terms {
  switch (node.kind) {
    case 'string': {
      const length = `${value}.length`;
      return [`typeof ${value} !== "string"`, above(length, node.maxLength), below(length, node.minLength)];
    }
    case 'integer':
      return [`!Number.isInteger(${value})`, below(value, node.minimum), above(value, node.maximum)];
    case 'number':
      return [`!Number.isFinite(${value})`, below(value, node.minimum), above(value, node.maximum)];
    case 'boolean':
      return [`typeof ${value} !== "boolean"`];
    case 'null':
      return [`${value} !== null`];
    case 'literal':
      return [differs(value, node.value)];
  }
}

export function exactKeys(value: string, declared: string, fewer: string | null, fail: string, names: Names): string {
  const count = fresh('n', names);
  const visited = fresh('k', names);
  const walk = `let ${count} = 0;\nfor (const ${visited} in ${value}) {\nif (++${count} > ${declared}) ${fail}\n}\n`;
  return walk + test([`${count} !== ${declared}`, fewer], fail);
}
