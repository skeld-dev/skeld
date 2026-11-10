import type { RouteDefinition } from '../contract/types.ts';
import { inspectSchema } from '../schema/inspect.ts';
import type { Finding, Schema } from '../schema/types.ts';

interface InspectedPart {
  readonly part: string;
  readonly schema: Schema | null | undefined;
  readonly role: 'request' | 'response';
}

function inspectedParts(route: RouteDefinition): readonly InspectedPart[] {
  const responses = Object.entries(route.responses)
    .map(([status, schema]) => ({ status: Number(status), schema }))
    .sort((a, b) => a.status - b.status)
    .map(({ status, schema }): InspectedPart => ({ part: `responses.${status}`, schema, role: 'response' }));
  return [
    { part: 'params', schema: route.params, role: 'request' },
    { part: 'query', schema: route.query, role: 'request' },
    { part: 'headers', schema: route.headers, role: 'request' },
    { part: 'body', schema: route.body, role: 'request' },
    ...responses,
  ];
}

export function checkRouteSchemas(route: RouteDefinition): { readonly part: string; readonly finding: Finding } | null {
  for (const { part, schema, role } of inspectedParts(route)) {
    if (schema === null || schema === undefined) {
      continue;
    }
    const [finding] = inspectSchema(schema, role);
    if (finding !== undefined) {
      return { part, finding };
    }
  }
  return null;
}
