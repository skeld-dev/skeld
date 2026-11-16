// Does:  Declares the shared limits: a fixed-window rule, the application's charge and the gate's internal charges.
// Holds: A verdict is a pass, a refusal with a retry time, or Unavailable; a store failure is never a pass.

import type { GateRequest } from '@skeld/core/gate';
import type { Logger } from '@skeld/core/log';
import type { Principal } from '../policy/types.ts';
import type { AuthEvents } from '../server/internal-types.ts';
import type { StoreOperations, Unavailable } from '../store/types.ts';

/** A fixed window: at most `max` charges per `windowSeconds`, both integers. */
export interface LimitRule {
  /** Most charges per window, from 1 to 1,000,000. */
  readonly max: number;
  /** The window's length in seconds, from 1 to 86,400. */
  readonly windowSeconds: number;
}

/**
 * The application's declared limit scopes, charged before its own expensive work; there is no refund.
 * `charge` rejects AuthError `INVALID_INPUT` for an undeclared scope or a key out of bounds.
 */
export interface Limits<L> {
  /** Counts one charge of the key in the scope. */
  charge(scope: L, key: LimitKey, signal?: AbortSignal): Promise<LimitVerdict>;
}

/** A text key of 1 to 256 characters, or a client address, counted per IPv4 address or per IPv6 /64. */
export type LimitKey =
  | string
  | {
      /** The client's address, as `request.clientAddress` gives it. */
      readonly clientAddress: string;
    };

/** The outcome of a charge: a pass, a refusal with the whole seconds to wait (at least 1), or Unavailable. */
export type LimitVerdict =
  | {
      /** Marks the outcome. */
      readonly kind: 'pass';
      /** Charges left in the window. */
      readonly remaining: number;
      /** When the window restarts, in epoch milliseconds. */
      readonly resetAt: number;
    }
  | {
      readonly kind: 'limited';
      /** Whole seconds until the window restarts, rounded up, at least 1. */
      readonly retryAfterSeconds: number;
    }
  | Unavailable;

// Holds: A limited verdict from address or policy writes one auth.limit.refused record.
export interface InternalLimits {
  charge(scope: string, key: LimitKey, signal?: AbortSignal): Promise<LimitVerdict>;
  address(
    routeName: string,
    request: { readonly clientAddress: string; readonly log: Logger; readonly signal: AbortSignal },
  ): Promise<LimitVerdict>;
  policy(policy: string, rule: LimitRule, principal: Principal, request: GateRequest): Promise<LimitVerdict>;
}

// Does:  The input of createLimits, already checked by the auth centre.
export interface LimitsConfig {
  readonly store: StoreOperations;
  readonly events: AuthEvents;
  readonly log: Logger;
  readonly rules: { readonly [scope: string]: LimitRule };
  readonly addressLimit: LimitRule;
}
