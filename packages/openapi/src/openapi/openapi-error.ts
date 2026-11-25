// Does:  Defines OpenApiError, the one error createOpenApi throws when it refuses a contract or its metadata.
// Holds: The message is fixed by the code and never holds a caught message or an option value.

/** Why generation was refused; each code has one fixed message. */
export type ErrorCode =
  | 'INVALID_CONTRACT'
  | 'INVALID_METADATA'
  | 'UNSUPPORTED_PATH'
  | 'COLLISION'
  | 'INVALID_SCHEMA'
  | 'INVALID_SECURITY'
  | 'LIMIT_EXCEEDED';

const MESSAGES: { readonly [C in ErrorCode]: string } = Object.freeze({
  INVALID_CONTRACT: 'Invalid contract',
  INVALID_METADATA: 'Invalid documentation metadata',
  UNSUPPORTED_PATH: 'Unsupported OpenAPI path',
  COLLISION: 'Conflicting OpenAPI operation',
  INVALID_SCHEMA: 'Invalid documentation schema',
  INVALID_SECURITY: 'Invalid documentation security',
  LIMIT_EXCEEDED: 'Documentation traversal limit exceeded',
});

/**
 * The error generation throws; `code` names the reason, `location` the route, part or key, and the message is fixed.
 * A refused call returns no partial document.
 * @example new OpenApiError('INVALID_METADATA', ['info', 'title'])
 */
export class OpenApiError extends Error {
  override readonly name = 'OpenApiError';
  /** The reason. */
  readonly code: ErrorCode;
  /** Where the refused input is: route name, part and property keys, or option keys and indexes. */
  readonly location: readonly (string | number)[];

  constructor(code: ErrorCode, location: readonly (string | number)[]) {
    super(MESSAGES[code]);
    this.code = code;
    this.location = location;
  }
}
