// Does:  Checks the JWT part's options at boot and resolves them into the verifier's fixed policy.
// Holds: A checked policy has one issuer, one audience, known algorithms and usable static keys or an https key set.

import { importJwk, type KeySet, type VerifyKey } from '../outbound/jwk.ts';
import { type ConfiguredUrl, configuredUrl, isJsonObject } from '../outbound/outbound.ts';
import { OptionFault } from '../server/option-fault.ts';
import { firstUnknownKey } from '../server/unknown-key.ts';
import type { JwtMap, JwtOptions } from './types.ts';

const OPTION_KEYS = new Set(['issuer', 'audience', 'algorithms', 'keys', 'jwksUrl', 'map']);
const ALGORITHMS = new Set(['RS256', 'ES256']);
const MAX_KEYS = 32;
const MAX_TEXT = 255;

export interface JwtPolicy {
  readonly issuer: string;
  readonly audience: string;
  readonly algorithms: ReadonlySet<string>;
  readonly source:
    | { readonly kind: 'keys'; readonly keys: KeySet }
    | { readonly kind: 'url'; readonly url: ConfiguredUrl };
  readonly map: JwtMap;
}

function fault(finding: string): OptionFault {
  return new OptionFault('jwt', finding);
}

function bounded(value: unknown, path: string): string {
  if (typeof value !== 'string' || value.length < 1 || value.length > MAX_TEXT) {
    throw fault(`${path}: must be a string of 1 to 255 characters`);
  }
  return value;
}

function checkAlgorithms(value: unknown): ReadonlySet<string> {
  const list: readonly unknown[] = Array.isArray(value) ? value : [];
  if (list.length === 0 || !list.every((alg) => typeof alg === 'string' && ALGORITHMS.has(alg))) {
    throw fault('jwt.algorithms: must be a non-empty list of RS256 and ES256');
  }
  return new Set(list.map(String));
}

function checkKeys(value: unknown): KeySet {
  const list: readonly unknown[] = Array.isArray(value) ? value : [];
  if (list.length === 0 || list.length > MAX_KEYS) {
    throw fault('jwt.keys: must be a list of 1 to 32 keys');
  }
  const keys = new Map<string, VerifyKey>();
  list.forEach((member, index) => {
    const imported = isJsonObject(member) ? importJwk(member) : null;
    if (imported?.kind === 'refused' && imported.reason === 'alg') {
      throw fault(`jwt.keys[${index}]: alg disagrees with the key type`);
    }
    if (imported?.kind !== 'key') {
      throw fault(`jwt.keys[${index}]: must be an RSA key of at least 2,048 bits or a P-256 key, with a kid, for sig`);
    }
    if (keys.has(imported.key.kid)) {
      throw fault(`jwt.keys[${index}]: repeats a kid`);
    }
    keys.set(imported.key.kid, imported.key);
  });
  return keys;
}

export function checkJwtOptions(options: JwtOptions): JwtPolicy {
  const value: unknown = options;
  if (!isJsonObject(value)) {
    throw fault('jwt: must be an object');
  }
  const unknown = firstUnknownKey(value, OPTION_KEYS);
  if (unknown !== null) {
    throw fault(`jwt.${unknown}: is not a key of JwtOptions`);
  }
  const { keys, jwksUrl } = value;
  const { map } = options;
  if ((keys === undefined) === (jwksUrl === undefined)) {
    throw fault('jwt: must have exactly one of keys and jwksUrl');
  }
  const url = typeof jwksUrl === 'string' ? configuredUrl(jwksUrl) : null;
  if (keys === undefined && url === null) {
    throw fault('jwt.jwksUrl: must be an https URL of at most 2,048 characters with no userinfo or fragment');
  }
  if (typeof map !== 'function') {
    throw fault('jwt.map: must be a function');
  }
  const policy: JwtPolicy = {
    issuer: bounded(value.issuer, 'jwt.issuer'),
    audience: bounded(value.audience, 'jwt.audience'),
    algorithms: checkAlgorithms(value.algorithms),
    source: url === null ? { kind: 'keys', keys: checkKeys(keys) } : { kind: 'url', url },
    map,
  };
  return Object.freeze(policy);
}
