// Does:  Turns route paths into OpenAPI path templates and refuses colliding operations and operation IDs.
// Holds: Two routes reach one template only with equal parameter names and different methods; IDs are unique.

import type { HttpMethod } from '@skeld/core/contract';
import { OpenApiError } from '../openapi/openapi-error.ts';

export interface PlacedRoute {
  readonly name: string;
  readonly method: HttpMethod;
  readonly template: string;
  readonly operationId: string;
  readonly suppliedId: boolean;
}

// Does:  Writes each :name segment as {name}; a wildcard or a literal brace throws UNSUPPORTED_PATH.
export function pathTemplate(name: string, path: string): string {
  if (path === '/') {
    return path;
  }
  const segments = path
    .slice(1)
    .split('/')
    .map((segment) => {
      // Why: An OpenAPI parameter matches one segment, so it cannot promise a multi-segment wildcard.
      if (segment === '*' || segment.includes('{') || segment.includes('}')) {
        throw new OpenApiError('UNSUPPORTED_PATH', [name]);
      }
      return segment.startsWith(':') ? `{${segment.slice(1)}}` : segment;
    });
  return `/${segments.join('/')}`;
}

// Why: /a/{id} and /a/{key} match the same requests, so they are one path whose parameter names must agree.
function shapeOf(template: string): string {
  return template.replaceAll(/\{[^}]*\}/g, '{}');
}

// Does:  Throws COLLISION at the later route, in the given order, that repeats a path, a method or an ID.
export function checkCollisions(routes: readonly PlacedRoute[]): void {
  const templates = new Map<string, string>();
  const operations = new Set<string>();
  const ids = new Set<string>();
  for (const route of routes) {
    const shape = shapeOf(route.template);
    const known = templates.get(shape) ?? route.template;
    const operation = `${route.method} ${route.template}`;
    if (known !== route.template || operations.has(operation)) {
      throw new OpenApiError('COLLISION', [route.name]);
    }
    if (ids.has(route.operationId)) {
      throw new OpenApiError('COLLISION', route.suppliedId ? ['routes', route.name, 'operationId'] : [route.name]);
    }
    templates.set(shape, route.template);
    operations.add(operation);
    ids.add(route.operationId);
  }
}
