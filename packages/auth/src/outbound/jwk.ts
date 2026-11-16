// Does:  Turns JSON Web Keys and key sets into public verification keys, naming why a key cannot verify.
// Holds: Only an RSA key of at least 2,048 bits (RS256) or a P-256 key (ES256) for signatures becomes a key.

import { createPublicKey, type KeyObject, type webcrypto } from 'node:crypto';
import { isJsonObject, type JsonObject } from './outbound.ts';

const MIN_RSA_BITS = 2_048;
const MAX_KEYS = 32;

export interface VerifyKey {
  readonly kid: string;
  readonly alg: 'RS256' | 'ES256';
  readonly key: KeyObject;
}

export type KeyRefusal = 'kid' | 'use' | 'type' | 'alg' | 'size' | 'data';

export type ImportedKey =
  | { readonly kind: 'key'; readonly key: VerifyKey }
  | { readonly kind: 'refused'; readonly reason: KeyRefusal };

export type KeySet = ReadonlyMap<string, VerifyKey>;

export function importJwk(member: JsonObject): ImportedKey {
  const { kid, use, kty } = member;
  if (typeof kid !== 'string' || kid === '') {
    return refused('kid');
  }
  if (use !== undefined && use !== 'sig') {
    return refused('use');
  }
  if (kty === 'RSA') {
    return importRsa(kid, member);
  }
  if (kty === 'EC' && member.crv === 'P-256') {
    return importEc(kid, member);
  }
  return refused('type');
}

function importRsa(kid: string, member: JsonObject): ImportedKey {
  const { alg, n, e } = member;
  if (alg !== undefined && alg !== 'RS256') {
    return refused('alg');
  }
  if (typeof n !== 'string' || typeof e !== 'string') {
    return refused('data');
  }
  const key = publicKey({ kty: 'RSA', n, e });
  if (key === null) {
    return refused('data');
  }
  const bits = key.asymmetricKeyDetails?.modulusLength;
  if (bits === undefined || bits < MIN_RSA_BITS) {
    return refused('size');
  }
  return { kind: 'key', key: { kid, alg: 'RS256', key } };
}

function importEc(kid: string, member: JsonObject): ImportedKey {
  const { alg, x, y } = member;
  if (alg !== undefined && alg !== 'ES256') {
    return refused('alg');
  }
  if (typeof x !== 'string' || typeof y !== 'string') {
    return refused('data');
  }
  const key = publicKey({ kty: 'EC', crv: 'P-256', x, y });
  return key === null ? refused('data') : { kind: 'key', key: { kid, alg: 'ES256', key } };
}

// Does:  Reads a key set's usable keys by kid; null refuses the whole set.
// Holds: A set of more than 32 entries, an entry that is not an object or a repeated kid yields null.
export function parseKeySet(body: JsonObject): KeySet | null {
  const { keys } = body;
  if (!Array.isArray(keys) || keys.length > MAX_KEYS) {
    return null;
  }
  const entries: readonly unknown[] = keys;
  const seen = new Set<string>();
  const usable = new Map<string, VerifyKey>();
  for (const member of entries) {
    if (!isJsonObject(member)) {
      return null;
    }
    const { kid } = member;
    if (typeof kid === 'string') {
      if (seen.has(kid)) {
        return null;
      }
      seen.add(kid);
    }
    const imported = importJwk(member);
    if (imported.kind === 'key') {
      usable.set(imported.key.kid, imported.key);
    }
  }
  return usable;
}

function refused(reason: KeyRefusal): ImportedKey {
  return { kind: 'refused', reason };
}

function publicKey(jwk: webcrypto.JsonWebKey): KeyObject | null {
  try {
    return createPublicKey({ key: jwk, format: 'jwk' });
  } catch (error) {
    // Why: Every throw of createPublicKey on a JWK of fixed members is a refusal of the key material itself.
    if (error instanceof Error) {
      return null;
    }
    throw error;
  }
}
