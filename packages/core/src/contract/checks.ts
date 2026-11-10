import { end, start } from '#diag';
import { isModelSchema, isNode } from '../schema/node.ts';
import type { Kind, Schema } from '../schema/types.ts';
import { parsePath } from './path.ts';
import type { ContractRoutes, RouteDefinition } from './types.ts';

type KeyedPart = 'params' | 'query' | 'headers';

const PARAMETER_SEGMENT = /^:[A-Za-z_][A-Za-z0-9_]*$/;
const FORBIDDEN_PATH_CHARACTER = /[?#%\s]/;
const SCALAR_KINDS: ReadonlySet<Kind> = new Set(['string', 'number', 'integer', 'boolean', 'literal']);
const BODYLESS_STATUSES = ['204', '304'];
const KEYED_PARTS: readonly KeyedPart[] = ['params', 'query', 'headers'];
const REQUEST_PARTS = ['params', 'query', 'headers', 'body'] as const;

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

function checkSchemas(route: RouteDefinition): string | null {
  const part = REQUEST_PARTS.find((name) => route[name] !== undefined && !isNode(route[name]));
  if (part !== undefined) {
    return `${part} is not a schema`;
  }
  const status = Object.keys(route.responses).find((key) => {
    const schema = route.responses[Number(key)];
    return schema !== null && !isNode(schema);
  });
  if (status !== undefined) {
    return `responses.${status} is not a schema`;
  }
  const keyed = KEYED_PARTS.find((name) => {
    const schema: Schema | undefined = route[name];
    return schema !== undefined && schema.kind !== 'object';
  });
  return keyed === undefined ? null : `${keyed} is not an object schema`;
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

function isScalarSchema(schema: Schema): boolean {
  if (!isModelSchema(schema)) {
    return false;
  }
  return schema.kind === 'union' ? schema.members.every(isScalarSchema) : SCALAR_KINDS.has(schema.kind);
}

function isKeyedPropertySchema(schema: Schema, allowsArrays: boolean): boolean {
  if (!isModelSchema(schema)) {
    return false;
  }
  if (schema.kind === 'optional') {
    return isKeyedPropertySchema(schema.inner, allowsArrays);
  }
  return isScalarSchema(schema) || (allowsArrays && schema.kind === 'array' && isScalarSchema(schema.items));
}

function checkPropertyKinds(route: RouteDefinition): string | null {
  for (const part of KEYED_PARTS) {
    const schema = route[part];
    if (schema === undefined) {
      continue;
    }
    const allowsArrays = part === 'query';
    const refused = Object.entries(schema.properties).find(
      ([, property]) => !isKeyedPropertySchema(property, allowsArrays),
    );
    if (refused !== undefined) {
      const kinds = 'must be a string, number, integer, boolean or literal schema';
      return `${part} key ${refused[0]} ${kinds}${allowsArrays ? ', or an array of them' : ''}`;
    }
  }
  return null;
}

function checkRoute(route: RouteDefinition): string | null {
  return (
    checkPath(route.path) ??
    checkSchemas(route) ??
    checkParams(route) ??
    checkBody(route) ??
    checkResponses(route) ??
    checkHeaderKeys(route) ??
    checkPropertyKinds(route)
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
