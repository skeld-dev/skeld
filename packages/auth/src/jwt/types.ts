// Does:  Declares the JWT part's options, keys and the application's claims map.
// Holds: The map receives only claims that passed every check; it never sees a token that failed one.

import type { JwtPart } from '../server/internal-types.ts';

/**
 * The options of `jwt`: one issuer, one audience, the accepted algorithms and exactly one of `keys` and `jwksUrl`.
 * The gate's boot refuses any other shape with BootError `GATE_FAILED`; there is no signing or refresh.
 */
export interface JwtOptions {
  /** The one accepted `iss`. */
  readonly issuer: string;
  /** The one accepted `aud`. */
  readonly audience: string;
  /** The accepted algorithms, at least one. */
  readonly algorithms: readonly ('RS256' | 'ES256')[];
  /** The verification keys, each with a `kid`. */
  readonly keys?: readonly Jwk[];
  /** An `https` URL of the key set, fetched at first use. */
  readonly jwksUrl?: string;
  /** Maps verified claims to a user, under 5,000 ms. */
  readonly map: JwtMap;
}

/** A JSON Web Key; its type fixes its algorithm: RSA of at least 2,048 bits is RS256, P-256 is ES256. */
export interface Jwk {
  /** The key type. */
  readonly kty: string;
  /** The key id. */
  readonly kid: string;
  /** The algorithm, which must agree with the key type. */
  readonly alg?: string;
  /** The key's other members. */
  readonly [member: string]: unknown;
}

/** Maps a verified token's issuer, subject and claims to a user, or denies it. */
export type JwtMap = (
  verified: {
    readonly issuer: string;
    readonly subject: string;
    readonly claims: { readonly [name: string]: unknown };
  },
  signal: AbortSignal,
) => JwtMapped | Promise<JwtMapped>;

/** The answer of a `JwtMap`. */
export type JwtMapped =
  | {
      /** Whether the token is accepted or denied. */
      readonly kind: 'accept';
      /** The user the token acts for, or `null` when it acts for no user. */
      readonly userId: string | null;
    }
  | { readonly kind: 'deny' };

/** The JWT part given to `createAuth`. */
export type Jwt = JwtPart;
