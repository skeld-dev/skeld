// Does:  Encodes an author's log fields at the call: scalars, markers, classified values and error fields.
// Holds: Nothing of a value other than a scalar, a registered Classified or an error is inspected or called.

import { isProxy } from 'node:util/types';
import { Secret } from '../schema/secret.ts';
import { classifiedPair } from './classified.ts';
import { escapeText } from './escape.ts';
import { readError } from './error-reader.ts';
import {
  ERRORS_MAX,
  FIELDS_MAX,
  IDENTIFIER_UNITS,
  INVALID_MARKER,
  NAME_UNITS,
  SECRET_MARKER,
  TEXT_UNITS,
  UNCLASSIFIED_MARKER,
  UNREAD_MARKER,
} from './limits.ts';
import { projectClassified } from './project.ts';
import type { EncodedFields, ErrorOptions, ErrorPart } from './shapes.ts';
import type { LogFields } from './types.ts';

const SECRET = `"${SECRET_MARKER}"`;
const INVALID = `"${INVALID_MARKER}"`;
const UNCLASSIFIED = `"${UNCLASSIFIED_MARKER}"`;
const UNREAD = `"${UNREAD_MARKER}"`;

const NO_FIELDS: EncodedFields = Object.freeze({ members: Object.freeze([]), omitted: 0 });

interface ErrorCount {
  read: number;
}

function errorText(part: ErrorPart): string {
  switch (part.kind) {
    case 'non_error':
      return UNCLASSIFIED;
    case 'unreadable':
      return INVALID;
    case 'error': {
      const keys: string[] = [];
      if (part.type !== null) {
        keys.push(`"type":"${escapeText(part.type, IDENTIFIER_UNITS)}"`);
      }
      if (part.code !== null) {
        keys.push(`"code":"${escapeText(part.code, IDENTIFIER_UNITS)}"`);
      }
      if (part.message !== null) {
        keys.push(`"message":"${escapeText(part.message, TEXT_UNITS)}"`);
      }
      if (part.cause !== null) {
        keys.push(`"cause":"${escapeText(part.cause, TEXT_UNITS)}"`);
      }
      if (part.frames !== null) {
        keys.push(`"stacktrace":"${escapeText(part.frames, part.frames.length)}"`);
      }
      return `{${keys.join(',')}}`;
    }
  }
}

// Does:  Encodes one object-typed field value: Classified, error, Secret, or the unclassified marker.
function objectText(value: object, options: ErrorOptions, errors: ErrorCount): string | null {
  const pair = classifiedPair(value);
  if (pair !== undefined) {
    return projectClassified(pair.schema, pair.value);
  }
  if (Error.isError(value)) {
    if (errors.read >= ERRORS_MAX) {
      return UNREAD;
    }
    errors.read += 1;
    return errorText(readError(value, options));
  }
  // Why: An ordinary object's prototype read runs no code; a Proxy's could, so it is never asked.
  return !isProxy(value) && Object.getPrototypeOf(value) === Secret.prototype ? SECRET : UNCLASSIFIED;
}

// Does:  Encodes one field value as JSON text; null leaves the key out.
function valueText(value: unknown, options: ErrorOptions, errors: ErrorCount): string | null {
  switch (typeof value) {
    case 'undefined':
      return null;
    case 'string':
      return `"${escapeText(value, TEXT_UNITS)}"`;
    case 'number':
      return Number.isFinite(value) ? String(value) : 'null';
    case 'boolean':
      return String(value);
    case 'bigint':
      return `"${value}"`;
    case 'object':
      return value === null ? 'null' : objectText(value, options, errors);
    case 'function':
    case 'symbol':
      return UNCLASSIFIED;
  }
}

// Does:  Whether a field past FIELDS_MAX would have been written, from its descriptor alone.
function present(fields: object, name: string): boolean {
  try {
    const descriptor = Object.getOwnPropertyDescriptor(fields, name);
    return descriptor !== undefined && !('value' in descriptor && descriptor.value === undefined);
  } catch {
    // Why: The binding exists but cannot be read, so the field would have been written as invalid.
    return true;
  }
}

// Does:  Encodes the field under name, an accessor as unclassified without calling it; null leaves the key out.
function fieldText(fields: object, name: string, options: ErrorOptions, errors: ErrorCount): string | null {
  try {
    const descriptor = Object.getOwnPropertyDescriptor(fields, name);
    if (descriptor === undefined) {
      return null;
    }
    return 'value' in descriptor ? valueText(descriptor.value, options, errors) : UNCLASSIFIED;
  } catch {
    // Why: A descriptor read of a namespace's binding before it is set throws; that field is unreadable.
    return INVALID;
  }
}

export function encodeFields(fields: LogFields, options: ErrorOptions): EncodedFields {
  if (typeof fields !== 'object' || fields === null || isProxy(fields)) {
    return NO_FIELDS;
  }
  const members: string[] = [];
  const errors: ErrorCount = { read: 0 };
  let omitted = 0;
  for (const name of Object.keys(fields)) {
    if (members.length === FIELDS_MAX) {
      omitted += present(fields, name) ? 1 : 0;
      continue;
    }
    const text = fieldText(fields, name, options, errors);
    if (text !== null) {
      members.push(`"${escapeText(name, NAME_UNITS)}":${text}`);
    }
  }
  return { members, omitted };
}
