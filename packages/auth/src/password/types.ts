// Does:  Declares the password helpers' cost and outcomes.
// Holds: A hash that does not parse is invalid_hash, never a mismatch; a busy computation is busy, never an answer.

/** An Argon2id cost; a given cost may only raise the default of 19,456 KiB and 2 passes. */
export interface PasswordCost {
  /** Memory in KiB, from 19,456 to 262,144; times `passes` at most 1,048,576. */
  readonly memoryKiB: number;
  /** Passes, from 2 to 16. */
  readonly passes: number;
}

/** The outcome of `hashPassword`. */
export type Hashed =
  | {
      /** Whether the password was hashed, refused for its length, or not hashed because the queue was full. */
      readonly kind: 'hashed';
      /** The encoded hash, `$argon2id$v=19$m=<m>,t=<t>,p=1$<salt>$<tag>`. */
      readonly hash: string;
    }
  | { readonly kind: 'invalid_password' }
  | { readonly kind: 'busy' };

/** The outcome of `verifyPassword`. */
export type PasswordVerdict =
  | {
      /** Whether the password matched, did not match, met a hash out of bounds, or met a full queue. */
      readonly kind: 'match';
    }
  | { readonly kind: 'mismatch' }
  | { readonly kind: 'invalid_hash' }
  | { readonly kind: 'busy' };
