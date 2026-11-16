// Does:  Parses the rows the PostgreSQL driver returns into the integers, texts, booleans and digests the units use.
// Holds: A value outside its column's shape throws RecordError; nothing is coerced or defaulted.

export class RecordError extends Error {
  override readonly name = 'RecordError';
}

const DECIMAL = /^-?\d{1,19}$/;
const DIGEST_BYTES = 32;

function field(row: unknown, name: string): unknown {
  if (typeof row !== 'object' || row === null || !(name in row)) {
    throw new RecordError(`column ${name} missing`);
  }
  const value: unknown = Reflect.get(row, name);
  return value;
}

// Why: The driver returns bigint columns as decimal text by default; an application's type parser may return a bigint.
function integer(value: unknown, name: string): number {
  const parsed =
    typeof value === 'number'
      ? value
      : typeof value === 'bigint'
        ? Number(value)
        : typeof value === 'string' && DECIMAL.test(value)
          ? Number(value)
          : Number.NaN;
  if (!Number.isSafeInteger(parsed) || (typeof value === 'bigint' && BigInt(parsed) !== value)) {
    throw new RecordError(`column ${name} is not a safe integer`);
  }
  return parsed;
}

export function int(row: unknown, name: string): number {
  return integer(field(row, name), name);
}

export function intOrNull(row: unknown, name: string): number | null {
  const value = field(row, name);
  return value === null ? null : integer(value, name);
}

export function bool(row: unknown, name: string): boolean {
  const value = field(row, name);
  if (typeof value !== 'boolean') {
    throw new RecordError(`column ${name} is not a boolean`);
  }
  return value;
}

export function boolOrNull(row: unknown, name: string): boolean | null {
  const value = field(row, name);
  return value === null ? null : bool(row, name);
}

export function text(row: unknown, name: string): string {
  const value = field(row, name);
  if (typeof value !== 'string') {
    throw new RecordError(`column ${name} is not text`);
  }
  return value;
}

// Why: Scopes are stored joined by one space, so an empty text or an empty part is not a list of scopes.
export function scopes(row: unknown, name: string): readonly string[] {
  const parts = text(row, name).split(' ');
  if (parts.some((part) => part === '')) {
    throw new RecordError(`column ${name} holds an empty scope`);
  }
  return Object.freeze(parts);
}

export function digest(row: unknown, name: string): Uint8Array {
  const value = field(row, name);
  if (!(value instanceof Uint8Array) || value.byteLength !== DIGEST_BYTES) {
    throw new RecordError(`column ${name} is not a 32-byte digest`);
  }
  // Why: The driver's Buffer may be a view into its shared pool; a result owns a plain copy of its 32 bytes.
  return new Uint8Array(value);
}

export function isNull(row: unknown, name: string): boolean {
  return field(row, name) === null;
}

export function first(rows: readonly unknown[]): unknown {
  const row = rows[0];
  if (row === undefined) {
    throw new RecordError('no row');
  }
  return row;
}

export function affected(rowCount: number | null): number {
  if (rowCount === null) {
    throw new RecordError('no row count');
  }
  return rowCount;
}
