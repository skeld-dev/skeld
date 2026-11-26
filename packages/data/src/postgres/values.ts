// Does:  Converts a PostgreSQL text-format value to its JavaScript value by the column's type id.
// Holds: Only the nine listed type ids are converted; every other type stays the server's UTF-8 text.

import { Breach, decodeText } from './reader.ts';

const BOOL = 16;
const BYTEA = 17;
const INT8 = 20;
const INT2 = 21;
const INT4 = 23;
const OID = 26;
const FLOAT4 = 700;
const FLOAT8 = 701;
const TIMESTAMPTZ = 1184;

const INTEGER = /^-?[0-9]+$/;
// Why: Only the plain UTC form is rewritten; any other zone or an era suffix stays the server's text.
const UTC_TIMESTAMP = /^([0-9]{4}-[0-9]{2}-[0-9]{2}) ([0-9]{2}:[0-9]{2}:[0-9]{2}(?:\.[0-9]{1,6})?)\+00$/;
const HEX_BYTEA = /^\\x(?:[0-9a-fA-F]{2})*$/;
const BACKSLASH = 0x5c;

function integer(text: string): string {
  if (!INTEGER.test(text)) {
    throw new Breach();
  }
  return text;
}

// Does:  Reads bytea's escape form: a doubled backslash is one, a backslash and three octal digits is that byte.
function escapedBytes(bytes: Buffer): Uint8Array {
  const out: number[] = [];
  for (let index = 0; index < bytes.length; index += 1) {
    const byte = bytes.readUInt8(index);
    if (byte !== BACKSLASH) {
      out.push(byte);
      continue;
    }
    const next = bytes.toString('latin1', index + 1, index + 4);
    if (next.startsWith('\\')) {
      out.push(BACKSLASH);
      index += 1;
    } else if (/^[0-3][0-7]{2}$/.test(next)) {
      out.push(Number.parseInt(next, 8));
      index += 3;
    } else {
      throw new Breach();
    }
  }
  return Uint8Array.from(out);
}

function byteaValue(bytes: Buffer): Uint8Array {
  const text = bytes.toString('latin1');
  if (!text.startsWith('\\x')) {
    return escapedBytes(bytes);
  }
  if (!HEX_BYTEA.test(text)) {
    throw new Breach();
  }
  return Uint8Array.from(Buffer.from(text.slice(2), 'hex'));
}

export function decodeValue(type: number, bytes: Buffer): unknown {
  if (type === BYTEA) {
    return byteaValue(bytes);
  }
  const text = decodeText(bytes);
  switch (type) {
    case BOOL:
      return text === 't';
    case INT8:
      return BigInt(integer(text));
    case INT2:
    case INT4:
    case OID:
      return Number(integer(text));
    case FLOAT4:
    case FLOAT8:
      return Number(text);
    case TIMESTAMPTZ: {
      const match = UTC_TIMESTAMP.exec(text);
      return match === null ? text : `${match[1]}T${match[2]}Z`;
    }
    default:
      return text;
  }
}
