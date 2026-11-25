// Does:  Translates core schema nodes into OpenAPI schema objects for a request or a response, with diagnostics.
// Holds: Only listed fields are copied, never a reason string; an unexposed secret in a response throws INVALID_SCHEMA.

import type { Found, Location } from '../diagnostics/diagnostics.ts';
import { type Budget, visit } from '../limits/limits.ts';
import { OpenApiError } from '../openapi/openapi-error.ts';
import type { OpenApiSchema } from '../openapi/types.ts';
import { sortedKeys } from '../order/order.ts';

export interface WalkContext {
  readonly budget: Budget;
  readonly found: Found[];
}

type Direction = 'request' | 'response';

interface Walk {
  readonly context: WalkContext;
  readonly direction: Direction;
  readonly exposed: boolean;
  readonly depth: number;
  readonly at: Location;
}

type Draft = { -readonly [K in keyof OpenApiSchema]: OpenApiSchema[K] };

function refuse(at: Location): never {
  throw new OpenApiError('INVALID_SCHEMA', at);
}

function node(value: unknown, at: Location): object {
  if (typeof value !== 'object' || value === null) {
    refuse(at);
  }
  return value;
}

function deeper(walk: Walk, steps: Location, exposed = walk.exposed): Walk {
  return { ...walk, exposed, depth: walk.depth + 1, at: [...walk.at, ...steps] };
}

// Does:  Reads a count bound: absent, or a non-negative safe integer.
function count(schema: object, name: string, at: Location): number | undefined {
  const value: unknown = Reflect.get(schema, name);
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    refuse(at);
  }
  return value;
}

function finite(schema: object, name: string, at: Location): number | undefined {
  const value: unknown = Reflect.get(schema, name);
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    refuse(at);
  }
  return value;
}

function ordered(low: number | undefined, high: number | undefined, at: Location): void {
  if (low !== undefined && high !== undefined && low > high) {
    refuse(at);
  }
}

function sensitivityOf(schema: object, at: Location): 'secret' | 'personal' | undefined {
  const value: unknown = Reflect.get(schema, 'sensitivity');
  if (value !== undefined && value !== 'secret' && value !== 'personal') {
    refuse(at);
  }
  return value;
}

function stringSchema(schema: object, walk: Walk): Draft {
  const minLength = count(schema, 'minLength', walk.at);
  const maxLength = count(schema, 'maxLength', walk.at);
  ordered(minLength, maxLength, walk.at);
  if (minLength !== undefined || maxLength !== undefined) {
    walk.context.found.push({ code: 'UTF16_LENGTH', location: walk.at });
  }
  return {
    type: 'string',
    ...(minLength === undefined ? {} : { 'x-skeld-minLengthUtf16': minLength }),
    ...(maxLength === undefined ? {} : { 'x-skeld-maxLengthUtf16': maxLength }),
  };
}

function numberSchema(schema: object, type: 'integer' | 'number', at: Location): Draft {
  const minimum = finite(schema, 'minimum', at);
  const maximum = finite(schema, 'maximum', at);
  ordered(minimum, maximum, at);
  return {
    type,
    ...(minimum === undefined ? {} : { minimum }),
    ...(maximum === undefined ? {} : { maximum }),
  };
}

function literalSchema(schema: object, at: Location): Draft {
  const value: unknown = Reflect.get(schema, 'value');
  if (
    typeof value === 'string' ||
    typeof value === 'boolean' ||
    (typeof value === 'number' && Number.isFinite(value))
  ) {
    return { const: value };
  }
  return refuse(at);
}

// Does:  Splits an optional wrapper from its inner schema; the wrapper counts as one visited node.
export function unwrapOptional(
  value: unknown,
  context: WalkContext,
  at: Location,
  depth: number,
): { readonly optional: boolean; readonly inner: unknown; readonly depth: number } {
  const schema = node(value, at);
  if (Reflect.get(schema, 'kind') !== 'optional') {
    return { optional: false, inner: value, depth };
  }
  visit(context.budget, depth, at);
  return { optional: true, inner: Reflect.get(schema, 'inner'), depth: depth + 1 };
}

function objectSchema(schema: object, walk: Walk): Draft {
  const properties = node(Reflect.get(schema, 'properties'), walk.at);
  const keys = sortedKeys(Object.keys(properties));
  const converted: [string, OpenApiSchema][] = [];
  const required: string[] = [];
  for (const key of keys) {
    const at = [...walk.at, 'properties', key];
    const property = unwrapOptional(Reflect.get(properties, key), walk.context, at, walk.depth + 1);
    converted.push([key, convert(property.inner, { ...walk, depth: property.depth, at })]);
    if (!property.optional) {
      required.push(key);
    }
  }
  // Why: core accepts undeclared keys of an open object in a request, but its serializer writes declared keys only.
  const open = walk.direction === 'request' && typeof Reflect.get(schema, 'open') === 'string';
  const draft: Draft = {
    type: 'object',
    properties: Object.fromEntries(converted),
    ...(required.length === 0 ? {} : { required }),
    additionalProperties: open,
  };
  const minProperties = count(schema, 'minProperties', walk.at);
  if (minProperties !== undefined && open) {
    draft['x-skeld-minDeclaredProperties'] = minProperties;
    walk.context.found.push({ code: 'DECLARED_PROPERTY_COUNT', location: walk.at });
  } else if (minProperties !== undefined) {
    draft.minProperties = minProperties;
  }
  return draft;
}

function arraySchema(schema: object, walk: Walk): Draft {
  const minItems = count(schema, 'minItems', walk.at);
  const maxItems = count(schema, 'maxItems', walk.at);
  ordered(minItems, maxItems, walk.at);
  return {
    type: 'array',
    items: convert(Reflect.get(schema, 'items'), deeper(walk, ['items'])),
    ...(minItems === undefined ? {} : { minItems }),
    ...(maxItems === undefined ? {} : { maxItems }),
  };
}

function recordSchema(schema: object, walk: Walk): Draft {
  const key: unknown = Reflect.get(schema, 'key');
  const keyWalk = deeper(walk, ['propertyNames']);
  if (Reflect.get(node(key, keyWalk.at), 'kind') !== 'string') {
    refuse(keyWalk.at);
  }
  const maxProperties = count(schema, 'maxProperties', walk.at);
  return {
    type: 'object',
    propertyNames: convert(key, keyWalk),
    additionalProperties: convert(Reflect.get(schema, 'value'), deeper(walk, ['additionalProperties'])),
    ...(maxProperties === undefined ? {} : { maxProperties }),
  };
}

function unionSchema(schema: object, walk: Walk): Draft {
  const members: unknown = Reflect.get(schema, 'members');
  if (!Array.isArray(members) || members.length === 0) {
    return refuse(walk.at);
  }
  return { anyOf: members.map((member: unknown, index) => convert(member, deeper(walk, ['anyOf', index]))) };
}

function shape(schema: object, walk: Walk): Draft {
  const kind: unknown = Reflect.get(schema, 'kind');
  switch (kind) {
    case 'string':
      return stringSchema(schema, walk);
    case 'integer':
    case 'number':
      return numberSchema(schema, kind, walk.at);
    case 'boolean':
    case 'null':
      return { type: kind };
    case 'literal':
      return literalSchema(schema, walk.at);
    case 'object':
      return objectSchema(schema, walk);
    case 'array':
      return arraySchema(schema, walk);
    case 'record':
      return recordSchema(schema, walk);
    case 'union':
      return unionSchema(schema, walk);
    default:
      return refuse(walk.at);
  }
}

function annotate(draft: Draft, sensitivity: 'secret' | 'personal' | undefined, walk: Walk): OpenApiSchema {
  if (sensitivity === undefined) {
    return draft;
  }
  // Why: Core refuses to boot a response carrying an unexposed secret, so the document cannot describe one.
  if (sensitivity === 'secret' && walk.direction === 'response' && !walk.exposed) {
    refuse(walk.at);
  }
  draft['x-sensitivity'] = sensitivity;
  if (sensitivity === 'secret' && walk.direction === 'request') {
    draft.writeOnly = true;
  }
  return draft;
}

function convert(value: unknown, walk: Walk): OpenApiSchema {
  visit(walk.context.budget, walk.depth, walk.at);
  const schema = node(value, walk.at);
  if (Reflect.get(schema, 'kind') === 'exposed') {
    // Why: Exposure permits every secret below the wrapper, as core's own response check reads it.
    const inner: unknown = Reflect.get(schema, 'inner');
    return convert(inner, deeper(walk, [], walk.exposed || walk.direction === 'response'));
  }
  const sensitivity = sensitivityOf(schema, walk.at);
  return annotate(shape(schema, walk), sensitivity, walk);
}

// Does:  Selects the branches of a request body schema a text/plain body can satisfy: strings and string literals.
function textBranches(value: unknown, walk: Walk): OpenApiSchema | null {
  const schema = node(value, walk.at);
  const kind: unknown = Reflect.get(schema, 'kind');
  if (kind === 'string' || (kind === 'literal' && typeof Reflect.get(schema, 'value') === 'string')) {
    return convert(value, walk);
  }
  if (kind !== 'union' && kind !== 'exposed' && kind !== 'optional') {
    return null;
  }
  visit(walk.context.budget, walk.depth, walk.at);
  if (kind !== 'union') {
    return textBranches(Reflect.get(schema, 'inner'), deeper(walk, []));
  }
  const members: unknown = Reflect.get(schema, 'members');
  if (!Array.isArray(members) || members.length === 0) {
    return refuse(walk.at);
  }
  const selected = members
    .map((member: unknown, index) => textBranches(member, deeper(walk, ['anyOf', index])))
    .filter((branch) => branch !== null);
  if (selected.length === 0) {
    return null;
  }
  return annotate({ anyOf: selected }, sensitivityOf(schema, walk.at), walk);
}

export function requestSchema(value: unknown, context: WalkContext, at: Location, depth: number): OpenApiSchema {
  return convert(value, { context, direction: 'request', exposed: false, depth, at });
}

export function responseSchema(value: unknown, context: WalkContext, at: Location, depth: number): OpenApiSchema {
  return convert(value, { context, direction: 'response', exposed: false, depth, at });
}

export function textSchema(value: unknown, context: WalkContext, at: Location, depth: number): OpenApiSchema | null {
  return textBranches(value, { context, direction: 'request', exposed: false, depth, at });
}

// Does:  Tells whether core converts a text parameter's value, a number, boolean or such a literal or union member.
export function isTextConverted(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const kind: unknown = Reflect.get(value, 'kind');
  switch (kind) {
    case 'integer':
    case 'number':
    case 'boolean':
      return true;
    case 'literal':
      return typeof Reflect.get(value, 'value') !== 'string';
    case 'optional':
    case 'exposed':
      return isTextConverted(Reflect.get(value, 'inner'));
    case 'array':
      return isTextConverted(Reflect.get(value, 'items'));
    case 'union': {
      const members: unknown = Reflect.get(value, 'members');
      return Array.isArray(members) && members.some((member: unknown) => isTextConverted(member));
    }
    default:
      return false;
  }
}

export function partMinimum(schema: unknown, at: Location): number | undefined {
  return count(node(schema, at), 'minProperties', at);
}
