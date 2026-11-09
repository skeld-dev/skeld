import { end, start } from '#diag';
import { Format } from 'typebox/format';
import { parsePath } from './path.ts';
import type { ContractRoutes, RouteDefinition } from './types.ts';

type KeyedPart = 'params' | 'query' | 'headers';

const PARAMETER_SEGMENT = /^:[A-Za-z_][A-Za-z0-9_]*$/;
const FORBIDDEN_PATH_CHARACTER = /[?#%\s]/;
const SCALAR_TYPES: ReadonlySet<unknown> = new Set(['string', 'number', 'integer', 'boolean']);
const BODYLESS_STATUSES = ['204', '304'];
const KEYED_PARTS: readonly KeyedPart[] = ['params', 'query', 'headers'];
const REQUEST_PARTS = ['params', 'query', 'headers', 'body'] as const;
export const SUBSCHEMA_KEYWORDS = [
  'items',
  'prefixItems',
  'anyOf',
  'allOf',
  'oneOf',
  'not',
  'additionalProperties',
  'unevaluatedProperties',
  'unevaluatedItems',
  'contains',
  'propertyNames',
  'if',
  'then',
  'else',
];
export const SUBSCHEMA_MAP_KEYWORDS = ['properties', 'patternProperties', '$defs', 'dependentSchemas'];

function isRecord(value: unknown): value is object {
  return typeof value === 'object' && value !== null;
}

function checkPath(path: string): string | null {
  if (!path.startsWith('/')) {
    return 'path must start with /';
  }
  if (path === '/') {
    return null;
  }
  const texts = path.slice(1).split('/');
  if (texts.includes('')) {
    return 'path has an empty segment';
  }
  if (FORBIDDEN_PATH_CHARACTER.test(path)) {
    return 'path must not contain ?, #, % or whitespace';
  }
  const badParameter = texts.find((text) => text.startsWith(':') && !PARAMETER_SEGMENT.test(text));
  if (badParameter !== undefined) {
    return `segment ${badParameter} is not a parameter; use :name as the whole segment`;
  }
  const lastIndex = texts.length - 1;
  if (texts.some((text, index) => text.includes('*') && !(text === '*' && index === lastIndex))) {
    return '* is allowed only as the whole last segment';
  }
  const names = texts.filter((text) => text.startsWith(':')).map((text) => text.slice(1));
  const repeated = names.find((name, index) => names.indexOf(name) !== index);
  if (repeated !== undefined) {
    return `parameter :${repeated} appears twice`;
  }
  return null;
}

function checkParams(route: RouteDefinition): string | null {
  const names = parsePath(route.path).flatMap((segment) => {
    if (segment.kind === 'param') {
      return [segment.name];
    }
    return segment.kind === 'wildcard' ? ['*'] : [];
  });
  if (route.params === undefined) {
    return names.length > 0 ? 'path has parameters but no params schema' : null;
  }
  const keys = Object.keys(route.params.properties);
  const missing = names.find((name) => !keys.includes(name));
  if (missing === '*') {
    return "path wildcard * has no key '*' in params";
  }
  if (missing !== undefined) {
    return `path parameter :${missing} has no key in params`;
  }
  const extra = keys.find((key) => !names.includes(key));
  if (extra !== undefined) {
    return `params key ${extra} has no :${extra} segment in the path`;
  }
  return null;
}

function checkBody(route: RouteDefinition): string | null {
  return route.method === 'GET' && route.body !== undefined ? 'GET routes cannot declare a body' : null;
}

function isDeclarableStatus(key: string): boolean {
  const status = Number(key);
  return Number.isInteger(status) && String(status) === key && status >= 200 && status <= 599;
}

function checkResponses(route: RouteDefinition): string | null {
  const statuses = Object.keys(route.responses);
  if (statuses.length === 0) {
    return 'responses is empty';
  }
  const outside = statuses.find((status) => !isDeclarableStatus(status));
  if (outside !== undefined) {
    return `response status ${outside} is outside 200-599`;
  }
  const withBody = BODYLESS_STATUSES.find(
    (status) => Object.hasOwn(route.responses, status) && route.responses[Number(status)] !== null,
  );
  if (withBody !== undefined) {
    return `response ${withBody} must be null; a ${withBody} response has no body`;
  }
  return null;
}

function checkHeaderKeys(route: RouteDefinition): string | null {
  if (route.headers === undefined) {
    return null;
  }
  const upper = Object.keys(route.headers.properties).find((key) => key !== key.toLowerCase());
  return upper === undefined ? null : `headers key ${upper} must be lower case`;
}

function isScalarSchema(schema: unknown): boolean {
  if (!isRecord(schema)) {
    return false;
  }
  const anyOf: unknown = Reflect.get(schema, 'anyOf');
  if (Array.isArray(anyOf)) {
    return anyOf.length > 0 && anyOf.every(isScalarSchema);
  }
  const type: unknown = Reflect.get(schema, 'type');
  if (type !== undefined) {
    return SCALAR_TYPES.has(type);
  }
  const constant: unknown = Reflect.get(schema, 'const');
  return typeof constant === 'string' || typeof constant === 'number' || typeof constant === 'boolean';
}

function isScalarArraySchema(schema: unknown): boolean {
  return isRecord(schema) && Reflect.get(schema, 'type') === 'array' && isScalarSchema(Reflect.get(schema, 'items'));
}

function checkPropertyKinds(route: RouteDefinition): string | null {
  for (const part of KEYED_PARTS) {
    const schema = route[part];
    if (schema === undefined) {
      continue;
    }
    const allowsArrays = part === 'query';
    const refused = Object.entries(schema.properties).find(
      ([, property]) => !(isScalarSchema(property) || (allowsArrays && isScalarArraySchema(property))),
    );
    if (refused !== undefined) {
      const kinds = 'must be a string, number, integer, boolean or literal schema';
      return `${part} key ${refused[0]} ${kinds}${allowsArrays ? ', or an array of them' : ''}`;
    }
  }
  return null;
}

function childSchemas(node: object): unknown[] {
  const children: unknown[] = [];
  for (const keyword of SUBSCHEMA_KEYWORDS) {
    const value: unknown = Reflect.get(node, keyword);
    if (Array.isArray(value)) {
      children.push(...value);
    } else if (value !== undefined) {
      children.push(value);
    }
  }
  for (const keyword of SUBSCHEMA_MAP_KEYWORDS) {
    const value: unknown = Reflect.get(node, keyword);
    if (isRecord(value)) {
      children.push(...Object.values(value));
    }
  }
  return children;
}

function findInSchema<T>(schema: unknown, visit: (node: object) => T | null): T | null {
  if (!isRecord(schema)) {
    return null;
  }
  const found = visit(schema);
  if (found !== null) {
    return found;
  }
  for (const child of childSchemas(schema)) {
    const inChild = findInSchema(child, visit);
    if (inChild !== null) {
      return inChild;
    }
  }
  return null;
}

function closedUnionMember(node: object): true | null {
  const anyOf: unknown = Reflect.get(node, 'anyOf');
  const closed =
    Array.isArray(anyOf) &&
    anyOf.some((member) => isRecord(member) && Reflect.get(member, 'additionalProperties') === false);
  return closed ? true : null;
}

function checkResponseUnions(route: RouteDefinition): string | null {
  const status = Object.keys(route.responses).find(
    (key) => findInSchema(route.responses[Number(key)], closedUnionMember) !== null,
  );
  return status === undefined ? null : `response ${status} has an anyOf member with additionalProperties: false`;
}

function unknownFormat(node: object): string | null {
  const format: unknown = Reflect.get(node, 'format');
  return typeof format === 'string' && !Format.Has(format) ? format : null;
}

function checkFormats(route: RouteDefinition): string | null {
  for (const part of REQUEST_PARTS) {
    const format = findInSchema(route[part], unknownFormat);
    if (format !== null) {
      return `${part} schema uses unknown format "${format}"`;
    }
  }
  return null;
}

function checkRoute(route: RouteDefinition): string | null {
  return (
    checkPath(route.path) ??
    checkParams(route) ??
    checkBody(route) ??
    checkResponses(route) ??
    checkHeaderKeys(route) ??
    checkPropertyKinds(route) ??
    checkResponseUnions(route) ??
    checkFormats(route)
  );
}

export function checkContract(routes: ContractRoutes): void {
  const span = start('boot.contract_check');
  try {
    for (const [name, route] of Object.entries(routes)) {
      const failure = checkRoute(route);
      if (failure !== null) {
        throw new TypeError(`Route ${name} (${route.method} ${route.path}): ${failure}`);
      }
    }
  } finally {
    end(span);
  }
}
