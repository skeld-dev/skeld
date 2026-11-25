// Does:  Checks a route's security alternatives against its declared access and returns the operation's list.
// Holds: Public access emits [], optional needs an anonymous and a credential alternative, protected forbids anonymous.

import type { RouteDefinition } from '@skeld/core/contract';
import { OpenApiError } from '../openapi/openapi-error.ts';
import type { SecurityRequirement } from '../openapi/types.ts';

// Does:  Returns the alternatives to emit, refusing with INVALID_SECURITY at the route's security metadata.
export function operationSecurity(
  name: string,
  access: RouteDefinition['access'],
  requirements: readonly SecurityRequirement[] | undefined,
): readonly SecurityRequirement[] {
  const given = requirements ?? [];
  const anonymous = given.filter((requirement) => Object.keys(requirement).length === 0).length;
  const credentialed = given.length - anonymous;
  let consistent: boolean;
  if (access === undefined || access === 'public') {
    consistent = given.length === 0;
  } else if (access === 'optional') {
    consistent = anonymous > 0 && credentialed > 0;
  } else {
    consistent = credentialed > 0 && anonymous === 0;
  }
  if (!consistent) {
    throw new OpenApiError('INVALID_SECURITY', ['routes', name, 'security']);
  }
  return given;
}
