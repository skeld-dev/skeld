// Does:  Checks auth's options at boot and resolves them with their defaults.
// Holds: A refused option throws OptionFault naming its path and rule, never the value it was given.

import { isIPv4 } from 'node:net';
import type { LimitRule } from '../limit/types.ts';
import { isAccessName } from '../policy/access-name.ts';
import type { AnyPolicy } from '../policy/types.ts';
import type { AuthStore } from '../store/types.ts';
import type { ApiKeyPart, JwtPart, OidcPart } from './internal-types.ts';
import { OptionFault } from './option-fault.ts';
import { firstUnknownKey } from './unknown-key.ts';
import type { AuthOptions } from './types.ts';

const HTTP_TOKEN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;
const COOKIE_PREFIX = '__Host-';
const MAX_COOKIE_NAME = 64;
const MAX_LIFETIME_SECONDS = 2_592_000;
const MAX_SCOPES = 32;
const DEFAULT_ADDRESS_LIMIT: LimitRule = Object.freeze({ max: 10, windowSeconds: 60 });

// Does:  A session's cookie name and lifetimes, each in the unit the store and the cookie take.
export interface SessionConfig {
  readonly cookieName: string;
  readonly idleMs: number;
  readonly absoluteMs: number;
  readonly absoluteSeconds: number;
  readonly renewMs: number;
}

export interface CheckedOptions {
  readonly store: AuthStore;
  readonly origin: string;
  readonly policies: readonly AnyPolicy[];
  readonly session: SessionConfig;
  readonly rules: { readonly [scope: string]: LimitRule };
  readonly addressLimit: LimitRule;
  readonly apiKeys: ApiKeyPart | null;
  readonly jwt: JwtPart | null;
  readonly oidc: OidcPart | null;
}

function isObject(value: unknown): value is { readonly [key: string]: unknown } {
  return typeof value === 'object' && value !== null;
}

function isInteger(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= min && value <= max;
}

function checkKeys(value: object, known: ReadonlySet<string>, component: string, path: string, type: string): void {
  const key = firstUnknownKey(value, known);
  if (key !== null) {
    throw new OptionFault(component, `${path}${key}: is not a key of ${type}`);
  }
}

const AUTH_OPTION_KEYS: ReadonlySet<string> = new Set([
  'store',
  'origin',
  'policies',
  'session',
  'limits',
  'addressLimit',
  'apiKeys',
  'jwt',
  'oidc',
]);
const SESSION_KEYS: ReadonlySet<string> = new Set(['cookieName', 'idleSeconds', 'absoluteSeconds', 'renewSeconds']);
const RULE_KEYS: ReadonlySet<string> = new Set(['max', 'windowSeconds']);

function checkStore(store: AuthStore): AuthStore {
  const value: unknown = store;
  if (
    !isObject(value) ||
    typeof value.install !== 'function' ||
    typeof value.attach !== 'function' ||
    typeof value.close !== 'function' ||
    !isObject(value.ops)
  ) {
    throw new OptionFault('store', 'store: must be an auth store');
  }
  return store;
}

function isLoopback(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '[::1]' || (isIPv4(hostname) && hostname.startsWith('127.'));
}

function checkOrigin(value: unknown): string {
  const parsed = typeof value === 'string' && URL.canParse(value) ? new URL(value) : null;
  if (
    parsed === null ||
    parsed.origin !== value ||
    !(parsed.protocol === 'https:' || (parsed.protocol === 'http:' && isLoopback(parsed.hostname)))
  ) {
    throw new OptionFault('origin', 'origin: must be an origin, https or http on a loopback host');
  }
  return value;
}

function checkSession(value: unknown): SessionConfig {
  if (value !== undefined && !isObject(value)) {
    throw new OptionFault('session', 'session: must be an object');
  }
  if (value !== undefined) {
    checkKeys(value, SESSION_KEYS, 'session', 'session.', 'SessionOptions');
  }
  const cookieName = value?.cookieName === undefined ? '__Host-skeld' : value.cookieName;
  const idle = value?.idleSeconds === undefined ? 3_600 : value.idleSeconds;
  const absolute = value?.absoluteSeconds === undefined ? 86_400 : value.absoluteSeconds;
  if (
    typeof cookieName !== 'string' ||
    !cookieName.startsWith(COOKIE_PREFIX) ||
    cookieName.length > MAX_COOKIE_NAME ||
    !HTTP_TOKEN.test(cookieName)
  ) {
    throw new OptionFault('session', 'session.cookieName: must be __Host- and an HTTP token of at most 64 characters');
  }
  if (!isInteger(idle, 2, MAX_LIFETIME_SECONDS)) {
    throw new OptionFault('session', 'session.idleSeconds: must be an integer from 2 to 2,592,000');
  }
  if (!isInteger(absolute, idle, MAX_LIFETIME_SECONDS)) {
    throw new OptionFault('session', 'session.absoluteSeconds: must be an integer from idleSeconds to 2,592,000');
  }
  const half = Math.floor(idle / 2);
  const renew = value?.renewSeconds === undefined ? Math.min(300, half) : value.renewSeconds;
  if (!isInteger(renew, 1, half)) {
    throw new OptionFault('session', 'session.renewSeconds: must be an integer from 1 to half of idleSeconds');
  }
  return Object.freeze({
    cookieName,
    idleMs: idle * 1000,
    absoluteMs: absolute * 1000,
    absoluteSeconds: absolute,
    renewMs: renew * 1000,
  });
}

function checkRule(value: unknown, path: string): LimitRule {
  if (isObject(value)) {
    checkKeys(value, RULE_KEYS, 'limits', `${path}.`, 'LimitRule');
  }
  if (!isObject(value) || !isInteger(value.max, 1, 1_000_000) || !isInteger(value.windowSeconds, 1, 86_400)) {
    throw new OptionFault('limits', `${path}: must be a rule of max 1 to 1,000,000 and windowSeconds 1 to 86,400`);
  }
  return Object.freeze({ max: value.max, windowSeconds: value.windowSeconds });
}

function checkLimits(value: unknown): { readonly [scope: string]: LimitRule } {
  if (value === undefined) {
    return Object.freeze({});
  }
  if (!isObject(value) || Array.isArray(value)) {
    throw new OptionFault('limits', 'limits: must be an object of rules by scope');
  }
  const scopes = Reflect.ownKeys(value);
  if (scopes.length > MAX_SCOPES) {
    throw new OptionFault('limits', 'limits: must hold at most 32 scopes');
  }
  const rules: { [scope: string]: LimitRule } = {};
  for (const scope of scopes) {
    if (!isAccessName(scope) || scope.startsWith('auth.')) {
      throw new OptionFault('limits', 'limits: each scope must be an access name not starting auth.');
    }
    rules[scope] = checkRule(value[scope], `limits.${scope}`);
  }
  return Object.freeze(rules);
}

function checkPart<T extends ApiKeyPart | JwtPart | OidcPart>(
  part: T | undefined,
  kind: T['kind'],
  option: string,
): T | null {
  const value: unknown = part;
  if (part === undefined) {
    return null;
  }
  if (!isObject(value) || value.kind !== kind || typeof value.attach !== 'function') {
    throw new OptionFault(kind, `${option}: must be the value of ${option}()`);
  }
  return part;
}

// Does:  Checks every option in a fixed order, then that origin is one of the server's public origins.
export function checkOptions(
  options: AuthOptions<readonly AnyPolicy[], string>,
  publicOrigin: readonly string[],
): CheckedOptions {
  const value: unknown = options;
  if (!isObject(value)) {
    throw new OptionFault('options', 'options: must be an object');
  }
  checkKeys(value, AUTH_OPTION_KEYS, 'options', '', 'AuthOptions');
  const store = checkStore(options.store);
  const origin = checkOrigin(options.origin);
  const session = checkSession(options.session);
  const rules = checkLimits(options.limits);
  const addressLimit =
    options.addressLimit === undefined ? DEFAULT_ADDRESS_LIMIT : checkRule(options.addressLimit, 'addressLimit');
  const apiKeys = checkPart(options.apiKeys, 'api_key', 'apiKeys');
  const jwt = checkPart(options.jwt, 'jwt', 'jwt');
  const oidc = checkPart(options.oidc, 'oidc', 'oidc');
  if (!publicOrigin.includes(origin)) {
    throw new OptionFault('origin', "not one of the server's publicOrigin");
  }
  // Why: bindPolicies judges the tuple, a null one included, at its own boot step after the store is attached.
  const policies = options.policies === undefined ? [] : options.policies;
  return Object.freeze({ store, origin, policies, session, rules, addressLimit, apiKeys, jwt, oidc });
}
