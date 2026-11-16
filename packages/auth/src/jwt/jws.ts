// Does:  Reads a compact JWS, applies the header rules every verified token shares and checks its signature and times.
// Holds: A header that names its own key or critical extensions is never read further, and times use the process clock.

import { verify } from 'node:crypto';
import type { VerifyKey } from '../outbound/jwk.ts';
import { type JsonObject, parseJsonObject } from '../outbound/outbound.ts';

const BASE64URL = /^[A-Za-z0-9_-]+$/;
// Why: RFC 7515 sections 4.1.2 to 4.1.6 and 4.1.11 let a header carry or point at its own key or demand extensions.
const REFUSED_MEMBERS = ['jku', 'x5u', 'jwk', 'x5c', 'crit'];
const SKEW_SECONDS = 60;
// Why: RFC 7518 section 3.4 fixes an ES256 signature as R and S of 32 bytes each.
const ES256_SIGNATURE_BYTES = 64;

export interface Jws {
  readonly alg: string;
  readonly kid: string;
  readonly payload: JsonObject;
  readonly signingInput: string;
  readonly signature: Buffer;
}

// Does:  Splits and decodes a token whose header names a string alg, a non-empty kid and no refused member; else null.
export function readJws(token: string): Jws | null {
  const parts = token.split('.');
  if (parts.length !== 3 || !parts.every((part) => BASE64URL.test(part))) {
    return null;
  }
  const [head = '', body = '', signature = ''] = parts;
  const header = parseJsonObject(Buffer.from(head, 'base64url'));
  const payload = parseJsonObject(Buffer.from(body, 'base64url'));
  if (header === null || payload === null || REFUSED_MEMBERS.some((name) => Object.hasOwn(header, name))) {
    return null;
  }
  const { alg, kid } = header;
  if (typeof alg !== 'string' || typeof kid !== 'string' || kid === '') {
    return null;
  }
  return { alg, kid, payload, signingInput: `${head}.${body}`, signature: Buffer.from(signature, 'base64url') };
}

// Does:  Checks the signature with the key the kid selected, which must be of the algorithm the header names.
export function signatureHolds(jws: Jws, key: VerifyKey): boolean {
  if (key.alg !== jws.alg) {
    return false;
  }
  if (key.alg === 'ES256') {
    return (
      jws.signature.length === ES256_SIGNATURE_BYTES &&
      verify('sha256', Buffer.from(jws.signingInput), { key: key.key, dsaEncoding: 'ieee-p1363' }, jws.signature)
    );
  }
  return verify('sha256', Buffer.from(jws.signingInput), key.key, jws.signature);
}

// Does:  Checks exp (required), nbf (when present) and iat (when required) against now with 60 s of skew.
export function timesHold(payload: JsonObject, iatRequired: boolean): boolean {
  const now = Date.now() / 1_000;
  const { exp, nbf, iat } = payload;
  if (typeof exp !== 'number' || now > exp + SKEW_SECONDS) {
    return false;
  }
  if (nbf !== undefined && (typeof nbf !== 'number' || nbf > now + SKEW_SECONDS)) {
    return false;
  }
  if (iatRequired) {
    return typeof iat === 'number' && iat <= now + SKEW_SECONDS;
  }
  return true;
}
