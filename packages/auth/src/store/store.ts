// Does:  Defines StoreFailure, the only rejection of a store operation, beside the store's types.
// Holds: The message names the operation and the reason alone; engine and driver text never enters it.

export type {
  ApiKeyRecord,
  AttachResult,
  AuthStore,
  Digest,
  Done,
  InstallResult,
  Lost,
  SessionRecord,
  StoreAttach,
  StoreEvent,
  StoreOperations,
  SubjectRecord,
  Unavailable,
} from './types.ts';

/**
 * The error every store operation rejects with; `applied: 'unknown'` means the change may stand.
 * An unknown outcome is never reported as success and never repeated by auth.
 * @example new StoreFailure('sessionRead', 'unavailable', 'no', null)
 */
export class StoreFailure extends Error {
  override readonly name = 'StoreFailure';
  /** The operation that failed. */
  readonly operation: string;
  /** Why it failed. */
  readonly reason: 'unavailable' | 'fault' | 'aborted' | 'record';
  /** Whether nothing changed or the outcome is unknown. */
  readonly applied: 'no' | 'unknown';
  /** The SQLSTATE or the SQLite result code as decimal text, or `null`. */
  readonly code: string | null;

  constructor(
    operation: string,
    reason: 'unavailable' | 'fault' | 'aborted' | 'record',
    applied: 'no' | 'unknown',
    code: string | null,
  ) {
    super(`auth store: ${operation}: ${reason}`);
    this.operation = operation;
    this.reason = reason;
    this.applied = applied;
    this.code = code;
  }
}
