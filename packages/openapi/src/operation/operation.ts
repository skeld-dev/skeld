// Does:  Builds one route's OpenAPI operation: identity, parameters, body, declared responses and security.
// Holds: Only declared parts and statuses appear; every field is a fresh copy, so no input array or object is shared.

import type { RouteDefinition } from '@skeld/core/contract';
import type { Location } from '../diagnostics/diagnostics.ts';
import { visit } from '../limits/limits.ts';
import type { RouteMeta } from '../metadata/metadata.ts';
import type {
  OpenApiOperation,
  OpenApiParameter,
  OpenApiParameterConstraint,
  OpenApiRequestBody,
  OpenApiResponse,
  SecurityRequirement,
} from '../openapi/types.ts';
import { sortedKeys } from '../order/order.ts';
import {
  isTextConverted,
  partMinimum,
  requestSchema,
  responseSchema,
  textSchema,
  unwrapOptional,
  type WalkContext,
} from '../schema/walk.ts';

type Part = 'params' | 'query' | 'headers' | 'cookies';

const PARTS: readonly Part[] = ['params', 'query', 'headers', 'cookies'];
// Why: The OpenAPI 3.1.2 Parameter Object ignores these header parameters; media types and security describe them.
const RESERVED_HEADERS: ReadonlySet<string> = new Set(['accept', 'content-type', 'authorization']);

interface PartOutput {
  readonly parameters: OpenApiParameter[];
  readonly constraint: OpenApiParameterConstraint | undefined;
}

function parameter(
  part: Part,
  key: string,
  value: unknown,
  context: WalkContext,
  at: Location,
): OpenApiParameter | undefined {
  if (part === 'headers' && RESERVED_HEADERS.has(key)) {
    context.found.push({ code: 'RESERVED_HEADER', location: at });
    return undefined;
  }
  const property = unwrapOptional(value, context, at, 2);
  const schema = requestSchema(property.inner, context, at, property.depth);
  if (part === 'cookies') {
    context.found.push({ code: 'TEXT_PARAMETER', location: at });
    return {
      name: key,
      in: 'cookie',
      required: !property.optional,
      content: { 'text/plain': { schema: { type: 'string' } } },
      'x-skeld-valueSchema': schema,
    };
  }
  if (isTextConverted(property.inner)) {
    context.found.push({ code: 'TEXT_PARAMETER', location: at });
  }
  if (part === 'query') {
    return { name: key, in: 'query', required: !property.optional, style: 'form', explode: true, schema };
  }
  // Why: The OpenAPI 3.1.2 Parameter Object requires a path parameter to be required, whatever its schema says.
  const required = part === 'params' || !property.optional;
  return { name: key, in: part === 'params' ? 'path' : 'header', required, style: 'simple', schema };
}

function partParameters(part: Part, route: RouteDefinition, name: string, context: WalkContext): PartOutput {
  const schema = route[part];
  if (schema === undefined) {
    return { parameters: [], constraint: undefined };
  }
  const at = [name, part];
  visit(context.budget, 1, at);
  const keys = sortedKeys(Object.keys(schema.properties));
  const parameters: OpenApiParameter[] = [];
  for (const key of keys) {
    const built = parameter(part, key, schema.properties[key], context, [...at, 'properties', key]);
    if (built !== undefined) {
      parameters.push(built);
    }
  }
  const minimum = partMinimum(schema, at);
  if (minimum === undefined) {
    return { parameters, constraint: undefined };
  }
  context.found.push({ code: 'PARAMETER_OBJECT_CONSTRAINT', location: at });
  return { parameters, constraint: { minDeclaredProperties: minimum, properties: keys } };
}

function requestBody(route: RouteDefinition, name: string, context: WalkContext): OpenApiRequestBody | undefined {
  if (route.body === undefined) {
    return undefined;
  }
  const at = [name, 'body'];
  const body = unwrapOptional(route.body, context, at, 1);
  const json = requestSchema(body.inner, context, at, body.depth);
  const text = textSchema(body.inner, context, at, body.depth);
  return {
    // Why: Core answers 400 to a request without a body on a route that declares one, even an outer optional.
    required: true,
    content: {
      'application/json': { schema: json },
      ...(text === null ? {} : { 'text/plain': { schema: text } }),
    },
  };
}

function responses(
  route: RouteDefinition,
  meta: RouteMeta,
  name: string,
  context: WalkContext,
): { [status: string]: OpenApiResponse } {
  const statuses = Object.keys(route.responses).sort((a, b) => Number(a) - Number(b));
  return Object.fromEntries(
    statuses.map((status) => {
      const description = meta.responses.get(status) ?? `Response ${status}`;
      const schema = route.responses[Number(status)];
      if (schema === null || schema === undefined) {
        return [status, { description }];
      }
      const at = [name, 'responses', Number(status)];
      // Why: Core serves a response declared as an outer t.optional, so the wrapper is unwrapped as for a body.
      const response = unwrapOptional(schema, context, at, 1);
      const content = { 'application/json': { schema: responseSchema(response.inner, context, at, response.depth) } };
      return [status, { description, content }];
    }),
  );
}

export interface OperationInput {
  readonly name: string;
  readonly route: RouteDefinition;
  readonly meta: RouteMeta;
  readonly operationId: string;
  readonly security: readonly SecurityRequirement[];
}

export function buildOperation(input: OperationInput, context: WalkContext): OpenApiOperation {
  const { name, route, meta } = input;
  const parts = PARTS.map((part) => [part, partParameters(part, route, name, context)] as const);
  const parameters = parts.flatMap(([, output]) => output.parameters);
  const constraints = parts.flatMap(([part, output]) =>
    output.constraint === undefined ? [] : [[part, output.constraint] as const],
  );
  const body = requestBody(route, name, context);
  return {
    operationId: input.operationId,
    ...(meta.summary === undefined ? {} : { summary: meta.summary }),
    ...(meta.description === undefined ? {} : { description: meta.description }),
    ...(meta.tags === undefined ? {} : { tags: [...meta.tags] }),
    ...(meta.deprecated === undefined ? {} : { deprecated: meta.deprecated }),
    ...(parameters.length === 0 ? {} : { parameters }),
    ...(body === undefined ? {} : { requestBody: body }),
    responses: responses(route, meta, name, context),
    security: input.security.map((requirement) =>
      Object.fromEntries(Object.entries(requirement).map(([scheme, scopes]) => [scheme, [...scopes]])),
    ),
    ...(constraints.length === 0 ? {} : { 'x-skeld-parameterConstraints': Object.fromEntries(constraints) }),
  };
}
