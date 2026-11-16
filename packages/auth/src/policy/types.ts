// Does:  Declares principals, grants and policies: who a credential is, what a policy decides and what it grants.
// Holds: A principal or grant has authority only while registered; a structural copy of either has none.

import type { AuthorizeOutcome, GateFinding, GateInput, GateRequest, GateRoute } from '@skeld/core/gate';
import type { Infer, Schema } from '@skeld/core/schema';
import type { LimitRule } from '../limit/types.ts';

/** Who a request's credential resolved to: a session, an API key or an external JWT. */
export type Principal = SessionPrincipal | ApiKeyPrincipal | JwtPrincipal;

/** A principal admitted on a session cookie. */
export interface SessionPrincipal {
  /** Marks the credential kind. */
  readonly kind: 'session';
  /** The subject. */
  readonly userId: string;
  /** When the session was first issued, in epoch milliseconds. */
  readonly createdAt: number;
  /** When the session ends without further renewal, judged at this admission, in epoch milliseconds. */
  readonly expiresAt: number;
}

/** A principal admitted on an API key. */
export interface ApiKeyPrincipal {
  /** Marks the credential kind. */
  readonly kind: 'api_key';
  /** The subject. */
  readonly userId: string;
  /** The key's id. */
  readonly keyId: string;
  /** The key's scopes, each `<policy>:<action>`. */
  readonly scopes: readonly string[];
}

/** A principal admitted on an external JWT, after every check and the application's map passed. */
export interface JwtPrincipal {
  /** Marks the credential kind. */
  readonly kind: 'jwt';
  /** The token's issuer. */
  readonly issuer: string;
  /** The token's subject. */
  readonly subject: string;
  /** The user the application's map named, or `null`. */
  readonly userId: string | null;
  /** The token's verified claims. */
  readonly claims: { readonly [name: string]: unknown };
}

/** A credential kind a policy may accept. */
export type CredentialKind = 'session' | 'api_key' | 'jwt';

/** The authority a policy action granted one request; frozen, and valid only while registered and unreleased. */
export interface Grant<N, K, R> {
  /** The principal the grant was issued to. */
  readonly principal: Principal;
  /** The policy that issued it. */
  readonly policy: N;
  /** The action it admits. */
  readonly action: K;
  /** The resource's tenant, or `null` without a tenant rule. */
  readonly tenant: string | null;
  /** The resource the policy loaded; without `load` its value is `null` and its type is `unknown`. */
  readonly resource: R;
  /** The id of the request it was issued in. */
  readonly requestId: string;
}

/**
 * What a policy decides: credentials, an optional limit, the resource to load, its tenant and each action's rule.
 * Each `input` schema must be the same node, under the same key, in one of the route's `params`, `query` or `body`.
 */
export interface PolicyOptions<I extends { readonly [key: string]: Schema }, R, K extends string> {
  /** The credential kinds accepted, at least one. */
  readonly credentials: readonly CredentialKind[];
  /** A limit charged per policy and principal before authorization. */
  readonly limit?: LimitRule;
  /** The route values `load` receives, by key. */
  readonly input?: I;
  /** Loads the resource from the input; `null` or `undefined` answers 404. */
  readonly load?: (context: {
    readonly principal: Principal;
    readonly input: { readonly [P in keyof I]: Infer<I[P]> };
    readonly signal: AbortSignal;
  }) => R | null | undefined | Promise<R | null | undefined>;
  /** The resource's tenant and the membership rule; allowed only with `load`; a non-member answers 404. */
  readonly tenant?: {
    /** The resource's tenant name, 1 to 128 characters. */
    readonly of: (resource: R) => string;
    /** Whether the principal belongs to the tenant; only `true` admits. */
    readonly member: (context: {
      readonly principal: Principal;
      readonly tenant: string;
      readonly resource: R;
      readonly signal: AbortSignal;
    }) => boolean | Promise<boolean>;
  };
  /** One rule per action; only `true` admits. */
  readonly actions: {
    readonly [A in K]: (context: {
      readonly principal: Principal;
      readonly resource: R;
      readonly tenant: string | null;
      readonly signal: AbortSignal;
    }) => boolean | Promise<boolean>;
  };
  /** How a refused action answers: 403, or 404 as if the resource were absent (default `'forbidden'`). */
  readonly denial?: 'forbidden' | 'not_found';
}

/** A frozen policy, bound to routes by the gate at boot. */
export interface Policy<N extends string, I extends { readonly [key: string]: Schema }, R, K extends string> {
  /** The policy's name, unique on a server. */
  readonly name: N;
  /** The policy's options as given. */
  readonly options: PolicyOptions<I, R, K>;
  /**
   * Wraps a body that may run only with a live grant of this policy and action.
   * Throws AuthError `GRANT_UNKNOWN`, `GRANT_POLICY`, `GRANT_ACTION` or `GRANT_RELEASED` first; checks no other input.
   * @see examples/auth/documents.ts
   */
  operation<A extends K, T extends readonly unknown[], U>(
    action: A,
    body: (grant: Grant<N, A, R>, ...args: T) => U,
  ): (grant: Grant<N, A, R>, ...args: T) => U;
}

/** Any policy: the constraint of a policy tuple; it reads only the name and the action rules. */
export interface AnyPolicy {
  /** The policy's name. */
  readonly name: string;
  /** The policy's options. */
  readonly options: { readonly actions: object };
}

/**
 * The type of `definePolicy`: infers the name, the input, the resource and the action names.
 * It throws `TypeError` for a name outside the access-name grammar or starting `auth.`.
 */
export type DefinePolicy = <const N extends string, I extends { readonly [key: string]: Schema }, R, K extends string>(
  name: N,
  options: PolicyOptions<I, R, K>,
) => Policy<N, I, R, K>;

// Does:  Binds a policy route at boot to its policy and action, or answers why it cannot be bound.
export interface PolicyBinder {
  bind(route: GateRoute): BoundPolicy | GateFinding;
}

// Holds: authorize registers every grant it admits, and release ends it once.
export interface BoundPolicy {
  readonly policy: string;
  readonly action: string;
  readonly credentials: readonly CredentialKind[];
  readonly limit: LimitRule | null;
  authorize(principal: Principal, input: GateInput, request: GateRequest): Promise<AuthorizeOutcome>;
  release(grant: unknown): void;
}
