import type { TObject, TSchema } from 'typebox';
import { Compile, type Validator } from 'typebox/compile';
import type { TLocalizedValidationError } from 'typebox/error';
import { Settings } from 'typebox/system';
import type { RouteDefinition } from '../contract/types.ts';
import { SUBSCHEMA_KEYWORDS, SUBSCHEMA_MAP_KEYWORDS } from '../contract/checks.ts';
import { createCompileCache } from './compile-cache.ts';
import { SchemaCompileError } from './compile-error.ts';
import { absentBodyDetails, type GroupKeys, pointerToken, toErrorDetails } from './details.ts';
import type { PartName, PartOutcome, PartValidator, RequestValidators } from './types.ts';

interface CompiledBody {
  readonly validator: Validator;
  readonly groupKeys: GroupKeys;
}

interface CompiledPart {
  readonly validator: Validator;
  readonly convert: PropertyConverter | null;
}

const GROUP_MEMBER_KEYWORDS: ReadonlySet<string> = new Set(['anyOf', 'oneOf']);
const GROUP_KEYWORDS = ['allOf', 'anyOf', 'oneOf'];
const NO_GROUPS: GroupKeys = new Map();
// C-13 writes 100 entries; the 101st tells the lifecycle that more failed.
const MAX_DETAILS = 101;

function isRecord(value: unknown): value is object {
  return typeof value === 'object' && value !== null;
}

function collectGroupKeys(node: object, keys: Set<string>): void {
  const properties: unknown = Reflect.get(node, 'properties');
  if (isRecord(properties)) {
    for (const key of Object.keys(properties)) {
      keys.add(key);
    }
  }
  for (const keyword of GROUP_KEYWORDS) {
    const members: unknown = Reflect.get(node, keyword);
    if (Array.isArray(members)) {
      for (const member of members) {
        if (isRecord(member)) {
          collectGroupKeys(member, keys);
        }
      }
    }
  }
}

function recordGroupKeys(node: object, schemaPath: string, groups: Map<string, Set<string>>): void {
  const keys = groups.get(schemaPath) ?? new Set<string>();
  collectGroupKeys(node, keys);
  groups.set(schemaPath, keys);
}

function closeChild(value: unknown, inGroup: boolean, schemaPath: string, groups: Map<string, Set<string>>): unknown {
  return isRecord(value) ? closeObjects(value, inGroup, schemaPath, groups) : value;
}

function closeObjects(node: TSchema, inGroup: boolean, schemaPath: string, groups: Map<string, Set<string>>): TSchema {
  const copy: Record<string, unknown> = { ...node };
  for (const keyword of SUBSCHEMA_KEYWORDS) {
    const value: unknown = Reflect.get(node, keyword);
    const childInGroup = keyword === 'allOf' || (inGroup && GROUP_MEMBER_KEYWORDS.has(keyword));
    const childPath = `${schemaPath}/${keyword}`;
    if (Array.isArray(value)) {
      copy[keyword] = value.map((child, index) => closeChild(child, childInGroup, `${childPath}/${index}`, groups));
    } else if (isRecord(value)) {
      copy[keyword] = closeObjects(value, childInGroup, childPath, groups);
    }
  }
  for (const keyword of SUBSCHEMA_MAP_KEYWORDS) {
    const value: unknown = Reflect.get(node, keyword);
    if (isRecord(value)) {
      copy[keyword] = Object.fromEntries(
        Object.entries(value).map(([key, child]) => [
          key,
          closeChild(child, false, `${schemaPath}/${keyword}/${pointerToken(key)}`, groups),
        ]),
      );
    }
  }
  const declaresAdditional = Object.hasOwn(node, 'additionalProperties');
  if (!inGroup && copy.type === 'object' && !declaresAdditional) {
    copy.additionalProperties = false;
  }
  if (
    !inGroup &&
    Object.hasOwn(node, 'allOf') &&
    !declaresAdditional &&
    !Object.hasOwn(node, 'unevaluatedProperties')
  ) {
    copy.unevaluatedProperties = false;
    recordGroupKeys(node, schemaPath, groups);
  }
  if (!inGroup && Array.isArray(Reflect.get(node, 'anyOf'))) {
    recordGroupKeys(node, schemaPath, groups);
  }
  return copy;
}

type LeafConverter = (text: string) => number | boolean | null;
type PropertyConverter = (value: unknown) => unknown;

const INTEGER_LITERAL = /^-?(0|[1-9][0-9]*)$/;
// RFC 8259 §6 number grammar (ADR-011).
const NUMBER_LITERAL = /^-?(0|[1-9][0-9]*)(\.[0-9]+)?([eE][+-]?[0-9]+)?$/;

function toInteger(text: string): number | null {
  if (!INTEGER_LITERAL.test(text)) {
    return null;
  }
  const value = Number(text);
  return Number.isSafeInteger(value) ? value : null;
}

function toNumber(text: string): number | null {
  if (!NUMBER_LITERAL.test(text)) {
    return null;
  }
  const value = Number(text);
  return Number.isFinite(value) ? value : null;
}

function toBoolean(text: string): boolean | null {
  if (text === 'true') {
    return true;
  }
  return text === 'false' ? false : null;
}

function leafConverter(schema: unknown): LeafConverter | null {
  if (!isRecord(schema)) {
    return null;
  }
  const anyOf: unknown = Reflect.get(schema, 'anyOf');
  if (Array.isArray(anyOf)) {
    const members = anyOf.map(leafConverter).filter((member) => member !== null);
    if (members.length === 0) {
      return null;
    }
    return (text) => {
      for (const member of members) {
        const converted = member(text);
        if (converted !== null) {
          return converted;
        }
      }
      return null;
    };
  }
  const type: unknown = Reflect.get(schema, 'type') ?? typeof Reflect.get(schema, 'const');
  if (type === 'integer') {
    return toInteger;
  }
  if (type === 'number') {
    return toNumber;
  }
  return type === 'boolean' ? toBoolean : null;
}

function convertText(leaf: LeafConverter, value: unknown): unknown {
  return typeof value === 'string' ? (leaf(value) ?? value) : value;
}

function propertyConverter(schema: unknown): PropertyConverter | null {
  if (!(isRecord(schema) && Reflect.get(schema, 'type') === 'array')) {
    const leaf = leafConverter(schema);
    return leaf === null ? null : (value) => convertText(leaf, value);
  }
  const leaf = leafConverter(Reflect.get(schema, 'items'));
  return (value) => {
    const items = typeof value === 'string' ? [value] : value;
    if (leaf === null || !Array.isArray(items)) {
      return items;
    }
    return items.map((item) => convertText(leaf, item));
  };
}

function partConverter(schema: TObject): PropertyConverter | null {
  const plan = Object.entries(schema.properties).flatMap(([key, property]) => {
    const convert = propertyConverter(property);
    return convert === null ? [] : [{ key, convert }];
  });
  if (plan.length === 0) {
    return null;
  }
  return (value) => {
    if (!isRecord(value)) {
      return value;
    }
    const copy: Record<string, unknown> = Object.assign(Object.create(Object.getPrototypeOf(value)), value);
    for (const { key, convert } of plan) {
      if (Object.hasOwn(copy, key)) {
        copy[key] = convert(copy[key]);
      }
    }
    return copy;
  };
}

const keyedParts = createCompileCache(
  (schema: TObject): CompiledPart => ({ validator: Compile(schema), convert: partConverter(schema) }),
);

const bodies = createCompileCache((schema: TSchema): CompiledBody => {
  const groupKeys = new Map<string, Set<string>>();
  return { validator: Compile(closeObjects(schema, false, '#', groupKeys)), groupKeys };
});

// TypeBox's `maxErrors` is process-wide; it is restored so the application's own TypeBox calls keep their limit.
function collectErrors(validator: Validator, value: unknown): TLocalizedValidationError[] {
  const previous = Settings.Get().maxErrors;
  Settings.Set({ maxErrors: MAX_DETAILS });
  try {
    return validator.Errors(value);
  } finally {
    Settings.Set({ maxErrors: previous });
  }
}

function check(part: PartName, validator: Validator, value: unknown, groupKeys: GroupKeys): PartOutcome {
  if (validator.Check(value)) {
    return { kind: 'ok', value };
  }
  const details = toErrorDetails(part, collectErrors(validator, value), groupKeys);
  return { kind: 'failed', details: details.slice(0, MAX_DETAILS) };
}

function keyedValidator(part: PartName, schema: TObject): PartValidator {
  const { validator, convert } = keyedParts(schema);
  if (convert === null) {
    return { run: (value) => check(part, validator, value, NO_GROUPS) };
  }
  return { run: (value) => check(part, validator, convert(value), NO_GROUPS) };
}

function bodyValidator(schema: TSchema): PartValidator {
  const { validator, groupKeys } = bodies(schema);
  return {
    run: (value) =>
      value === undefined ? { kind: 'failed', details: absentBodyDetails } : check('body', validator, value, groupKeys),
  };
}

function compilePart<S extends TSchema>(
  part: PartName,
  schema: S | undefined,
  compile: (schema: S) => PartValidator,
): PartValidator | null {
  if (schema === undefined) {
    return null;
  }
  try {
    return compile(schema);
  } catch (cause) {
    throw new SchemaCompileError(part, null, cause);
  }
}

export function compileRequestValidators(route: RouteDefinition): RequestValidators {
  return {
    params: compilePart('params', route.params, (schema) => keyedValidator('params', schema)),
    query: compilePart('query', route.query, (schema) => keyedValidator('query', schema)),
    headers: compilePart('headers', route.headers, (schema) => keyedValidator('headers', schema)),
    body: compilePart('body', route.body, bodyValidator),
  };
}
