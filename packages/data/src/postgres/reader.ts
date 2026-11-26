// Does:  Frames inbound PostgreSQL messages and reads their fields, refusing any length, count or text out of rule.
// Holds: A message's length is judged on its five header bytes, before any of its body is buffered.

export interface Frame {
  readonly type: number;
  readonly body: Buffer;
}

export type FrameBreach = 'short' | 'long';

// Does:  Splits a byte stream into messages, copying a body only when it spans chunks.
export class MessageReader {
  #limit: number;
  readonly #header = Buffer.alloc(5);
  #headerFilled = 0;
  #type = 0;
  // Why: -1 while a header is being read; otherwise the body's length, judged before any of it is kept.
  #bodyLength = -1;
  #body: Buffer | null = null;
  #bodyFilled = 0;

  constructor(limit: number) {
    this.#limit = limit;
  }

  // Why: Until ReadyForQuery a message is held to the connect bound, afterwards to maxResultBytes.
  set limit(bytes: number) {
    this.#limit = bytes;
  }

  // Does:  Delivers each whole message in the chunk; stops at the first breach, or when deliver returns false.
  push(chunk: Buffer, deliver: (frame: Frame) => boolean): FrameBreach | null {
    let offset = 0;
    while (offset < chunk.length) {
      const available = chunk.length - offset;
      if (this.#bodyLength === -1) {
        let length: number;
        if (this.#headerFilled === 0 && available >= 5) {
          this.#type = chunk.readUInt8(offset);
          length = chunk.readInt32BE(offset + 1);
          offset += 5;
        } else {
          const taken = Math.min(5 - this.#headerFilled, available);
          chunk.copy(this.#header, this.#headerFilled, offset, offset + taken);
          this.#headerFilled += taken;
          offset += taken;
          if (this.#headerFilled < 5) {
            return null;
          }
          this.#headerFilled = 0;
          this.#type = this.#header.readUInt8(0);
          length = this.#header.readInt32BE(1);
        }
        if (length < 4) {
          return 'short';
        }
        if (length > this.#limit) {
          return 'long';
        }
        this.#bodyLength = length - 4;
        if (this.#bodyLength === 0 && !this.#finish(EMPTY, deliver)) {
          return null;
        }
        continue;
      }
      const wanted = this.#bodyLength - this.#bodyFilled;
      if (this.#body === null && available >= wanted) {
        offset += wanted;
        if (!this.#finish(chunk.subarray(offset - wanted, offset), deliver)) {
          return null;
        }
        continue;
      }
      this.#body ??= Buffer.allocUnsafe(this.#bodyLength);
      const taken = Math.min(wanted, available);
      chunk.copy(this.#body, this.#bodyFilled, offset, offset + taken);
      this.#bodyFilled += taken;
      offset += taken;
      if (this.#bodyFilled === this.#bodyLength && !this.#finish(this.#body, deliver)) {
        return null;
      }
    }
    return null;
  }

  #finish(body: Buffer, deliver: (frame: Frame) => boolean): boolean {
    this.#bodyLength = -1;
    this.#body = null;
    this.#bodyFilled = 0;
    return deliver({ type: this.#type, body });
  }
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

// Does:  Reads the fields of one message body in order; any read past the end or unterminated string is a Breach.
export class Fields {
  readonly #body: Buffer;
  #offset = 0;

  constructor(body: Buffer) {
    this.#body = body;
  }

  get remaining(): number {
    return this.#body.length - this.#offset;
  }

  byte(): number {
    this.#need(1);
    const value = this.#body.readUInt8(this.#offset);
    this.#offset += 1;
    return value;
  }

  int16(): number {
    this.#need(2);
    const value = this.#body.readInt16BE(this.#offset);
    this.#offset += 2;
    return value;
  }

  uint16(): number {
    this.#need(2);
    const value = this.#body.readUInt16BE(this.#offset);
    this.#offset += 2;
    return value;
  }

  int32(): number {
    this.#need(4);
    const value = this.#body.readInt32BE(this.#offset);
    this.#offset += 4;
    return value;
  }

  bytes(length: number): Buffer {
    this.#need(length);
    const value = this.#body.subarray(this.#offset, this.#offset + length);
    this.#offset += length;
    return value;
  }

  rest(): Buffer {
    return this.bytes(this.remaining);
  }

  string(): string {
    const end = this.#body.indexOf(0, this.#offset);
    if (end === -1) {
      throw new Breach();
    }
    const value = decodeText(this.#body.subarray(this.#offset, end));
    this.#offset = end + 1;
    return value;
  }

  done(): void {
    if (this.remaining !== 0) {
      throw new Breach();
    }
  }

  #need(length: number): void {
    if (length < 0 || this.#offset + length > this.#body.length) {
      throw new Breach();
    }
  }
}

// Does:  Reads a DataRow's fields, each null or its bytes, after checking the count and every field length.
// Holds: The count equals the RowDescription's, every length is -1 or fits the message, and nothing is left over.
export function dataRowFields(body: Buffer, columns: number): (Buffer | null)[] {
  const fields = new Fields(body);
  if (fields.uint16() !== columns) {
    throw new Breach();
  }
  const values: (Buffer | null)[] = [];
  for (let index = 0; index < columns; index += 1) {
    const length = fields.int32();
    if (length < -1) {
      throw new Breach();
    }
    values.push(length === -1 ? null : fields.bytes(length));
  }
  fields.done();
  return values;
}

// Does:  Reads an ErrorResponse or NoticeResponse body into its fields by their one-byte codes.
export function errorFields(body: Buffer): ReadonlyMap<string, string> {
  const fields = new Fields(body);
  const found = new Map<string, string>();
  for (let code = fields.byte(); code !== 0; code = fields.byte()) {
    found.set(String.fromCharCode(code), fields.string());
  }
  fields.done();
  return found;
}
