// Does:  Holds generation's fixed work limits and counts visited schema nodes, or metadata values, on a budget.
// Holds: Past 100,000 visits on one budget or 64 nested nodes on one path, generation throws LIMIT_EXCEEDED.

import type { Location } from '../diagnostics/diagnostics.ts';
import { OpenApiError } from '../openapi/openapi-error.ts';

export const ROUTE_LIMIT = 10_000;
const VISIT_LIMIT = 100_000;
const DEPTH_LIMIT = 64;

export interface Budget {
  visits: number;
}

export function visit(budget: Budget, depth: number, location: Location): void {
  budget.visits++;
  if (budget.visits > VISIT_LIMIT || depth > DEPTH_LIMIT) {
    throw new OpenApiError('LIMIT_EXCEEDED', location);
  }
}
