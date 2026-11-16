// Does:  Keeps the process-wide registries of defined policies, verified principals and issued grants.
// Holds: Membership is the only proof: a copy, a clone or a look-alike of a registered value is never a member.

import type { Grant, Principal } from './types.ts';

// Does:  What the registry knows of an issued grant: who issued it, for which action, and whether it was released.
export interface GrantRecord {
  readonly issuer: object;
  readonly action: string;
  released: boolean;
}

const policies = new WeakSet<object>();
const principals = new WeakSet<object>();
const grants = new WeakMap<object, GrantRecord>();

// Does:  Freezes a value and every object reachable through its own properties.
function deepFreeze(value: object): void {
  const pending: object[] = [value];
  for (let next = pending.pop(); next !== undefined; next = pending.pop()) {
    if (Object.isFrozen(next)) {
      continue;
    }
    Object.freeze(next);
    for (const key of Reflect.ownKeys(next)) {
      const member: unknown = Object.getOwnPropertyDescriptor(next, key)?.value;
      if (typeof member === 'object' && member !== null) {
        pending.push(member);
      }
    }
  }
}

// Does:  Deep-freezes a principal and adds it to the registry, the only thing that makes a value a principal.
export function registerPrincipal<T extends Principal>(principal: T): T {
  deepFreeze(principal);
  principals.add(principal);
  return principal;
}

export function hasPrincipal(value: unknown): value is Principal {
  return typeof value === 'object' && value !== null && principals.has(value);
}

export function markDefined(policy: object): void {
  policies.add(policy);
}

export function isDefined(value: unknown): value is object {
  return typeof value === 'object' && value !== null && policies.has(value);
}

// Does:  Registers a frozen grant as issued by one policy for one action, live until it is released.
export function issueGrant(grant: Grant<string, string, unknown>, issuer: object): void {
  grants.set(grant, { issuer, action: grant.action, released: false });
}

export function grantRecord(value: unknown): GrantRecord | undefined {
  return typeof value === 'object' && value !== null ? grants.get(value) : undefined;
}
