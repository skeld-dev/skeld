// Does:  Builds the shared limiter: one atomic store charge per call on the digest of an internal scope and a key.
// Holds: Every key and scope is checked before the store is called, and a store failure is Unavailable, never a pass.

import { createHash } from 'node:crypto';
import { isIPv4, isIPv6 } from 'node:net';
import type { GateRequest } from '@skeld/core/gate';
import type { Logger } from '@skeld/core/log';
import { AuthError } from '../auth-error/auth-error.ts';
import type { Principal } from '../policy/types.ts';
import { firstUnknownKey } from '../server/unknown-key.ts';
import { storeUnavailable } from '../store/unavailable.ts';
import type { InternalLimits, LimitKey, LimitRule, LimitsConfig, LimitVerdict } from './types.ts';

const MAX_KEY_LENGTH = 256;
const KEY_OBJECT_KEYS: ReadonlySet<string> = new Set(['clientAddress']);
const ZERO = new Uint8Array(1);

const NOT_APPLIED: LimitVerdict = Object.freeze({ kind: 'unavailable', outcome: 'not_applied' });

// Does:  Expands an address that isIPv6 accepted to its eight 16-bit groups.
function ipv6Groups(address: string): number[] {
  const zone = address.indexOf('%');
  let text = zone === -1 ? address : address.slice(0, zone);
  const lastColon = text.lastIndexOf(':');
  const last = text.slice(lastColon + 1);
  if (isIPv4(last)) {
    const [a = 0, b = 0, c = 0, d = 0] = last.split('.').map(Number);
    text = `${text.slice(0, lastColon + 1)}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const [head = '', rest] = text.split('::');
  const first = head === '' ? [] : head.split(':');
  const second = rest === undefined || rest === '' ? [] : rest.split(':');
  const fill = rest === undefined ? [] : new Array<string>(8 - first.length - second.length).fill('0');
  return [...first, ...fill, ...second].map((group) => Number.parseInt(group, 16));
}

// Does:  Returns the counted text of a client address (an IPv4 address or an IPv6 /64), or null when it is not an IP.
function addressText(address: string): string | null {
  if (isIPv4(address)) {
    return address;
  }
  if (!isIPv6(address)) {
    return null;
  }
  const groups = ipv6Groups(address);
  // Why: An IPv4-mapped address (::ffff:0:0/96, RFC 4291 section 2.5.5.2) is the IPv4 client, not one shared /64.
  if (groups.slice(0, 5).every((group) => group === 0) && groups[5] === 0xffff) {
    const [, , , , , , high = 0, low = 0] = groups;
    return `${high >> 8}.${high & 0xff}.${low >> 8}.${low & 0xff}`;
  }
  return groups
    .slice(0, 4)
    .map((group) => group.toString(16))
    .join(':');
}

function keyText(key: LimitKey): string {
  if (typeof key === 'string') {
    if (key.length === 0 || key.length > MAX_KEY_LENGTH) {
      throw new AuthError('INVALID_INPUT');
    }
    return key;
  }
  const given: unknown = key;
  if (typeof given !== 'object' || given === null || firstUnknownKey(given, KEY_OBJECT_KEYS) !== null) {
    throw new AuthError('INVALID_INPUT');
  }
  const text = addressText(key.clientAddress);
  if (text === null) {
    throw new AuthError('INVALID_INPUT');
  }
  return text;
}

// Why: The same id under two credential kinds names two holders, so the kind is part of the counted text.
function principalText(principal: Principal): string {
  switch (principal.kind) {
    case 'session':
      return `session:${principal.userId}`;
    case 'api_key':
      return `api_key:${principal.keyId}`;
    case 'jwt':
      return `jwt:${principal.subject}`;
  }
}

function counterKey(scope: string, text: string): Uint8Array {
  return new Uint8Array(createHash('sha256').update(scope).update(ZERO).update(text).digest());
}

// Does:  Builds the limiter the auth centre gives its parts and wraps for the application.
export function createLimits(config: LimitsConfig): InternalLimits {
  const { store, events } = config;

  // Does:  Charges one key in one internal scope; a bad key or an undeclared rule rejects before the store is called.
  async function chargeOnce(
    scope: string,
    rule: LimitRule | undefined,
    keyOf: () => string,
    request: { readonly log: Logger; readonly signal?: AbortSignal | undefined },
    reportRefusal: boolean,
  ): Promise<LimitVerdict> {
    if (rule === undefined) {
      throw new AuthError('INVALID_INPUT');
    }
    const key = counterKey(scope, keyOf());
    let result: Awaited<ReturnType<typeof store.limitCharge>>;
    try {
      result = await store.limitCharge({ key, max: rule.max, windowMs: rule.windowSeconds * 1000 }, request.signal);
    } catch (error) {
      return storeUnavailable(events, request.log, error);
    }
    if (result.kind === 'done') {
      return Object.freeze({ kind: 'pass', remaining: rule.max - result.count, resetAt: result.resetAt });
    }
    if (reportRefusal) {
      events.limitRefused(request.log, { 'auth.limit': scope });
    }
    return Object.freeze({ kind: 'limited', retryAfterSeconds: Math.max(1, Math.ceil(result.retryAfterMs / 1000)) });
  }

  return Object.freeze({
    charge(scope: string, key: LimitKey, signal?: AbortSignal): Promise<LimitVerdict> {
      const rule = Object.hasOwn(config.rules, scope) ? config.rules[scope] : undefined;
      return chargeOnce(`app.${scope}`, rule, () => keyText(key), { log: config.log, signal }, false);
    },
    address(
      routeName: string,
      request: { readonly clientAddress: string; readonly log: Logger; readonly signal: AbortSignal },
    ): Promise<LimitVerdict> {
      const text = addressText(request.clientAddress);
      // Why: Core gives an empty address once the socket has closed; auth's own route answers it as unavailable.
      if (text === null) {
        return Promise.resolve(NOT_APPLIED);
      }
      return chargeOnce(`auth.address.${routeName}`, config.addressLimit, () => text, request, true);
    },
    policy(policy: string, rule: LimitRule, principal: Principal, request: GateRequest): Promise<LimitVerdict> {
      return chargeOnce(`auth.policy.${policy}`, rule, () => principalText(principal), request, true);
    },
  });
}
