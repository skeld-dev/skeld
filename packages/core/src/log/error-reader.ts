// Does:  Reads a caught value or an error field into an ErrorPart: kind, listed type and code, and what options admit.
// Holds: With no option on, no function of the value runs and a type or code returned is a word of a list.

import { isProxy } from 'node:util/types';
import { ERROR_CODES, LISTED_TYPES } from './error-lists.ts';
import { readFrames } from './frames.ts';
import { CHAIN_MAX, IDENTIFIER_UNITS, OTHER, TEXT_UNITS } from './limits.ts';
import type { ErrorOptions, ErrorPart } from './shapes.ts';

const NON_ERROR: ErrorPart = Object.freeze({
  kind: 'non_error',
  type: null,
  code: null,
  message: null,
  cause: null,
  frames: null,
});

const UNREADABLE: ErrorPart = Object.freeze({
  kind: 'unreadable',
  type: null,
  code: null,
  message: null,
  cause: null,
  frames: null,
});

// Does:  Finds the nearest listed class among the value's prototypes, or _OTHER past a Proxy, the chain's end or 16.
function listedTypeOf(value: object): string {
  let current: object = value;
  for (let seen = 0; seen < CHAIN_MAX; seen++) {
    if (isProxy(current)) {
      return OTHER;
    }
    const prototype: object | null = Object.getPrototypeOf(current);
    if (prototype === null) {
      return OTHER;
    }
    const word = LISTED_TYPES.get(prototype);
    if (word !== undefined) {
      return word;
    }
    current = prototype;
  }
  return OTHER;
}

function identifier(candidate: unknown): string | null {
  return typeof candidate === 'string' && candidate.length >= 1 && candidate.length <= IDENTIFIER_UNITS
    ? candidate
    : null;
}

// Does:  Reads the class name the value's prototype names through its constructor, data properties only.
function identifiedTypeOf(value: object): string | null {
  const prototype: object | null = Object.getPrototypeOf(value);
  if (prototype === null || isProxy(prototype)) {
    return null;
  }
  const maker: unknown = Object.getOwnPropertyDescriptor(prototype, 'constructor')?.value;
  if (typeof maker !== 'function' || isProxy(maker)) {
    return null;
  }
  return identifier(Object.getOwnPropertyDescriptor(maker, 'name')?.value);
}

function codeOf(value: object, identifiers: boolean): string | null {
  const code: unknown = Object.getOwnPropertyDescriptor(value, 'code')?.value;
  if (identifiers) {
    return identifier(code);
  }
  return typeof code === 'string' && ERROR_CODES.has(code) ? code : null;
}

function messageOf(value: object): string | null {
  const message: unknown = Object.getOwnPropertyDescriptor(value, 'message')?.value;
  return typeof message === 'string' ? message.slice(0, TEXT_UNITS) : null;
}

function causeOf(value: object): string | null {
  const cause: unknown = Object.getOwnPropertyDescriptor(value, 'cause')?.value;
  return Error.isError(cause) ? messageOf(cause) : null;
}

// Holds: Never throws; only options.frames reaches code of the value, and only through the extraction policy.
export function readError(value: unknown, options: ErrorOptions): ErrorPart {
  try {
    if (!Error.isError(value)) {
      return NON_ERROR;
    }
    return {
      kind: 'error',
      type: (options.identifiers ? identifiedTypeOf(value) : null) ?? listedTypeOf(value),
      code: codeOf(value, options.identifiers),
      message: options.text ? messageOf(value) : null,
      cause: options.text ? causeOf(value) : null,
      frames: options.frames ? readFrames(value, options.cwd) : null,
    };
  } catch {
    // Why: An exotic object in the chain can throw from a descriptor read; the guard makes that the unreadable record.
    return UNREADABLE;
  }
}
