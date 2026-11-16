// Does:  Checks the user-id grammar every trusted session and subject call applies before it reaches the store.
// Holds: An accepted id is 1 to 128 characters of A-Z a-z 0-9 - _ . : and nothing else.

import { AuthError } from '../auth-error/auth-error.ts';

const USER_ID = /^[A-Za-z0-9._:-]{1,128}$/;

export function checkUserId(userId: unknown): string {
  if (typeof userId !== 'string' || !USER_ID.test(userId)) {
    throw new AuthError('INVALID_INPUT');
  }
  return userId;
}
