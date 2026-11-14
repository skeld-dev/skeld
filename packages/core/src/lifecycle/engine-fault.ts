// Does:  Makes the errors the engine throws for failures it makes itself, and recognises them by registration alone.
// Holds: A fault is a plain Error made only by engineFault; its reason and detail live here, never on the value.

import type { RequestErrorReason } from '../log/events.ts';

type FaultReason = Extract<
  RequestErrorReason,
  'undeclared_status' | 'response_mismatch' | 'reserved_header' | 'invalid_cookie' | 'redirect_refused' | 'send_status'
>;

// Does:  The one log key and value a fault may add to its record: bounded, and never taken from an error's message.
export type FaultDetail =
  | readonly ['skeld.schema_location' | 'skeld.redirect_refusal' | 'skeld.reserved_header', string]
  | readonly ['skeld.returned_status', number];

export interface EngineFault {
  readonly reason: FaultReason;
  readonly detail: FaultDetail | null;
}

// Why: Identity in a module-private map cannot be forged from error.constructor or a prototype, and reads no property.
const FAULTS = new WeakMap<object, EngineFault>();

export function engineFault(reason: FaultReason, message: string, detail: FaultDetail | null): Error {
  const error = new Error(message);
  FAULTS.set(error, Object.freeze({ reason, detail }));
  return error;
}

// Does:  Returns the reason and detail of an error the engine made, or undefined for any other value.
export function faultOf(value: unknown): EngineFault | undefined {
  return typeof value === 'object' && value !== null ? FAULTS.get(value) : undefined;
}
