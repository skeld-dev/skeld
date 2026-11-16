// Does:  Exports @skeld/auth/policy: definePolicy, and the registry tests isPrincipal and isGrant, with their types.
// Holds: This file's exports are the subpath's whole public surface; a principal or grant is proven by membership only.

import { isAccessName } from './access-name.ts';
import { buildPolicy } from './define.ts';
import { grantRecord, hasPrincipal } from './registry.ts';
import type { DefinePolicy, Grant, Principal } from './types.ts';

export type {
  AnyPolicy,
  ApiKeyPrincipal,
  CredentialKind,
  DefinePolicy,
  Grant,
  JwtPrincipal,
  Policy,
  PolicyOptions,
  Principal,
  SessionPrincipal,
} from './types.ts';

/**
 * Defines a frozen policy; each grant it issues carries its principal's authority until its request ends, even shared.
 * Throws `TypeError` for a bad or `auth.`-prefixed name; an operation acts on `grant.resource` and checks no id argument.
 * @example definePolicy('doc', { credentials: ['session'], actions: { read: () => true } })
 */
export const definePolicy: DefinePolicy = (name, options) => {
  if (!isAccessName(name) || name.startsWith('auth.')) {
    throw new TypeError('definePolicy: name must be an access name that does not start with auth.');
  }
  return buildPolicy(name, options);
};

/**
 * Tells whether a value is a principal auth admitted, by registry membership; a copy is never one.
 * @example isPrincipal({ kind: 'session', userId: 'u1', createdAt: 0, expiresAt: 0 })
 */
export function isPrincipal(value: unknown): value is Principal {
  return hasPrincipal(value);
}

/**
 * Tells whether a value is a grant auth issued and has not released, by registry membership; a clone is never one.
 * @example isGrant({ policy: 'documents', action: 'read', resource: null })
 */
export function isGrant(value: unknown): value is Grant<string, string, unknown> {
  const record = grantRecord(value);
  return record !== undefined && !record.released;
}
