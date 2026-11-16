// Does:  Defines AuthError, the one error auth's server-side calls and grant operations reject or throw with.
// Holds: The message is fixed by the code and never holds a value the caller passed.

/** Why an auth call failed; each code has one fixed message. */
export type AuthErrorCode =
  | 'NOT_READY'
  | 'CLOSED'
  | 'INVALID_INPUT'
  | 'UNAVAILABLE'
  | 'CALLBACK_FAILED'
  | 'GRANT_UNKNOWN'
  | 'GRANT_POLICY'
  | 'GRANT_ACTION'
  | 'GRANT_RELEASED';

const MESSAGES: { readonly [C in AuthErrorCode]: string } = Object.freeze({
  NOT_READY: 'auth is not ready',
  CLOSED: 'auth is closed',
  INVALID_INPUT: 'invalid input',
  UNAVAILABLE: 'auth is unavailable',
  CALLBACK_FAILED: 'callback failed',
  GRANT_UNKNOWN: 'grant not issued',
  GRANT_POLICY: 'grant of another policy',
  GRANT_ACTION: 'grant of another action',
  GRANT_RELEASED: 'grant released',
});

/**
 * The error an auth call rejects or throws with; `code` names the reason and the message is fixed per code.
 * The cause, when kept, is never written to a response or a record.
 * @example new AuthError('INVALID_INPUT')
 */
export class AuthError extends Error {
  override readonly name = 'AuthError';
  /** The reason. */
  readonly code: AuthErrorCode;

  constructor(code: AuthErrorCode, options?: ErrorOptions) {
    super(MESSAGES[code], options);
    this.code = code;
  }
}
