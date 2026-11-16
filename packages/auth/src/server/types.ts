// Does:  Declares the auth centre's public types: its options, the access types its gate gives a server and its handle.
// Holds: The grants a server's handlers see are derived from the policy tuple, never written by hand.

import type { Gate } from '@skeld/core/gate';
import type { GatedHandlers } from '@skeld/core/server';
import type { Limits, LimitRule } from '../limit/types.ts';
import type { AnyPolicy, Grant, Principal } from '../policy/types.ts';
import type { SessionRoutes } from '../routes/routes.ts';
import type { Sessions, Subjects } from '../session/types.ts';
import type { AuthStore } from '../store/types.ts';
import type { ApiKeyPart, JwtPart, OidcPart } from './internal-types.ts';

type ActionsOf<Q extends AnyPolicy> = keyof Q['options']['actions'] & string;

type ResourceOf<Q extends AnyPolicy> = Q['options'] extends { readonly load?: (context: never) => infer R }
  ? Exclude<Awaited<R>, null | undefined>
  : null;

type PolicyEntries<Q> = Q extends AnyPolicy
  ? { readonly [K in ActionsOf<Q>]: Grant<Q['name'], K, ResourceOf<Q>> }[ActionsOf<Q>]
  : never;

/** The access types of an auth gate, by the union of the grants its policies issue. */
export interface AuthAccessOf<G extends Grant<string, string, unknown>> {
  /** The admitted principal. */
  readonly principal: Principal;
  /** The grants by policy name and action name. */
  readonly grants: {
    readonly [E in G as E['policy']]: {
      readonly [F in Extract<G, { readonly policy: E['policy'] }> as F['action']]: F;
    };
  };
}

/** The access types an auth gate gives a server: its principal, and a grant per policy action plus `auth.session.use`. */
export type AuthAccess<P extends readonly AnyPolicy[]> = AuthAccessOf<
  PolicyEntries<P[number]> | Grant<'auth.session', 'use', null>
>;

/**
 * The options of `createAuth`; nothing is checked until the gate's boot, which refuses a bad option with `GATE_FAILED`.
 * `origin` must be one of the server's `publicOrigin`; policy names are unique and never start `auth.`.
 */
export interface AuthOptions<P extends readonly AnyPolicy[], L extends string> {
  /** Where auth keeps its state. */
  readonly store: AuthStore;
  /** The service's origin, as `new URL(x).origin` writes it: `https`, or `http` on a loopback host. */
  readonly origin: string;
  /** The policies routes may name. */
  readonly policies?: P;
  /** The session cookie and its lifetimes. */
  readonly session?: SessionOptions;
  /** The application's limit scopes, at most 32, none starting `auth.`. */
  readonly limits?: { readonly [S in L]: LimitRule };
  /** The limit on auth's public routes per route and client address (default 10 per 60 seconds). */
  readonly addressLimit?: LimitRule;
  /** The API-key part, from `apiKeys()`. */
  readonly apiKeys?: ApiKeyPart;
  /** The JWT part, from `jwt()`. */
  readonly jwt?: JwtPart;
  /** The OIDC part, from `oidc()`. */
  readonly oidc?: OidcPart;
}

/** The session cookie and its lifetimes; `2 ≤ idleSeconds ≤ absoluteSeconds ≤ 2,592,000`, in whole seconds. */
export interface SessionOptions {
  /** The cookie's name: `__Host-` and an HTTP token, at most 64 characters (default `__Host-skeld`). */
  readonly cookieName?: string;
  /** Seconds a session lives without use (default 3,600). */
  readonly idleSeconds?: number;
  /** Seconds a session lives whatever its use (default 86,400). */
  readonly absoluteSeconds?: number;
  /** Seconds of use after which a session is renewed, at most half of `idleSeconds` (default the smaller of 300 and that half). */
  readonly renewSeconds?: number;
}

/**
 * The type of `createAuth`: infers the policy tuple and the limit scope names; it reads and checks nothing.
 * @see examples/auth/app.ts
 */
export type CreateAuth = <const P extends readonly AnyPolicy[] = readonly [], const L extends string = never>(
  options: AuthOptions<P, L>,
) => Auth<P, L>;

/**
 * One server's auth: its gate, its session handlers and its trusted server-side calls.
 * Every call rejects AuthError `NOT_READY` before the server listens and `CLOSED` after it closes.
 */
export interface Auth<P extends readonly AnyPolicy[], L extends string> {
  /** The gate to give `createServer`. */
  // Why: Written out, not as AuthAccess<P>, so the server's access types carry Grant references and no policy type.
  readonly gate: Gate<AuthAccessOf<PolicyEntries<P[number]> | Grant<'auth.session', 'use', null>>>;
  /** The handlers of auth's routes. */
  readonly handlers: {
    /** The handlers of `sessionRoutes`. */
    readonly session: GatedHandlers<
      SessionRoutes,
      AuthAccessOf<PolicyEntries<P[number]> | Grant<'auth.session', 'use', null>>
    >;
  };
  /** The session handoff. */
  readonly sessions: Sessions;
  /** The subject fence. */
  readonly subjects: Subjects;
  /** The application's limit scopes. */
  readonly limits: Limits<L>;
}
