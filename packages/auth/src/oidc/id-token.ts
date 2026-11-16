// Does:  Verifies a provider's ID Token: RS256 under a key of its key set, issuer, audience, nonce, subject and times.
// Holds: Claims are returned only from a token that passed every check; nothing of a refused token is kept.

import { readJws, signatureHolds, timesHold } from '../jwt/jws.ts';
import { findKey, type UnavailableReason } from '../outbound/cache.ts';
import type { ConfiguredUrl, JsonObject } from '../outbound/outbound.ts';
import type { ProviderPolicy } from './options.ts';

// Why: The supported profile's subject: 1 to 255 characters from U+0020 to U+007E.
const SUBJECT = /^[\x20-\x7e]{1,255}$/;

export type IdTokenCheck =
  | { readonly kind: 'verified'; readonly subject: string; readonly claims: JsonObject }
  | { readonly kind: 'refused' }
  | { readonly kind: 'unavailable'; readonly reason: UnavailableReason };

const REFUSED: IdTokenCheck = Object.freeze({ kind: 'refused' });

function audienceHolds(aud: unknown, clientId: string): boolean {
  return aud === clientId || (Array.isArray(aud) && aud.length === 1 && aud[0] === clientId);
}

export async function verifyIdToken(
  token: string,
  provider: ProviderPolicy,
  jwksUri: ConfiguredUrl,
  nonce: string,
): Promise<IdTokenCheck> {
  const jws = readJws(token);
  if (jws === null || jws.alg !== 'RS256') {
    return REFUSED;
  }
  const found = await findKey(jwksUri, jws.kid);
  if (found.kind === 'unavailable') {
    return found;
  }
  if (found.kind === 'unknown' || !signatureHolds(jws, found.key)) {
    return REFUSED;
  }
  const { payload } = jws;
  const { iss, aud, azp, sub } = payload;
  if (
    iss !== provider.issuer ||
    !audienceHolds(aud, provider.clientId) ||
    (azp !== undefined && azp !== provider.clientId) ||
    !timesHold(payload, true) ||
    payload.nonce !== nonce ||
    typeof sub !== 'string' ||
    !SUBJECT.test(sub)
  ) {
    return REFUSED;
  }
  return { kind: 'verified', subject: sub, claims: payload };
}
