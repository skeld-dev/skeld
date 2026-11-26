// Does:  Frames inbound PostgreSQL messages and reads their fields, refusing any length, count or text out of rule.
// Holds: A message's length is judged on its five header bytes, before any of its body is buffered.

export interface Frame {
  readonly type: number;
  readonly body: Buffer;
}

export type FrameBreach = 'short' | 'long';

export interface MessageReader {
  setLimit(bytes: number): void;
  push(chunk: Buffer, deliver: (frame: Frame) => boolean): FrameBreach | null;
}

// Does:  Splits a byte stream into messages, copying a body only when it spans chunks.
export function createMessageReader(initialLimit: number): MessageReader {
  let limit = initialLimit;
  const header = Buffer.alloc(5);
  let headerFilled = 0;
  let type = 0;
  let declared = 0;
  // Why: -1 while a header is being read; otherwise the body's length, judged before any of it is kept.
  let bodyLength = -1;
  let body: Buffer | null = null;
  let bodyFilled = 0;

  const finish = (whole: Buffer, deliver: (frame: Frame) => boolean): boolean => {
    bodyLength = -1;
    body = null;
    bodyFilled = 0;
    return deliver({ type, body: whole });
  };

  // Does:  Takes header bytes from the chunk; returns the next offset, with declared set once all five are in.
  const takeHeader = (chunk: Buffer, offset: number): number => {
    if (headerFilled === 0 && chunk.length - offset >= 5) {
      type = chunk.readUInt8(offset);
      declared = chunk.readInt32BE(offset + 1);
      headerFilled = 5;
      return offset + 5;
    }
    const taken = Math.min(5 - headerFilled, chunk.length - offset);
    chunk.copy(header, headerFilled, offset, offset + taken);
    headerFilled += taken;
    if (headerFilled === 5) {
      type = header.readUInt8(0);
      declared = header.readInt32BE(1);
    }
    return offset + taken;
  };

  // Does:  Takes body bytes from the chunk; returns the next offset, or -1 when deliver asked to stop.
  const takeBody = (chunk: Buffer, offset: number, deliver: (frame: Frame) => boolean): number => {
    const wanted = bodyLength - bodyFilled;
    const available = chunk.length - offset;
    if (body === null && available >= wanted) {
      return finish(chunk.subarray(offset, offset + wanted), deliver) ? offset + wanted : -1;
    }
    body ??= Buffer.allocUnsafe(bodyLength);
    const taken = Math.min(wanted, available);
    chunk.copy(body, bodyFilled, offset, offset + taken);
    bodyFilled += taken;
    if (bodyFilled === bodyLength && !finish(body, deliver)) {
      return -1;
    }
    return offset + taken;
  };

  // Does:  Delivers each whole message in the chunk; stops at the first breach, or when deliver returns false.
  const push = (chunk: Buffer, deliver: (frame: Frame) => boolean): FrameBreach | null => {
    let offset = 0;
    while (offset < chunk.length) {
      if (bodyLength !== -1) {
        offset = takeBody(chunk, offset, deliver);
        if (offset === -1) {
          return null;
        }
        continue;
      }
      offset = takeHeader(chunk, offset);
      if (headerFilled < 5) {
        return null;
      }
      headerFilled = 0;
      if (declared < 4) {
        return 'short';
      }
      if (declared > limit) {
        return 'long';
      }
      bodyLength = declared - 4;
      if (bodyLength === 0 && !finish(EMPTY, deliver)) {
        return null;
      }
    }
    return null;
  };

  return Object.freeze({
    // Why: Until ReadyForQuery a message is held to the connect bound, afterwards to maxResultBytes.
    setLimit: (bytes: number): void => {
      limit = bytes;
    },
    push,
  });
}

const EMPTY = Buffer.alloc(0);

export class Breach extends Error {}

const utf8 = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });

export function decodeText(bytes: Uint8Array): string {
  try {
    return utf8.decode(bytes);
  } catch {
    // Why: The fatal decoder throws a TypeError for an invalid sequence, meaning the server broke the protocol.
    throw new Breach();
  }
}

// Does:  Holds the read position in one message body; the read functions below advance it or raise a Breach.
export interface Fields {
  readonly body: Buffer;
  offset: number;
}

export function fieldsOf(body: Buffer): Fields {
  return { body, offset: 0 };
}

function need(fields: Fields, length: number): void {
  if (length < 0 || fields.offset + length > fields.body.length) {
    throw new Breach();
  }
}

export function readByte(fields: Fields): number {
  need(fields, 1);
  const value = fields.body.readUInt8(fields.offset);
  fields.offset += 1;
  return value;
}

export function readInt16(fields: Fields): number {
  need(fields, 2);
  const value = fields.body.readInt16BE(fields.offset);
  fields.offset += 2;
  return value;
}

export function readUint16(fields: Fields): number {
  need(fields, 2);
  const value = fields.body.readUInt16BE(fields.offset);
  fields.offset += 2;
  return value;
}

export function readInt32(fields: Fields): number {
  need(fields, 4);
  const value = fields.body.readInt32BE(fields.offset);
  fields.offset += 4;
  return value;
}

export function readBytes(fields: Fields, length: number): Buffer {
  need(fields, length);
  const value = fields.body.subarray(fields.offset, fields.offset + length);
  fields.offset += length;
  return value;
}

export function readRest(fields: Fields): Buffer {
  return readBytes(fields, fields.body.length - fields.offset);
}

// Does:  Reads one NUL-terminated UTF-8 string; a missing terminator or invalid UTF-8 is a Breach.
export function readString(fields: Fields): string {
  const end = fields.body.indexOf(0, fields.offset);
  if (end === -1) {
    throw new Breach();
  }
  const value = decodeText(fields.body.subarray(fields.offset, end));
  fields.offset = end + 1;
  return value;
}

export function readDone(fields: Fields): void {
  if (fields.offset !== fields.body.length) {
    throw new Breach();
  }
}

// Does:  Reads a DataRow's fields, each null or its bytes, after checking the count and every field length.
// Holds: The count equals the RowDescription's, every length is -1 or fits the message, and nothing is left over.
export function dataRowFields(body: Buffer, columns: number): (Buffer | null)[] {
  const fields = fieldsOf(body);
  if (readUint16(fields) !== columns) {
    throw new Breach();
  }
  const values: (Buffer | null)[] = [];
  for (let index = 0; index < columns; index += 1) {
    const length = readInt32(fields);
    if (length < -1) {
      throw new Breach();
    }
    values.push(length === -1 ? null : readBytes(fields, length));
  }
  readDone(fields);
  return values;
}

// Does:  Reads an ErrorResponse or NoticeResponse body into its fields by their one-byte codes.
export function errorFields(body: Buffer): ReadonlyMap<string, string> {
  const fields = fieldsOf(body);
  const found = new Map<string, string>();
  for (let code = readByte(fields); code !== 0; code = readByte(fields)) {
    found.set(String.fromCharCode(code), readString(fields));
  }
  readDone(fields);
  return found;
}
