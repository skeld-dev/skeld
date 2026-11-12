// Does:  Builds a route's CORS answers at boot and writes the one a request earned into its response head.
// Holds: A grant names only an origin from the route's policy or '*'; every answer under a list varies on Origin.

import type { OutgoingHttpHeaders, ServerResponse } from 'node:http';
import type { RouteDefinition } from '../contract/types.ts';
import { isHeaderName, type ResolvedCors } from './policy.ts';

// Does:  The CORS headers one response carries: allowOrigin is null when the request's origin is not allowed.
export interface CorsGrant {
  readonly allowOrigin: string | null;
  readonly credentials: boolean;
  readonly exposeHeaders: string | null;
  readonly varyOrigin: boolean;
}

export interface CorsRoute {
  readonly wildcard: CorsGrant | null;
  readonly grants: ReadonlyMap<string, CorsGrant>;
  readonly denied: CorsGrant;
  readonly allowHeaders: string | null;
  readonly maxAge: string;
}

const LIST_SEPARATOR = ', ';

// Does:  Lists the request headers a preflight allows: the declared ones, content-type with a body, then the policy's.
function allowHeaders(policy: ResolvedCors, definition: RouteDefinition): string | null {
  const names = new Set<string>();
  if (definition.headers !== undefined) {
    for (const name of Object.keys(definition.headers.properties)) {
      // Why: A declared key that is not a token can never arrive as a header, and must not reach a header value.
      if (isHeaderName(name)) {
        names.add(name);
      }
    }
  }
  if (definition.body !== undefined) {
    names.add('content-type');
  }
  for (const name of policy.allowedHeaders) {
    names.add(name);
  }
  return names.size === 0 ? null : [...names].join(LIST_SEPARATOR);
}

export function corsRoute(policy: ResolvedCors, definition: RouteDefinition): CorsRoute {
  const exposeHeaders = policy.exposedHeaders.length === 0 ? null : policy.exposedHeaders.join(LIST_SEPARATOR);
  const { credentials } = policy;
  const wildcard = policy.origins === '*';
  const grant = (allowOrigin: string | null): CorsGrant =>
    Object.freeze({ allowOrigin, credentials, exposeHeaders, varyOrigin: !wildcard });
  const grants = new Map<string, CorsGrant>();
  if (policy.origins !== '*') {
    for (const origin of policy.origins) {
      grants.set(origin, grant(origin));
    }
  }
  return Object.freeze({
    wildcard: wildcard ? grant('*') : null,
    grants,
    denied: Object.freeze({ allowOrigin: null, credentials: false, exposeHeaders: null, varyOrigin: !wildcard }),
    allowHeaders: allowHeaders(policy, definition),
    maxAge: String(policy.maxAgeSeconds),
  });
}

// Does:  Returns the grant for a request's Origin header value, by exact comparison with the policy's origins.
export function grantOf(route: CorsRoute, origin: string | readonly string[] | undefined): CorsGrant {
  if (route.wildcard !== null) {
    return route.wildcard;
  }
  return (typeof origin === 'string' ? route.grants.get(origin) : undefined) ?? route.denied;
}

// Does:  Returns a Vary value that holds Origin, keeping every token already set.
function varyWithOrigin(current: string | number | readonly string[] | undefined): string {
  if (current === undefined) {
    return 'Origin';
  }
  const text = typeof current === 'object' ? current.join(LIST_SEPARATOR) : String(current);
  for (const token of text.split(',')) {
    const name = token.trim().toLowerCase();
    // Why: A Vary of '*' already makes every request distinct (RFC 9110 section 12.5.5).
    if (name === 'origin' || name === '*') {
      return text;
    }
  }
  return text.trim() === '' ? 'Origin' : `${text}${LIST_SEPARATOR}Origin`;
}

export function writeGrant(res: ServerResponse, head: OutgoingHttpHeaders, grant: CorsGrant): void {
  if (grant.allowOrigin !== null) {
    head['access-control-allow-origin'] = grant.allowOrigin;
    if (grant.credentials) {
      head['access-control-allow-credentials'] = 'true';
    }
    if (grant.exposeHeaders !== null) {
      head['access-control-expose-headers'] = grant.exposeHeaders;
    }
  }
  // Why: The answer depends on Origin, so caches must key on it (Fetch Standard, CORS protocol and HTTP caches).
  if (grant.varyOrigin) {
    head.vary = varyWithOrigin(res.getHeader('vary'));
  }
}
