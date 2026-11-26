// Does:  Prepares a password for SCRAM by the server's rule: SASLprep when it applies, the raw UTF-8 bytes otherwise.
// Holds: Preparation never fails; a password SASLprep prohibits is used as its raw UTF-8 bytes, as the server does.

import {
  ASCII_CONTROL,
  BIDI_L,
  BIDI_R_AL,
  DISPLAY_OR_DEPRECATED,
  MAPPED_TO_NOTHING,
  NON_ASCII_CONTROL,
  NON_ASCII_SPACE,
  NON_CHARACTER,
  NOT_CANONICAL,
  NOT_PLAIN_TEXT,
  PRIVATE_USE,
  SURROGATE,
  TAGGING,
  UNASSIGNED,
} from './saslprep-tables.ts';

// Why: RFC 4013 section 2.3 prohibits these, and RFC 3454 section 7 prohibits unassigned code points in stored strings.
const PROHIBITED: readonly (readonly number[])[] = [
  NON_ASCII_SPACE,
  ASCII_CONTROL,
  NON_ASCII_CONTROL,
  PRIVATE_USE,
  NON_CHARACTER,
  SURROGATE,
  NOT_PLAIN_TEXT,
  NOT_CANONICAL,
  DISPLAY_OR_DEPRECATED,
  TAGGING,
  UNASSIGNED,
];

function inTable(table: readonly number[], point: number): boolean {
  let low = 0;
  let high = table.length / 2 - 1;
  while (low <= high) {
    const middle = (low + high) >>> 1;
    const first = table[middle * 2] ?? 0;
    const last = table[middle * 2 + 1] ?? 0;
    if (point < first) {
      high = middle - 1;
    } else if (point > last) {
      low = middle + 1;
    } else {
      return true;
    }
  }
  return false;
}

function points(text: string): number[] {
  return Array.from(text, (char) => char.codePointAt(0) ?? 0);
}

// Does:  Applies SASLprep (RFC 4013 section 2, in RFC 3454 section 2's order); null when the result is prohibited.
function saslprep(password: string): string | null {
  // Why: RFC 4013 section 2.1 maps non-ASCII spaces to SPACE and the "commonly mapped to nothing" characters away.
  const mapped = points(password)
    .filter((point) => !inTable(MAPPED_TO_NOTHING, point))
    .map((point) => (inTable(NON_ASCII_SPACE, point) ? 0x20 : point));
  // Why: PostgreSQL uses the raw bytes when mapping leaves nothing; a sign-in to PostgreSQL 19 accepts exactly those.
  if (mapped.length === 0) {
    return null;
  }
  const normalized = mapped
    .map((point) => String.fromCodePoint(point))
    .join('')
    .normalize('NFKC');
  const output = points(normalized);
  if (output.some((point) => PROHIBITED.some((table) => inTable(table, point)))) {
    return null;
  }
  // Why: RFC 3454 section 6: with any R or AL character, no L character, and R or AL first and last.
  if (output.some((point) => inTable(BIDI_R_AL, point))) {
    const first = output[0] ?? 0;
    const last = output.at(-1) ?? 0;
    const mixed = output.some((point) => inTable(BIDI_L, point));
    if (mixed || !inTable(BIDI_R_AL, first) || !inTable(BIDI_R_AL, last)) {
      return null;
    }
  }
  return normalized;
}

export function preparePassword(password: string): Buffer {
  return Buffer.from(saslprep(password) ?? password, 'utf8');
}
