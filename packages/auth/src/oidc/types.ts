// Does:  Declares the OIDC part's options, providers, handlers and the identity handed to the application.
// Holds: An identity is its issuer and subject; the email claim is carried and never compared.

import type { Handlers } from '@skeld/core/server';
import type { Secret } from '@skeld/core/secret';
import type { OidcRoutes } from '../routes/routes.ts';
import type { OidcPart } from '../server/internal-types.ts';

/**
 * The options of `oidc`: 1 to 16 providers, the failure and return paths and the application's user mapper.
 * The gate's boot refuses a bad option with BootError `GATE_FAILED`; both paths are local paths with no query.
 */
export interface OidcOptions {
  /** The providers by name: 1 to 32 characters of `a-z` and `0-9`, a letter first. */
  readonly providers: { readonly [name: string]: OidcProvider };
  /** Where a failed callback redirects, with `provider` and `error` added to its query. */
  readonly failurePath: string;
  /** Where a start without `returnTo` returns (default `/`). */
  readonly returnPath?: string;
  /** Maps a verified identity to a user, under 5,000 ms. */
  readonly resolveUser: OidcResolveUser;
}

/** One provider; its issuer is unique among the providers. */
export interface OidcProvider {
  /** An `https` URL of at most 255 characters, with no query, fragment or userinfo. */
  readonly issuer: string;
  /** The client id, 1 to 255 characters of U+0021 to U+007E. */
  readonly clientId: string;
  /** The client secret, 1 to 512 characters, sent with `client_secret_basic`. */
  readonly clientSecret: Secret<string>;
  /** Scopes beyond `openid`, which is always sent: at most 16 of 1 to 64 characters. */
  readonly scopes?: readonly string[];
}

/** The OIDC part given to `createAuth`, with the handlers of `oidcRoutes`. */
export interface Oidc extends OidcPart {
  /** The handlers of the start and callback routes. */
  readonly handlers: Handlers<OidcRoutes>;
}

/** A verified identity: a provider's issuer and subject, with selected claims. */
export interface OidcIdentity {
  /** The provider's name. */
  readonly provider: string;
  /** The provider's issuer. */
  readonly issuer: string;
  /** The subject at that issuer. */
  readonly subject: string;
  /** Selected claims of the ID Token. */
  readonly claims: OidcClaims;
}

/** Selected claims of a verified ID Token. */
export interface OidcClaims {
  /** The `email` claim when a string of 1 to 254 characters, else `null`; compared with nothing. */
  readonly email: string | null;
  /** True only for the JSON boolean `true` beside a non-null `email`. */
  readonly emailVerified: boolean;
  /** The `name` claim when a string of 1 to 256 characters, else `null`. */
  readonly name: string | null;
  /** Every claim of the ID Token. */
  readonly all: { readonly [claim: string]: unknown };
}

/** Maps a verified identity to a user, or denies it; called twice, and both answers must name the same user. */
export type OidcResolveUser = (identity: OidcIdentity, signal: AbortSignal) => OidcResolution | Promise<OidcResolution>;

/** The answer of an `OidcResolveUser`. */
export type OidcResolution =
  | {
      /** Whether the identity signs in as a user or is denied. */
      readonly kind: 'user';
      /** The user the identity signs in as. */
      readonly userId: string;
    }
  | { readonly kind: 'deny' };
