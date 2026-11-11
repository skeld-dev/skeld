// Does:  Explains why a value fails its schema, as a capped list of issues with their paths.
// Holds: It never records more than the cap, and under a sensitive node it reports one issue at that node only.

import { compileCheck, declaredProperties, isObjectValue, lowerBound, readDeclared, upperBound } from './check.ts';
import {
  arrayLength,
  isNotAllowed,
  isNotValid,
  isRequired,
  mustEqual,
  noAllowedForm,
  numericRange,
  propertyCount,
  stringLength,
  wrongType,
} from './messages.ts';
import { isModelSchema, type ModelSchema } from './node.ts';
import type {
  ArraySchema,
  IntegerSchema,
  Issue,
  NumberSchema,
  ObjectSchema,
  RecordSchema,
  Schema,
  StringSchema,
  UnionSchema,
} from './types.ts';

interface Walk {
  readonly issues: Issue[];
  readonly cap: number;
  readonly path: (string | number)[];
}

function isFull(walk: Walk): boolean {
  return walk.issues.length >= walk.cap;
}

function report(walk: Walk, message: string): void {
  if (!isFull(walk)) {
    walk.issues.push({ message, path: [...walk.path] });
  }
}

function explainAt(walk: Walk, segment: string | number, schema: Schema, value: unknown): void {
  walk.path.push(segment);
  explainValue(walk, schema, value);
  walk.path.pop();
}

function explainString(walk: Walk, schema: StringSchema, value: unknown): void {
  if (typeof value !== 'string') {
    report(walk, wrongType('string'));
    return;
  }
  const most = upperBound(schema.maxLength);
  const least = lowerBound(schema.minLength);
  // Why: Written as a negated <= so that a bound that is NaN reports instead of passing.
  if (!(value.length <= most)) {
    report(walk, stringLength('most', schema.maxLength ?? most));
  }
  if (!(value.length >= least)) {
    report(walk, stringLength('least', schema.minLength ?? least));
  }
}

function explainNumeric(walk: Walk, schema: IntegerSchema | NumberSchema, value: unknown): void {
  const typed = schema.kind === 'integer' ? Number.isInteger(value) : Number.isFinite(value);
  if (typeof value !== 'number' || !typed) {
    report(walk, wrongType(schema.kind));
    return;
  }
  const least = lowerBound(schema.minimum);
  const most = upperBound(schema.maximum);
  if (!(value >= least)) {
    report(walk, numericRange('least', schema.minimum ?? least));
  }
  if (!(value <= most)) {
    report(walk, numericRange('most', schema.maximum ?? most));
  }
}

function explainObject(walk: Walk, schema: ObjectSchema, value: unknown): void {
  if (!isObjectValue(value)) {
    report(walk, wrongType('object'));
    return;
  }
  const properties = declaredProperties(schema);
  if (schema.minProperties !== undefined) {
    const present = properties.filter((property) => readDeclared(value, property) !== undefined).length;
    if (!(present >= lowerBound(schema.minProperties))) {
      report(walk, propertyCount('least', schema.minProperties));
    }
  }
  for (const property of properties) {
    if (!property.optional && readDeclared(value, property) === undefined) {
      walk.path.push(property.key);
      report(walk, isRequired);
      walk.path.pop();
    }
  }
  for (const property of properties) {
    const item = readDeclared(value, property);
    if (isFull(walk)) {
      return;
    }
    if (item !== undefined) {
      explainAt(walk, property.key, property.schema, item);
    }
  }
  if (schema.open !== undefined) {
    return;
  }
  const declared = new Map(properties.map((property) => [property.key, property]));
  // biome-ignore lint/suspicious/noForIn: M6 refuses every key a for...in visits that is not a present declared key (ADR-027)
  for (const key in value) {
    if (isFull(walk)) {
      return;
    }
    const property = declared.get(key);
    if (property === undefined || readDeclared(value, property) === undefined) {
      walk.path.push(key);
      report(walk, isNotAllowed);
      walk.path.pop();
    }
  }
}

function explainArray(walk: Walk, schema: ArraySchema, value: unknown): void {
  if (!Array.isArray(value)) {
    report(walk, wrongType('array'));
    return;
  }
  const most = upperBound(schema.maxItems);
  const least = lowerBound(schema.minItems);
  if (!(value.length <= most)) {
    report(walk, arrayLength('most', schema.maxItems ?? most));
  }
  if (!(value.length >= least)) {
    report(walk, arrayLength('least', schema.minItems ?? least));
  }
  for (let index = 0; index < value.length && !isFull(walk); index++) {
    explainAt(walk, index, schema.items, value[index]);
  }
}

// Why: The count issue goes first, so it survives when the cap truncates the issues of the entries.
function placeCountFirst(walk: Walk, start: number, message: string): void {
  walk.issues.splice(start, 0, { message, path: [...walk.path] });
  walk.issues.splice(walk.cap);
}

function explainRecord(walk: Walk, schema: RecordSchema, value: unknown): void {
  if (!isObjectValue(value)) {
    report(walk, wrongType('object'));
    return;
  }
  const most = upperBound(schema.maxProperties);
  const start = walk.issues.length;
  let over = Number.isNaN(most);
  let visited = 0;
  // biome-ignore lint/suspicious/noForIn: M8 counts and checks the keys a for...in visits, in one walk (ADR-027)
  for (const key in value) {
    visited += 1;
    over ||= visited > most;
    if (isFull(walk)) {
      // Why: Once the cap is full the walk goes on only to learn whether the key count is over its bound.
      if (over || most === Number.POSITIVE_INFINITY) {
        break;
      }
      continue;
    }
    walk.path.push(key);
    explainValue(walk, schema.key, key);
    explainValue(walk, schema.value, value[key]);
    walk.path.pop();
  }
  if (over) {
    placeCountFirst(walk, start, propertyCount('most', schema.maxProperties ?? most));
  }
}

// Does:  Explains against each member and keeps the shortest explanation that does not fail at the union itself.
function explainUnion(walk: Walk, schema: UnionSchema, value: unknown): void {
  const depth = walk.path.length;
  let chosen: readonly Issue[] | null = null;
  for (const member of schema.members) {
    const trial: Walk = { issues: [], cap: walk.cap - walk.issues.length, path: walk.path };
    explainValue(trial, member, value);
    const rootMismatch = trial.issues.some((issue) => issue.path.length === depth);
    if (!rootMismatch && (chosen === null || trial.issues.length < chosen.length)) {
      chosen = trial.issues;
    }
  }
  if (chosen === null) {
    report(walk, noAllowedForm);
    return;
  }
  walk.issues.push(...chosen);
}

function explainKind(walk: Walk, schema: ModelSchema, value: unknown): void {
  switch (schema.kind) {
    case 'string':
      explainString(walk, schema, value);
      return;
    case 'integer':
    case 'number':
      explainNumeric(walk, schema, value);
      return;
    case 'boolean':
      report(walk, wrongType('boolean'));
      return;
    case 'null':
      report(walk, wrongType('null'));
      return;
    case 'literal':
      report(walk, mustEqual(schema.value));
      return;
    case 'object':
      explainObject(walk, schema, value);
      return;
    case 'array':
      explainArray(walk, schema, value);
      return;
    case 'record':
      explainRecord(walk, schema, value);
      return;
    case 'union':
      explainUnion(walk, schema, value);
      return;
    case 'optional':
    case 'exposed':
      explainValue(walk, schema.inner, value);
      return;
  }
}

// Does:  Reports one issue at a secret or personal node and never descends into what the client sent there.
function explainClassified(walk: Walk, schema: ModelSchema, value: unknown): void {
  const trial: Walk = { issues: [], cap: 1, path: walk.path };
  explainKind(trial, schema, value);
  const first = trial.issues[0];
  report(walk, first !== undefined && first.path.length === walk.path.length ? first.message : isNotValid);
}

function explainValue(walk: Walk, schema: Schema, value: unknown): void {
  if (!isModelSchema(schema)) {
    report(walk, isNotAllowed);
    return;
  }
  // Why: Only a subtree the check refuses is explained; one that passes is skipped whole.
  if (isFull(walk) || compileCheck(schema)(value)) {
    return;
  }
  if ('sensitivity' in schema && schema.sensitivity !== undefined) {
    explainClassified(walk, schema, value);
    return;
  }
  explainKind(walk, schema, value);
}

export function explain(schema: Schema, value: unknown, cap: number): readonly Issue[] {
  const walk: Walk = { issues: [], cap, path: [] };
  explainValue(walk, schema, value);
  return walk.issues;
}
