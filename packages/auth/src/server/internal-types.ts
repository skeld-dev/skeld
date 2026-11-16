// Does:  Declares the seams between the auth centre and its parts: what a part receives and returns, and the events.
// Holds: A part reaches the store, sessions, limits and events only through PartDeps, never through lane A's files.

import type { GateRequest, SecurityEvent } from '@skeld/core/gate';
import type { Logger } from '@skeld/core/log';
import type { InternalLimits } from '../limit/types.ts';
import type { ApiKeyPrincipal, JwtPrincipal } from '../policy/types.ts';
import type { Established, EstablishInput } from '../session/types.ts';
import type { StoreOperations } from '../store/types.ts';

// Does:  The API-key part; attach runs once inside the gate's boot and throws OptionFault for a bad option.
export interface ApiKeyPart {
  readonly kind: 'api_key';
  attach(deps: PartDeps): BearerVerifier;
}

// Does:  The JWT part; attach runs once inside the gate's boot and throws OptionFault for a bad option.
export interface JwtPart {
  readonly kind: 'jwt';
  attach(deps: PartDeps): BearerVerifier;
}

// Does:  The OIDC part; attach runs once inside the gate's boot and throws OptionFault for a bad option.
export interface OidcPart {
  readonly kind: 'oidc';
  attach(deps: PartDeps): void;
}

// Does:  The handoff for a sign-in a part completed; its records carry the provider the part was configured with.
export interface PartSessions {
  establish(input: EstablishInput, provider: string): Promise<Established>;
}

// Holds: signal aborts when shutdown begins.
export interface PartDeps {
  readonly store: StoreOperations;
  readonly sessions: PartSessions;
  readonly limits: InternalLimits;
  readonly events: AuthEvents;
  readonly log: Logger;
  readonly signal: AbortSignal;
  readonly origin: string;
  readonly cookieName: string;
  readonly onClose: (callback: () => void | Promise<void>) => void;
}

// Holds: A verifier never tries a token as another kind.
export interface BearerVerifier {
  verify(token: string, request: GateRequest): Promise<BearerVerdict>;
}

export type BearerVerdict =
  | { readonly kind: 'verified'; readonly principal: ApiKeyPrincipal | JwtPrincipal }
  | { readonly kind: 'invalid' }
  | { readonly kind: 'unavailable' };

// Holds: No lane writes an auth.* record other than through these ten writers.
export interface AuthEvents {
  readonly signinSucceeded: SecurityEvent;
  readonly signinFailed: SecurityEvent;
  readonly limitRefused: SecurityEvent;
  readonly sessionRevoked: SecurityEvent;
  readonly credentialChanged: SecurityEvent;
  readonly subjectChanged: SecurityEvent;
  readonly callbackFailed: SecurityEvent;
  readonly oidcProviderRefused: SecurityEvent;
  readonly keysUnavailable: SecurityEvent;
  readonly storeFailed: SecurityEvent;
}
