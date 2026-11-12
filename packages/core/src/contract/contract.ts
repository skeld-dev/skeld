// Does:  Defines defineContract and the schema of the one error body.
// Holds: A contract returned by defineContract has passed every contract check.

import { array, integer, object, optional, string } from '../schema/schema.ts';
import { checkContract } from './checks.ts';
import type { ContractRoutes } from './types.ts';

export type {
  ContractRoutes,
  Empty,
  EngineErrorCode,
  ErrorBody,
  ErrorDetail,
  HttpMethod,
  ResponseSchemas,
  RouteDefinition,
} from './types.ts';

// Why: The error body's strings come from the service itself, so they are declared unbounded with this reason.
const WRITTEN_BY_SERVICE = 'written by the service, not by a client';

/**
 * The schema of the error body every Skeld server writes: `{ status, code, message, details? }`.
 * Its strings and its `details` are `unbounded`, so a client accepts a server's error message of any length.
 */
export const errorBodySchema = object({
  status: integer({ minimum: 400, maximum: 599 }),
  code: string({ unbounded: WRITTEN_BY_SERVICE }),
  message: string({ unbounded: WRITTEN_BY_SERVICE }),
  details: optional(
    array(
      object({
        path: string({ unbounded: WRITTEN_BY_SERVICE }),
        message: string({ unbounded: WRITTEN_BY_SERVICE }),
      }),
      { unbounded: WRITTEN_BY_SERVICE },
    ),
  ),
});

/**
 * Declares a service's routes, checks each one and returns the contract with its literal types kept.
 * Throws `TypeError` `Route <name> (<METHOD> <path>): <reason>` for a bad path, part schema, parameter, body, status or header key.
 * @example defineContract({ health: { method: 'GET', path: '/health', responses: { 204: null } } })
 */
export function defineContract<const C extends ContractRoutes>(routes: C): C {
  checkContract(routes);
  return routes;
}
