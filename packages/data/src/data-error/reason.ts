// Does:  Declares the closed reason words of a failure and attaches one to a DataError outside the error object.
// Holds: A reason is never a property of the error, own or inherited, so it reaches no serialiser.

import type { DataError } from './data-error.ts';

export type Reason =
  | 'resolve'
  | 'connect'
  | 'declined'
  | 'answer'
  | 'certificate'
  | 'hostname'
  | 'handshake'
  | 'method'
  | 'no-password'
  | 'not-asked'
  | 'binding'
  | 'exchange'
  | 'iterations'
  | 'signature'
  | 'rejected'
  | 'version'
  | 'encoding'
  | 'no-key'
  | 'timeout'
  | 'closed'
  | 'violation'
  | 'open'
  | 'lost'
  | 'server'
  | 'result-bound'
  | 'transaction-control'
  | 'copy';

const reasons = new WeakMap<DataError, Reason>();

export function markReason(error: DataError, reason: Reason): DataError {
  reasons.set(error, reason);
  return error;
}

export function reasonOf(error: DataError): Reason | null {
  return reasons.get(error) ?? null;
}
