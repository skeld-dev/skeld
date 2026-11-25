// Does:  Exports @skeld/openapi: createOpenApi and the types of the options, the result and the document.
// Holds: This file's exports are the root's whole surface; the OpenApiError class is reached only at ./openapi-error.

import { type ContractRoutes, defineContract, type RouteDefinition } from '@skeld/core/contract';
import { type Found, finishDiagnostics } from '../diagnostics/diagnostics.ts';
import { type Budget, ROUTE_LIMIT } from '../limits/limits.ts';
import { readMetadata, routeMeta } from '../metadata/metadata.ts';
import { buildOperation } from '../operation/operation.ts';
import { compareText, sortedKeys } from '../order/order.ts';
import { checkCollisions, type PlacedRoute, pathTemplate } from '../paths/paths.ts';
import { operationSecurity } from '../security/security.ts';
import { OpenApiError } from './openapi-error.ts';
import type { OpenApiDocument, OpenApiOperation, OpenApiOptions, OpenApiResult } from './types.ts';

export type {
  DiagnosticCode,
  OpenApiDiagnostic,
  OpenApiDocument,
  OpenApiInfo,
  OpenApiMediaType,
  OpenApiOperation,
  OpenApiOptions,
  OpenApiParameter,
  OpenApiParameterConstraint,
  OpenApiPathItem,
  OpenApiRequestBody,
  OpenApiResponse,
  OpenApiResult,
  OpenApiSchema,
  OpenApiServer,
  RouteDocumentation,
  SecurityRequirement,
  SecurityScheme,
} from './types.ts';
export type { ErrorCode } from './openapi-error.ts';

interface DeclaredRoute {
  readonly name: string;
  readonly route: RouteDefinition;
}

// Does:  Reads each route once, in name order, and checks it alone with defineContract so a refusal names it.
function readContract(contract: ContractRoutes): DeclaredRoute[] {
  const given: unknown = contract;
  if (typeof given !== 'object' || given === null) {
    throw new OpenApiError('INVALID_CONTRACT', []);
  }
  const names = sortedKeys(Object.keys(contract));
  if (names.length > ROUTE_LIMIT) {
    throw new OpenApiError('LIMIT_EXCEEDED', []);
  }
  return names.map((name) => {
    const route = contract[name];
    if (route === undefined) {
      throw new OpenApiError('INVALID_CONTRACT', [name]);
    }
    try {
      defineContract({ [name]: route });
    } catch (error) {
      if (error instanceof TypeError) {
        throw new OpenApiError('INVALID_CONTRACT', [name]);
      }
      throw error;
    }
    return { name, route };
  });
}

/**
 * Generates an OpenAPI 3.1.2 document and its diagnostics from a contract, offline and synchronously.
 * Throws `OpenApiError` for a refused contract, metadata, path, schema or security; nothing is written or fetched.
 * @example createOpenApi({}, { info: { title: 'Notes API', version: '1.0.0' } })
 */
export function createOpenApi<const C extends ContractRoutes>(contract: C, options: OpenApiOptions<C>): OpenApiResult {
  const budget: Budget = { visits: 0 };
  const found: Found[] = [];
  const routes = readContract(contract);
  const declared = new Map(routes.map(({ name, route }) => [name, new Set(Object.keys(route.responses))]));
  const metadata = readMetadata(options, declared, { visits: 0 });
  const placed = routes.map(({ name, route }): DeclaredRoute & { readonly place: PlacedRoute } => {
    const { operationId } = routeMeta(metadata, name);
    const place = {
      name,
      method: route.method,
      template: pathTemplate(name, route.path),
      operationId: operationId ?? name,
      suppliedId: operationId !== undefined,
    };
    return { name, route, place };
  });
  checkCollisions(placed.map(({ place }) => place));
  const paths = new Map<string, [string, OpenApiOperation][]>();
  for (const { name, route, place } of placed) {
    const meta = routeMeta(metadata, name);
    const security = operationSecurity(name, route.access, meta.security);
    const operations = paths.get(place.template) ?? [];
    const input = { name, route, meta, operationId: place.operationId, security };
    operations.push([route.method.toLowerCase(), buildOperation(input, { budget, found })]);
    paths.set(place.template, operations);
  }
  const document: OpenApiDocument = {
    openapi: '3.1.2',
    jsonSchemaDialect: 'https://json-schema.org/draft/2020-12/schema',
    info: metadata.info,
    ...(metadata.servers === undefined ? {} : { servers: metadata.servers }),
    paths: Object.fromEntries(
      [...paths]
        .sort(([a], [b]) => compareText(a, b))
        .map(([template, operations]) => [
          template,
          Object.fromEntries(operations.sort(([a], [b]) => compareText(a, b))),
        ]),
    ),
    ...(metadata.schemes.size === 0 ? {} : { components: { securitySchemes: Object.fromEntries(metadata.schemes) } }),
  };
  return { document, diagnostics: finishDiagnostics(found) };
}
