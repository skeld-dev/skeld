import type { ErrorDetail, HttpErrorOptions } from './types.ts';

export type { HttpErrorOptions } from './types.ts';

const ERROR_CODE = /^[A-Z][A-Z0-9_]*$/;

function isErrorStatus(status: number | null): boolean {
  return status === null || (Number.isInteger(status) && status >= 400 && status <= 599);
}

export class HttpError extends Error {
  override readonly name = 'HttpError';
  readonly status: number | null;
  readonly code: string;
  readonly details: readonly ErrorDetail[] | null;

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
  }
}
