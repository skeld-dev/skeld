// Does:  Declares the session handoff and the subject fence: establishing, rotating and the trusted subject calls.
// Holds: Only the established and rotated outcomes carry a session or a cookie; every other outcome carries neither.

import type { OutgoingCookie, RawCookies } from '@skeld/core/server';
import type { Unavailable } from '../store/types.ts';

/**
 * The only writer of session authority: the application's trusted handoff, and rotation of a live session.
 * Each call rejects AuthError `INVALID_INPUT` for a user id outside its grammar, `NOT_READY` before `listen`, `CLOSED` after.
 */
export interface Sessions {
  /** Establishes a session after the application's `verify` answers `true` inside the subject's fence. */
  establish(input: EstablishInput): Promise<Established>;
  /** Spends the request's one well-formed session cookie and issues its replacement in one unit. */
  rotate(input: { readonly rawCookies: RawCookies; readonly signal?: AbortSignal }): Promise<Rotated>;
}

/** What `establish` receives; `verify` must read the credential it judges inside the call. */
export interface EstablishInput {
  /** The request's cookies; a well-formed session cookie among them is replaced. */
  readonly rawCookies: RawCookies;
  /** The user, from trusted server code and never from a request body: 1 to 128 of `A-Z a-z 0-9 - _ . :`. */
  readonly userId: string;
  /** Judges the credential, once, under 10,000 ms; only `true` establishes, and `'unavailable'` answers `Unavailable`. */
  readonly verify: (signal: AbortSignal) => boolean | 'unavailable' | Promise<boolean | 'unavailable'>;
  /** Aborts the call. */
  readonly signal?: AbortSignal;
}

/** The outcome of `establish`; `callback` means `verify` threw, answered a non-boolean or passed its deadline. */
export type Established =
  | {
      /** Marks the outcome. */
      readonly kind: 'established';
      /** The new session. */
      readonly session: LiveSession;
      /** The session cookie to set. */
      readonly cookies: readonly OutgoingCookie[];
    }
  | {
      readonly kind: 'refused';
      /** Why the session was refused. */
      readonly reason: 'rejected' | 'disabled' | 'stale' | 'callback';
    }
  | Unavailable;

/** The outcome of `rotate`; the replacement keeps the old session's creation and absolute expiry. */
export type Rotated =
  | {
      /** Marks the outcome. */
      readonly kind: 'rotated';
      /** The replacement session. */
      readonly session: LiveSession;
      /** The replacement cookie to set. */
      readonly cookies: readonly OutgoingCookie[];
    }
  | {
      readonly kind: 'refused';
      /** Why the rotation was refused: the request carries no live session. */
      readonly reason: 'no_session';
    }
  | Unavailable;

/** The body of `authSession` and of an application's own sign-in reply. */
export type SessionState =
  | {
      /** Whether the holder has a live session. */
      readonly status: 'none';
    }
  | LiveSession;

/** A live session as its holder sees it. */
export interface LiveSession {
  /** Whether the holder has a live session. */
  readonly status: 'session';
  /** The subject. */
  readonly userId: string;
  /** The token unsafe requests send as `x-csrf-token`. */
  readonly csrfToken: string;
  /** When the session ends without renewal, in epoch milliseconds. */
  readonly expiresAt: number;
}

/**
 * The trusted server-side calls on subjects; each writes its record after a confirmed commit.
 * Each rejects AuthError `INVALID_INPUT`, `NOT_READY` or `CLOSED`; `disable`, `enable` and `revokeSessions` end every session.
 */
export interface Subjects {
  /** Reads a subject's fence. */
  read(
    userId: string,
  ): Promise<
    | { readonly kind: 'subject'; readonly enabled: boolean; readonly generation: number }
    | { readonly kind: 'absent' }
    | Unavailable
  >;
  /** Disables a subject, raising its generation and ending its sessions; its API keys are refused while disabled. */
  disable(userId: string): Promise<SubjectChanged | Unavailable>;
  /** Enables a subject disabled at exactly `expectedGeneration`, raising its generation and ending its sessions. */
  enable(userId: string, expectedGeneration: number): Promise<SubjectChanged | EnableRefused | Unavailable>;
  /** Raises a subject's generation and ends its sessions; API keys are not revoked. */
  revokeSessions(userId: string): Promise<SubjectChanged | Unavailable>;
}

/** Why `enable` changed nothing: no such subject, already enabled, or disabled at another generation. */
export interface EnableRefused {
  /** Marks the outcome. */
  readonly kind: 'refused';
  /** The state `enable` found. */
  readonly reason: 'absent' | 'enabled' | 'stale';
}

/** A confirmed change of a subject's fence. */
export interface SubjectChanged {
  /** Marks the outcome. */
  readonly kind: 'done';
  /** Whether the subject is enabled after the change. */
  readonly enabled: boolean;
  /** The subject's generation after the change. */
  readonly generation: number;
}
