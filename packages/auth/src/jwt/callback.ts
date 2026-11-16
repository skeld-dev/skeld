// Does:  Calls an application callback once under a deadline and reports what it answered, threw or failed to answer.
// Holds: A result or a throw that arrives after the deadline is ignored, and the callback's own text is never kept.

import { AuthError } from '../auth-error/auth-error.ts';
import { checkUserId } from '../session/user-id.ts';

export type Called =
  | { readonly kind: 'answered'; readonly value: unknown }
  | { readonly kind: 'threw' | 'deadline' | 'stopped' };

// Does:  Runs the callback with a signal aborting at the deadline or with any given signal; stop ends the wait at once.
export async function callWithin(
  callback: (signal: AbortSignal) => unknown,
  deadlineMs: number,
  signals: readonly AbortSignal[],
  stop?: AbortSignal,
): Promise<Called> {
  const deadline = new AbortController();
  const expired = Promise.withResolvers<Called>();
  const timer = setTimeout(() => {
    expired.resolve({ kind: 'deadline' });
    deadline.abort();
  }, deadlineMs);
  const stopped = (): void => expired.resolve({ kind: 'stopped' });
  if (stop?.aborted === true) {
    stopped();
  }
  stop?.addEventListener('abort', stopped, { once: true });
  const answer = Promise.try(() => callback(AbortSignal.any([deadline.signal, ...signals]))).then(
    (value): Called => ({ kind: 'answered', value }),
    (): Called => ({ kind: 'threw' }),
  );
  try {
    return await Promise.race([answer, expired.promise]);
  } finally {
    clearTimeout(timer);
    stop?.removeEventListener('abort', stopped);
  }
}

// Does:  Reads a callback's user id under the shared user-id grammar; null when it is outside it.
export function userIdOf(value: unknown): string | null {
  try {
    return checkUserId(value);
  } catch (error) {
    if (error instanceof AuthError) {
      return null;
    }
    throw error;
  }
}
