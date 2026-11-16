// Does:  Builds a frozen policy from its options and guards each of its operations with the grant registry.
// Holds: An operation's body runs only for a registered, unreleased grant this policy issued for that action.

import { AuthError } from '../auth-error/auth-error.ts';
import { grantRecord, markDefined } from './registry.ts';
import type { Policy, PolicyOptions } from './types.ts';
import type { Schema } from '@skeld/core/schema';

// Does:  Throws the operation's AuthError unless the value is a live grant of this policy and action.
function checkGrant(issuer: object, action: string, grant: unknown): void {
  const record = grantRecord(grant);
  if (record === undefined) {
    throw new AuthError('GRANT_UNKNOWN');
  }
  if (record.issuer !== issuer) {
    throw new AuthError('GRANT_POLICY');
  }
  if (record.action !== action) {
    throw new AuthError('GRANT_ACTION');
  }
  if (record.released) {
    throw new AuthError('GRANT_RELEASED');
  }
}

// Does:  Makes a frozen policy holding a shallow copy of its options, without judging its name.
export function buildPolicy<N extends string, I extends { readonly [key: string]: Schema }, R, K extends string>(
  name: N,
  options: PolicyOptions<I, R, K>,
): Policy<N, I, R, K> {
  const policy: Policy<N, I, R, K> = {
    name,
    options: Object.freeze({ ...options }),
    operation(action, body) {
      return (grant, ...args) => {
        checkGrant(policy, action, grant);
        return body(grant, ...args);
      };
    },
  };
  Object.freeze(policy);
  markDefined(policy);
  return policy;
}
