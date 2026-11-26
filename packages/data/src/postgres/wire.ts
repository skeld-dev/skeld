// Does:  Encodes every message the connection sends to a PostgreSQL server, each as one buffer.
// Holds: Every string field is NUL-free before it is encoded, so no field can end early and smuggle another.

import type { Parameter } from '../sql/types.ts';

export const PROTOCOL_3_2 = 0x0003_0002;
export const PROTOCOL_3_0 = 0x0003_0000;

// Why: The request codes of SSLRequest and CancelRequest (protocol-message-formats, SSLRequest and CancelRequest).
const SSL_REQUEST_CODE = 80_877_103;
const CANCEL_REQUEST_CODE = 80_877_102;

// Why: The type id of bytea; a Uint8Array parameter is declared so the server reads its binary form as bytea only.
const BYTEA_OID = 17;

export class NulInField extends Error {}

function cstring(text: string): Buffer {
  if (text.includes('\0')) {
    throw new NulInField();
  }
  return Buffer.from(`${text}\0`, 'utf8');
}

function int16(value: number): Buffer {
  const buffer = Buffer.allocUnsafe(2);
  buffer.writeInt16BE(value);
  return buffer;
}

function uint16(value: number): Buffer {
  const buffer = Buffer.allocUnsafe(2);
  buffer.writeUInt16BE(value);
  return buffer;
}

function int32(value: number): Buffer {
  const buffer = Buffer.allocUnsafe(4);
  buffer.writeInt32BE(value);
  return buffer;
}

function message(type: string, parts: readonly Buffer[]): Buffer {
  const body = Buffer.concat(parts);
  const out = Buffer.allocUnsafe(5 + body.length);
  out.write(type, 0, 'latin1');
  out.writeInt32BE(4 + body.length, 1);
  body.copy(out, 5);
  return out;
}

function untyped(parts: readonly Buffer[]): Buffer {
  const body = Buffer.concat(parts);
  const out = Buffer.allocUnsafe(4 + body.length);
  out.writeInt32BE(4 + body.length, 0);
  body.copy(out, 4);
  return out;
}

export function sslRequest(): Buffer {
  return untyped([int32(SSL_REQUEST_CODE)]);
}

export function startupMessage(version: number, settings: readonly (readonly [string, string])[]): Buffer {
  const pairs = settings.flatMap(([name, value]) => [cstring(name), cstring(value)]);
  return untyped([int32(version), ...pairs, Buffer.from([0])]);
}

export function cancelRequest(processId: number, key: Uint8Array): Buffer {
  return untyped([int32(CANCEL_REQUEST_CODE), int32(processId), Buffer.from(key)]);
}

export function saslInitialResponse(mechanism: string, data: Buffer): Buffer {
  return message('p', [cstring(mechanism), int32(data.length), data]);
}

export function saslResponse(data: Buffer): Buffer {
  return message('p', [data]);
}

export function query(text: string): Buffer {
  return message('Q', [cstring(text)]);
}

export function terminate(): Buffer {
  return message('X', []);
}

function parameterValue(value: Exclude<Parameter, null | Uint8Array>): string {
  if (value instanceof Date) {
    return value.toISOString();
  }
  return String(value);
}

// Does:  Encodes Parse, Bind, Describe, Execute and Sync of one cycle on the unnamed statement and portal.
// Holds: A Uint8Array goes in binary declared bytea; every other parameter goes as text with no declared type.
export function extendedCycle(text: string, parameters: readonly Parameter[]): Buffer {
  const types = parameters.map((value) => int32(value instanceof Uint8Array ? BYTEA_OID : 0));
  const formats = parameters.map((value) => int16(value instanceof Uint8Array ? 1 : 0));
  const values = parameters.map((value) => {
    if (value === null) {
      return int32(-1);
    }
    const bytes = value instanceof Uint8Array ? Buffer.from(value) : Buffer.from(parameterValue(value), 'utf8');
    return Buffer.concat([int32(bytes.length), bytes]);
  });
  const count = uint16(parameters.length);
  return Buffer.concat([
    message('P', [cstring(''), cstring(text), count, ...types]),
    message('B', [cstring(''), cstring(''), count, ...formats, count, ...values, int16(0)]),
    message('D', [Buffer.from('P', 'latin1'), cstring('')]),
    message('E', [cstring(''), int32(0)]),
    message('S', []),
  ]);
}

// Does:  Measures what one cycle sends of query text and parameter values, in bytes, before anything is encoded.
export function cycleBytes(text: string, parameters: readonly Parameter[]): number {
  let total = Buffer.byteLength(text, 'utf8');
  for (const value of parameters) {
    if (value === null) {
      continue;
    }
    total += value instanceof Uint8Array ? value.byteLength : Buffer.byteLength(parameterValue(value), 'utf8');
  }
  return total;
}
