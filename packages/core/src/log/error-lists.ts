// Does:  Builds the error reader's two lists once at load: the listed classes by prototype and the code set.
// Holds: Every word either list yields is a class name written here or a code Node itself gives, never a value's.

import dns from 'node:dns';
import { constants } from 'node:os';
import { getSystemErrorMap } from 'node:util';
import { HttpError } from '../contract/http-error.ts';
import { BootError } from '../server/boot-error.ts';

export const LISTED_TYPES: ReadonlyMap<object, string> = new Map<object, string>([
  [Error.prototype, 'Error'],
  [EvalError.prototype, 'EvalError'],
  [RangeError.prototype, 'RangeError'],
  [ReferenceError.prototype, 'ReferenceError'],
  [SyntaxError.prototype, 'SyntaxError'],
  [TypeError.prototype, 'TypeError'],
  [URIError.prototype, 'URIError'],
  [AggregateError.prototype, 'AggregateError'],
  [DOMException.prototype, 'DOMException'],
  [HttpError.prototype, 'HttpError'],
  [BootError.prototype, 'BootError'],
]);

function buildCodes(): ReadonlySet<string> {
  const codes = new Set<string>(Object.keys(constants.errno));
  for (const [name] of getSystemErrorMap().values()) {
    codes.add(name);
  }
  // Why: The only string-valued exports of node:dns are its error-code constants (NODATA to CANCELLED).
  for (const value of Object.values(dns)) {
    if (typeof value === 'string') {
      codes.add(value);
    }
  }
  return codes;
}

export const ERROR_CODES: ReadonlySet<string> = buildCodes();
