// Does:  Checks a contract's routes when declared: methods, paths, schemas, params, bodies, statuses, keys.
// Holds: A contract that passes names only model schemas, and its path parameters and params keys match one for one.

import { end, start } from '#diag';
import { isCookieName } from '../cookie/name.ts';
import { isModelSchema, isNode } from '../schema/node.ts';
import type { Kind, Schema } from '../schema/types.ts';
import { parsePath } from './path.ts';
import type { ContractRoutes, HttpMethod, RouteDefinition } from './types.ts';

type KeyedPart = 'params' | 'query' | 'headers' | 'cookies';

const PARAMETER_SEGMENT = /^:[A-Za-z_][A-Za-z0-9_]*$/;
// Why: A declared path is matched against the decoded request path, so it carries no query, fragment or escape.
const FORBIDDEN_PATH_CHARACTER = /[?#%\\\s]/;
const SCALAR_KINDS: ReadonlySet<Kind> = new Set(['string', 'number', 'integer', 'boolean', 'literal']);
// Why: HTTP gives 204 and 304 no body, so a schema declared for one could never be honoured.
const BODYLESS_STATUSES = ['204', '304'];
const KEYED_PARTS: readonly KeyedPart[] = ['params', 'query', 'headers', 'cookies'];
const REQUEST_PARTS = ['params', 'query', 'headers', 'cookies', 'body'] as const;
// Why: The router, the cross-site check and the preflight trust the method, and a declaration can bypass the type.
const METHODS: ReadonlySet<unknown> = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] satisfies HttpMethod[]);

const ACCESS_NAME = /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/;

// Does:  Tests a policy, action or other access name: 1 to 64 characters, a letter, then letters, digits, _, . and -.
export function isAccessName(value: unknown): value is string {
  return typeof value === 'string' && ACCESS_NAME.test(value);
}

function checkAccess(route: RouteDefinition): string | null {
  const access: unknown = route.access;
  if (access === undefined || access === 'public' || access === 'optional') {
    return null;
  }
  if (
    typeof access === 'object' &&
    access !== null &&
    'policy' in access &&
    'action' in access &&
    isAccessName(access.policy) &&
    isAccessName(access.action)
  ) {
    return null;
  }
  return "access must be 'public', 'optional' or { policy, action } of names of 1 to 64 characters: a letter, then letters, digits, _, . or -";
}

function checkMethod(route: RouteDefinition): string | null {
  return METHODS.has(route.method) ? null : 'method must be GET, POST, PUT, PATCH or DELETE';
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
    return 'path must not contain ?, #, %, backslashes or whitespace';
  }
  if (texts.some((text) => text === '.' || text === '..')) {
    return 'path must not contain . or .. segments';
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
  // Why: The round trip rejects keys such as '200.0' or ' 200' that Number() alone would read as 200.
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
  // Why: Node lower-cases header names, so a key in any other case could never match.
  const upper = Object.keys(route.headers.properties).find((key) => key !== key.toLowerCase());
  return upper === undefined ? null : `headers key ${upper} must be lower case`;
}

function checkCookieKeys(route: RouteDefinition): string | null {
  if (route.cookies === undefined) {
    return null;
  }
  const invalid = Object.keys(route.cookies.properties).find((key) => !isCookieName(key));
  return invalid === undefined ? null : `cookies key ${invalid} is not a cookie name (an HTTP token)`;
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
    // Why: Only a query key repeats into an array; a path parameter, a header and a cookie arrive as one string.
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

// Why: A declaration is untrusted at boot and can bypass the types; a wrong shape is refused here, not by accident.
function checkShape(route: RouteDefinition): string | null {
  const declared: unknown = route;
  if (typeof declared !== 'object' || declared === null) {
    return 'route must be an object';
  }
  if (typeof route.path !== 'string') {
    return 'path must be a string';
  }
  if (typeof route.responses !== 'object' || route.responses === null) {
    return 'responses must be an object';
  }
  return null;
}

// Does:  Names a route by its method and path when both are text, since a declaration can hold anything there.
function routeLabel(route: RouteDefinition): string {
  const declared: unknown = route;
  if (typeof declared !== 'object' || declared === null) {
    return '';
  }
  return typeof route.method === 'string' && typeof route.path === 'string' ? ` (${route.method} ${route.path})` : '';
}

function checkRoute(route: RouteDefinition): string | null {
  return (
    checkShape(route) ??
    checkMethod(route) ??
    checkPath(route.path) ??
    checkSchemas(route) ??
    checkParams(route) ??
    checkBody(route) ??
    checkResponses(route) ??
    checkHeaderKeys(route) ??
    checkCookieKeys(route) ??
    checkPropertyKinds(route) ??
    checkAccess(route)
  );
}

// Does:  Throws a TypeError naming the first route that breaks a rule, and the rule it breaks.
export function checkContract(routes: ContractRoutes): void {
  const span = start('boot.contract_check');
  try {
    for (const [name, route] of Object.entries(routes)) {
      const failure = checkRoute(route);
      if (failure !== null) {
        throw new TypeError(`Route ${name}${routeLabel(route)}: ${failure}`);
      }
    }
  } finally {
    end(span);
  }
}
