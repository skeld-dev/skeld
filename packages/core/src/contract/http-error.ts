// Does:  Defines HttpError, the one error a handler throws to answer with a chosen status and code.
// Holds: An instance has a null status or one from 400 to 599, and a code of upper-case letters, digits and _.

import type { ErrorDetail, HttpErrorOptions, OutgoingCookie } from './types.ts';

export type { HttpErrorOptions, OutgoingCookie } from './types.ts';

const ERROR_CODE = /^[A-Z][A-Z0-9_]*$/;

function isErrorStatus(status: number | null): boolean {
  return status === null || (Number.isInteger(status) && status >= 400 && status <= 599);
}

/**
 * An error with an HTTP status and a code, written to the client as the one error body.
 * A `null` status marks a client-side failure and is written as 500; throws `RangeError` for a status outside 400-599 or a code other than upper-case letters, digits and `_`.
 * @example new HttpError(404, 'NOT_FOUND', 'No such user')
 */
export class HttpError extends Error {
  override readonly name = 'HttpError';
  readonly status: number | null;
  readonly code: string;
  readonly details: readonly ErrorDetail[] | null;
  readonly cookies: readonly OutgoingCookie[] | null;

  constructor(status: number | null, code: string, message: string, options?: HttpErrorOptions) {
    if (!isErrorStatus(status)) {
      throw new RangeError(`HttpError status must be null or an integer from 400 to 599, got ${status}`);
    }
    if (!ERROR_CODE.test(code)) {
      throw new RangeError(`HttpError code must be upper case letters, digits and _, got "${code}"`);
    }
    super(message, options);
    this.status = status;
    this.code = code;
    this.details = options?.details ?? null;
    this.cookies = options?.cookies ?? null;
  }
}
