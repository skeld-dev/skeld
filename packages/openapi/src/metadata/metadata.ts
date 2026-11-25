// Does:  Reads createOpenApi's options into checked metadata: info, servers, route documentation and schemes.
// Holds: Only own listed fields of the listed types pass; anything else throws, and no input object is kept.

import type { Location } from '../diagnostics/diagnostics.ts';
import { type Budget, visit } from '../limits/limits.ts';
import { OpenApiError } from '../openapi/openapi-error.ts';
import type { OpenApiInfo, OpenApiServer, SecurityRequirement, SecurityScheme } from '../openapi/types.ts';
import { sortedKeys } from '../order/order.ts';

export interface RouteMeta {
  readonly summary: string | undefined;
  readonly description: string | undefined;
  readonly tags: readonly string[] | undefined;
  readonly operationId: string | undefined;
  readonly deprecated: boolean | undefined;
  readonly responses: ReadonlyMap<string, string>;
  readonly security: readonly SecurityRequirement[] | undefined;
}

export interface Metadata {
  readonly info: OpenApiInfo;
  readonly servers: readonly OpenApiServer[] | undefined;
  readonly routes: ReadonlyMap<string, RouteMeta>;
  readonly schemes: ReadonlyMap<string, SecurityScheme>;
}

const OPTIONS: ReadonlySet<string> = new Set(['info', 'servers', 'routes', 'securitySchemes']);
const INFO: ReadonlySet<string> = new Set(['title', 'version', 'description']);
const SERVER: ReadonlySet<string> = new Set(['url', 'description']);
const ROUTE: ReadonlySet<string> = new Set([
  'summary',
  'description',
  'tags',
  'operationId',
  'deprecated',
  'responses',
  'security',
]);
const BEARER: ReadonlySet<string> = new Set(['type', 'scheme', 'bearerFormat', 'description']);
const API_KEY: ReadonlySet<string> = new Set(['type', 'in', 'name', 'description']);
const OPEN_ID: ReadonlySet<string> = new Set(['type', 'openIdConnectUrl', 'description']);
const SCHEME_NAME = /^[A-Za-z0-9._-]+$/;
// Why: Header and cookie names are HTTP tokens (RFC 9110 section 5.6.2); a query name is held to the same grammar.
const TOKEN = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;
const NO_ROUTE_META: RouteMeta = Object.freeze({
  summary: undefined,
  description: undefined,
  tags: undefined,
  operationId: undefined,
  deprecated: undefined,
  responses: new Map<string, string>(),
  security: undefined,
});

function refuse(at: Location): never {
  throw new OpenApiError('INVALID_METADATA', at);
}

function plain(value: unknown, at: Location, budget: Budget): object {
  visit(budget, at.length, at);
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    refuse(at);
  }
  return value;
}

// Does:  Reads a map option: a plain object only, so a Map or a class instance is refused instead of read as empty.
function plainMap(value: unknown, at: Location, budget: Budget): object {
  const map = plain(value, at, budget);
  const prototype: unknown = Object.getPrototypeOf(map);
  if (prototype !== Object.prototype && prototype !== null) {
    refuse(at);
  }
  return map;
}

function ownKeys(value: object, at: Location): string[] {
  const keys: string[] = [];
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string') {
      refuse(at);
    }
    keys.push(key);
  }
  return keys;
}

// Why: A field set to undefined is read as absent, as JSON.stringify drops it.
function presentKeys(value: object, at: Location): string[] {
  return ownKeys(value, at).filter((key) => Reflect.get(value, key) !== undefined);
}

function onlyKeys(value: object, allowed: ReadonlySet<string>, at: Location): void {
  const unknown = presentKeys(value, at).find((key) => !allowed.has(key));
  if (unknown !== undefined) {
    refuse([...at, unknown]);
  }
}

// Why: Only own fields count, so a name such as toString or __proto__ never reads an inherited member.
function read(value: object, key: string): unknown {
  return Object.hasOwn(value, key) ? Reflect.get(value, key) : undefined;
}

function text(value: unknown, at: Location): string {
  if (typeof value !== 'string') {
    refuse(at);
  }
  return value;
}

function optionalText(value: object, key: string, at: Location): string | undefined {
  const field = read(value, key);
  return field === undefined ? undefined : text(field, [...at, key]);
}

function nonblank(value: unknown, at: Location): string {
  const checked = text(value, at);
  if (checked.trim() === '') {
    refuse(at);
  }
  return checked;
}

function list(value: unknown, at: Location, budget: Budget): unknown[] {
  visit(budget, at.length, at);
  if (!Array.isArray(value)) {
    refuse(at);
  }
  const items: unknown[] = [];
  for (let index = 0; index < value.length; index++) {
    visit(budget, at.length + 1, [...at, index]);
    const item: unknown = value[index];
    items.push(item);
  }
  return items;
}

function texts(value: unknown, at: Location, budget: Budget): string[] {
  return list(value, at, budget).map((item, index) => text(item, [...at, index]));
}

// Does:  Accepts an absolute http or https URL without credentials, or a root path; never a fragment or a template.
function isServerUrl(url: string): boolean {
  // Why: The URL parser drops surrounding whitespace and an empty userinfo, so the text itself is checked first.
  if (/[#{}]/.test(url) || url.trim() !== url || /^[A-Za-z][A-Za-z0-9+.-]*:\/\/[^/?]*@/.test(url)) {
    return false;
  }
  if (url.startsWith('/')) {
    return !url.startsWith('//');
  }
  const parsed = URL.parse(url);
  return (
    parsed !== null &&
    (parsed.protocol === 'http:' || parsed.protocol === 'https:') &&
    parsed.username === '' &&
    parsed.password === ''
  );
}

function isOpenIdUrl(url: string): boolean {
  const parsed = URL.parse(url);
  return (
    parsed !== null &&
    parsed.protocol === 'https:' &&
    parsed.username === '' &&
    parsed.password === '' &&
    !url.includes('#')
  );
}

function described<T extends object>(value: T, description: string | undefined): T | (T & { description: string }) {
  return description === undefined ? value : { ...value, description };
}

function readInfo(value: unknown, budget: Budget): OpenApiInfo {
  const at = ['info'];
  const info = plain(value, at, budget);
  onlyKeys(info, INFO, at);
  const title = nonblank(read(info, 'title'), [...at, 'title']);
  const version = nonblank(read(info, 'version'), [...at, 'version']);
  return described({ title, version }, optionalText(info, 'description', at));
}

function readServers(value: unknown, budget: Budget): OpenApiServer[] | undefined {
  if (value === undefined) {
    return undefined;
  }
  return list(value, ['servers'], budget).map((item, index) => {
    const at = ['servers', index];
    const server = plain(item, at, budget);
    onlyKeys(server, SERVER, at);
    const url = text(read(server, 'url'), [...at, 'url']);
    if (!isServerUrl(url)) {
      refuse([...at, 'url']);
    }
    return described({ url }, optionalText(server, 'description', at));
  });
}

function readScheme(value: unknown, at: Location, budget: Budget): SecurityScheme {
  const scheme = plain(value, at, budget);
  const type = read(scheme, 'type');
  const description = optionalText(scheme, 'description', at);
  if (type === 'http') {
    onlyKeys(scheme, BEARER, at);
    if (read(scheme, 'scheme') !== 'bearer') {
      refuse([...at, 'scheme']);
    }
    const bearerFormat = optionalText(scheme, 'bearerFormat', at);
    const bearer = { type, scheme: 'bearer' } as const;
    return described(bearerFormat === undefined ? bearer : { ...bearer, bearerFormat }, description);
  }
  if (type === 'apiKey') {
    onlyKeys(scheme, API_KEY, at);
    const place = read(scheme, 'in');
    if (place !== 'header' && place !== 'query' && place !== 'cookie') {
      refuse([...at, 'in']);
    }
    const name = text(read(scheme, 'name'), [...at, 'name']);
    if (!TOKEN.test(name)) {
      refuse([...at, 'name']);
    }
    return described({ type, in: place, name }, description);
  }
  if (type === 'openIdConnect') {
    onlyKeys(scheme, OPEN_ID, at);
    const openIdConnectUrl = text(read(scheme, 'openIdConnectUrl'), [...at, 'openIdConnectUrl']);
    if (!isOpenIdUrl(openIdConnectUrl)) {
      refuse([...at, 'openIdConnectUrl']);
    }
    return described({ type, openIdConnectUrl }, description);
  }
  return refuse([...at, 'type']);
}

function readSchemes(value: unknown, budget: Budget): Map<string, SecurityScheme> {
  const schemes = new Map<string, SecurityScheme>();
  if (value === undefined) {
    return schemes;
  }
  const at = ['securitySchemes'];
  const given = plainMap(value, at, budget);
  for (const name of sortedKeys(presentKeys(given, at))) {
    if (!SCHEME_NAME.test(name)) {
      refuse([...at, name]);
    }
    schemes.set(name, readScheme(read(given, name), [...at, name], budget));
  }
  return schemes;
}

function readScopes(value: unknown, scheme: SecurityScheme, at: Location, budget: Budget): string[] {
  const scopes = texts(value, at, budget);
  if (scheme.type !== 'openIdConnect' && scopes.length > 0) {
    throw new OpenApiError('INVALID_SECURITY', [...at, 0]);
  }
  const refused = scopes.findIndex((scope, index) => scope === '' || scopes.indexOf(scope) !== index);
  if (refused !== -1) {
    throw new OpenApiError('INVALID_SECURITY', [...at, refused]);
  }
  return scopes;
}

function readRequirement(
  value: unknown,
  schemes: ReadonlyMap<string, SecurityScheme>,
  at: Location,
  budget: Budget,
): SecurityRequirement {
  const requirement = plainMap(value, at, budget);
  const entries: [string, string[]][] = [];
  for (const name of sortedKeys(ownKeys(requirement, at))) {
    const scheme = schemes.get(name);
    if (scheme === undefined) {
      throw new OpenApiError('INVALID_SECURITY', [...at, name]);
    }
    entries.push([name, readScopes(read(requirement, name), scheme, [...at, name], budget)]);
  }
  return Object.fromEntries(entries);
}

function readResponses(
  value: unknown,
  statuses: ReadonlySet<string>,
  at: Location,
  budget: Budget,
): Map<string, string> {
  const responses = new Map<string, string>();
  if (value === undefined) {
    return responses;
  }
  const given = plainMap(value, at, budget);
  for (const status of presentKeys(given, at)) {
    if (!statuses.has(status)) {
      refuse([...at, status]);
    }
    responses.set(status, text(read(given, status), [...at, status]));
  }
  return responses;
}

function readRoute(
  value: unknown,
  statuses: ReadonlySet<string>,
  schemes: ReadonlyMap<string, SecurityScheme>,
  at: Location,
  budget: Budget,
): RouteMeta {
  const route = plain(value, at, budget);
  onlyKeys(route, ROUTE, at);
  const tags = read(route, 'tags');
  const operationId = optionalText(route, 'operationId', at);
  if (operationId === '') {
    refuse([...at, 'operationId']);
  }
  const deprecated = read(route, 'deprecated');
  if (deprecated !== undefined && typeof deprecated !== 'boolean') {
    refuse([...at, 'deprecated']);
  }
  const security = read(route, 'security');
  return {
    summary: optionalText(route, 'summary', at),
    description: optionalText(route, 'description', at),
    tags: tags === undefined ? undefined : texts(tags, [...at, 'tags'], budget),
    operationId,
    deprecated,
    responses: readResponses(read(route, 'responses'), statuses, [...at, 'responses'], budget),
    security:
      security === undefined
        ? undefined
        : list(security, [...at, 'security'], budget).map((item, index) =>
            readRequirement(item, schemes, [...at, 'security', index], budget),
          ),
  };
}

function readRoutes(
  value: unknown,
  declared: ReadonlyMap<string, ReadonlySet<string>>,
  schemes: ReadonlyMap<string, SecurityScheme>,
  budget: Budget,
): Map<string, RouteMeta> {
  const routes = new Map<string, RouteMeta>();
  if (value === undefined) {
    return routes;
  }
  const at = ['routes'];
  const given = plainMap(value, at, budget);
  for (const name of sortedKeys(presentKeys(given, at))) {
    const statuses = declared.get(name);
    if (statuses === undefined) {
      refuse([...at, name]);
    }
    routes.set(name, readRoute(read(given, name), statuses, schemes, [...at, name], budget));
  }
  return routes;
}

// Does:  Reads the options, given each route's name and its declared statuses as text.
export function readMetadata(
  options: unknown,
  declared: ReadonlyMap<string, ReadonlySet<string>>,
  budget: Budget,
): Metadata {
  const given = plain(options, [], budget);
  onlyKeys(given, OPTIONS, []);
  const schemes = readSchemes(read(given, 'securitySchemes'), budget);
  return {
    info: readInfo(read(given, 'info'), budget),
    servers: readServers(read(given, 'servers'), budget),
    routes: readRoutes(read(given, 'routes'), declared, schemes, budget),
    schemes,
  };
}

export function routeMeta(metadata: Metadata, name: string): RouteMeta {
  return metadata.routes.get(name) ?? NO_ROUTE_META;
}
