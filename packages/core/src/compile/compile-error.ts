import type { PartName } from './types.ts';

export class SchemaCompileError extends Error {
  override readonly name = 'SchemaCompileError';
  readonly part: PartName | 'response';
  readonly status: number | null;
  declare readonly cause: unknown;

  constructor(part: PartName | 'response', status: number | null, cause: unknown) {
    super(
      part === 'response'
        ? `cannot compile the response ${status} serializer`
        : `cannot compile the request ${part} validator`,
      { cause },
    );
    this.part = part;
    this.status = status;
  }
}
