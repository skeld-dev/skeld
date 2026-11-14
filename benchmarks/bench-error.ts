// Does:  Defines the benchmark's error, which carries the exit code the run ends with.
// Holds: An error always carries exit code 2, 3 or 4; 0 is success; 1 is reserved for session assessment failures.

export class BenchError extends Error {
  override readonly name = 'BenchError';
  readonly exitCode: 2 | 3 | 4;
  readonly detail: readonly string[];
  readonly reason: string | null;

  constructor(exitCode: 2 | 3 | 4, message: string, detail: readonly string[] = [], reason: string | null = null) {
    super(message);
    this.exitCode = exitCode;
    this.detail = detail;
    this.reason = reason;
  }
}

export function errorCode(error: unknown): string | null {
  return error instanceof Error && 'code' in error && typeof error.code === 'string' ? error.code : null;
}
