// Does:  Makes the errors the engine throws for failures it makes itself, and recognises them by registration alone.
// Holds: A fault is a plain Error made only by engineFault; its reason and location live here, never on the value.

import type { RequestErrorReason } from '../log/events.ts';

type FaultReason = Extract<
  RequestErrorReason,
  'undeclared_status' | 'response_mismatch' | 'reserved_header' | 'invalid_cookie' | 'redirect_refused' | 'send_status'
>;

export interface EngineFault {
  readonly reason: FaultReason;
  readonly location: string | null;
}

// Why: Identity in a module-private map cannot be forged from error.constructor or a prototype, and reads no property.
const FAULTS = new WeakMap<object, EngineFault>();

export function engineFault(reason: FaultReason, message: string, location: string | null): Error {
  const error = new Error(message);
  FAULTS.set(error, Object.freeze({ reason, location }));
  return error;
}

// Does:  Returns the reason and location of an error the engine made, or undefined for any other value.
export function faultOf(value: unknown): EngineFault | undefined {
  return typeof value === 'object' && value !== null ? FAULTS.get(value) : undefined;
}
