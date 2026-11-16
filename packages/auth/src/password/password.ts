// Does:  Exports @skeld/auth/password: Argon2id hashing, verification and rehash advice over values a caller supplies.
// Holds: A hash or password outside its bounds is answered before any allocation for it or any computation.

import { argon2, randomBytes, timingSafeEqual } from 'node:crypto';
import { count, end, start } from '#diag';
import { expose, type Secret } from '@skeld/core/secret';
import { AuthError } from '../auth-error/auth-error.ts';
import { firstUnknownKey } from '../server/unknown-key.ts';
import { BUSY, inSlot } from './slots.ts';
import type { Hashed, PasswordCost, PasswordVerdict } from './types.ts';

export type { Hashed, PasswordCost, PasswordVerdict } from './types.ts';

const DEFAULT_COST: PasswordCost = Object.freeze({ memoryKiB: 19_456, passes: 2 });
const MAX_MEMORY_KIB = 262_144;
const MAX_WORK = 1_048_576;
const MAX_PASSWORD_BYTES = 1024;
const MAX_HASH_LENGTH = 256;
const SALT_BYTES = 16;
const TAG_BYTES = 32;
const PARAMS = /^m=([1-9]\d{0,6}),t=([1-9]\d{0,2}),p=([1-9])$/;
const BASE64 = /^[A-Za-z0-9+/]+$/;
const COST_KEYS: ReadonlySet<string> = new Set(['memoryKiB', 'passes']);
const HASH_OPTION_KEYS: ReadonlySet<string> = new Set(['cost', 'signal']);
const VERIFY_OPTION_KEYS: ReadonlySet<string> = new Set(['signal']);

const HASH_BUSY: Hashed = Object.freeze({ kind: 'busy' });
const INVALID_PASSWORD: Hashed = Object.freeze({ kind: 'invalid_password' });
const MATCH: PasswordVerdict = Object.freeze({ kind: 'match' });
const MISMATCH: PasswordVerdict = Object.freeze({ kind: 'mismatch' });
const INVALID_HASH: PasswordVerdict = Object.freeze({ kind: 'invalid_hash' });
const VERIFY_BUSY: PasswordVerdict = Object.freeze({ kind: 'busy' });

interface Parsed {
  readonly memoryKiB: number;
  readonly passes: number;
  readonly parallelism: number;
  readonly salt: Buffer;
  readonly tag: Buffer;
}

// Why: An unknown key is refused like every option object's, so a misspelt member never silently keeps a default.
function hasOnly(value: unknown, keys: ReadonlySet<string>): boolean {
  return typeof value === 'object' && value !== null && firstUnknownKey(value, keys) === null;
}

// Does:  Checks an application's cost and returns it, or the default when none is given.
function checkedCost(cost: PasswordCost | undefined): PasswordCost {
  if (cost === undefined) {
    return DEFAULT_COST;
  }
  if (!hasOnly(cost, COST_KEYS)) {
    throw new AuthError('INVALID_INPUT');
  }
  const { memoryKiB, passes } = cost;
  if (
    !Number.isInteger(memoryKiB) ||
    !Number.isInteger(passes) ||
    memoryKiB < DEFAULT_COST.memoryKiB ||
    memoryKiB > MAX_MEMORY_KIB ||
    passes < DEFAULT_COST.passes ||
    passes > 16 ||
    memoryKiB * passes > MAX_WORK
  ) {
    throw new AuthError('INVALID_INPUT');
  }
  return cost;
}

function passwordInBounds(password: string): boolean {
  // Why: A string's UTF-8 length is at least its code-unit count, so a long string is refused without encoding it.
  return (
    password.length > 0 &&
    password.length <= MAX_PASSWORD_BYTES &&
    Buffer.byteLength(password, 'utf8') <= MAX_PASSWORD_BYTES
  );
}

// Does:  Decodes canonical unpadded base64 of minBytes to maxBytes, or returns null.
function decoded(text: string, minBytes: number, maxBytes: number): Buffer | null {
  const bytes = Math.floor((text.length * 3) / 4);
  if (text.length % 4 === 1 || bytes < minBytes || bytes > maxBytes || !BASE64.test(text)) {
    return null;
  }
  const buffer = Buffer.from(text, 'base64');
  // Why: Node's decoder ignores stray trailing bits, so only a re-encoding that matches is one stored string.
  return buffer.length === bytes && buffer.toString('base64').replace(/=+$/, '') === text ? buffer : null;
}

// Does:  Parses an encoded Argon2id hash within the accepted bounds, or returns null.
function parse(hash: string): Parsed | null {
  if (hash.length > MAX_HASH_LENGTH) {
    return null;
  }
  const fields = hash.split('$');
  if (fields.length !== 6 || fields[0] !== '' || fields[1] !== 'argon2id' || fields[2] !== 'v=19') {
    return null;
  }
  const params = PARAMS.exec(fields[3] ?? '');
  if (params === null) {
    return null;
  }
  const memoryKiB = Number(params[1]);
  const passes = Number(params[2]);
  const parallelism = Number(params[3]);
  if (
    memoryKiB < 8 * parallelism ||
    memoryKiB > MAX_MEMORY_KIB ||
    passes > 16 ||
    parallelism > 4 ||
    memoryKiB * passes > MAX_WORK
  ) {
    return null;
  }
  const salt = decoded(fields[4] ?? '', 8, 64);
  const tag = salt === null ? null : decoded(fields[5] ?? '', 16, 64);
  if (salt === null || tag === null) {
    return null;
  }
  return { memoryKiB, passes, parallelism, salt, tag };
}

function compute(
  label: 'hash' | 'verify',
  password: string,
  salt: Buffer,
  params: {
    readonly memoryKiB: number;
    readonly passes: number;
    readonly parallelism: number;
    readonly tagBytes: number;
  },
): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    const span = start('auth.hash.compute', label);
    argon2(
      'argon2id',
      {
        message: password,
        nonce: salt,
        memory: params.memoryKiB,
        passes: params.passes,
        parallelism: params.parallelism,
        tagLength: params.tagBytes,
      },
      (error, derived) => {
        end(span);
        if (error !== null) {
          reject(new AuthError('UNAVAILABLE', { cause: error }));
          return;
        }
        count('auth.hash.computed', label);
        resolve(derived);
      },
    );
  });
}

const unpadded = (bytes: Buffer): string => bytes.toString('base64').replace(/=+$/, '');

/**
 * Hashes a password with Argon2id; `busy` when the two computations run and 64 callers wait.
 * A password not 1 to 1,024 bytes is `invalid_password`; a bad cost or option key rejects AuthError `INVALID_INPUT`.
 * @example await hashPassword(new Secret('correct horse battery staple'))
 */
export async function hashPassword(
  password: Secret<string>,
  options?: { readonly cost?: PasswordCost; readonly signal?: AbortSignal },
): Promise<Hashed> {
  if (options !== undefined && !hasOnly(options, HASH_OPTION_KEYS)) {
    throw new AuthError('INVALID_INPUT');
  }
  const cost = checkedCost(options?.cost);
  const text = expose(password);
  if (!passwordInBounds(text)) {
    return INVALID_PASSWORD;
  }
  const salt = randomBytes(SALT_BYTES);
  const tag = await inSlot(options?.signal, () =>
    compute('hash', text, salt, {
      memoryKiB: cost.memoryKiB,
      passes: cost.passes,
      parallelism: 1,
      tagBytes: TAG_BYTES,
    }),
  );
  if (tag === BUSY) {
    return HASH_BUSY;
  }
  return Object.freeze({
    kind: 'hashed',
    hash: `$argon2id$v=19$m=${cost.memoryKiB},t=${cost.passes},p=1$${unpadded(salt)}$${unpadded(tag)}`,
  });
}

/**
 * Verifies a password against an encoded Argon2id hash with the parameters it holds.
 * A hash out of bounds is `invalid_hash`, never `mismatch`; an unknown option key rejects AuthError `INVALID_INPUT`.
 * @example await verifyPassword(new Secret('correct horse battery staple'), '$argon2id$v=19$m=19456,t=2,p=1$sq6p/F+NCx9MMbhP5H+RyA$v9Qea79zKt24VcM7xMpNxSekAOB65j1RAIspflkC+x4')
 */
export async function verifyPassword(
  password: Secret<string>,
  hash: string,
  options?: { readonly signal?: AbortSignal },
): Promise<PasswordVerdict> {
  if (options !== undefined && !hasOnly(options, VERIFY_OPTION_KEYS)) {
    throw new AuthError('INVALID_INPUT');
  }
  const parsed = parse(hash);
  if (parsed === null) {
    return INVALID_HASH;
  }
  const text = expose(password);
  if (!passwordInBounds(text)) {
    return MISMATCH;
  }
  const derived = await inSlot(options?.signal, () =>
    compute('verify', text, parsed.salt, {
      memoryKiB: parsed.memoryKiB,
      passes: parsed.passes,
      parallelism: parsed.parallelism,
      tagBytes: parsed.tag.length,
    }),
  );
  if (derived === BUSY) {
    return VERIFY_BUSY;
  }
  return timingSafeEqual(derived, parsed.tag) ? MATCH : MISMATCH;
}

/**
 * Checks whether a hash falls below a cost (default 19,456 KiB, 2 passes) or does not parse; writes nothing.
 * Throws AuthError `INVALID_INPUT` for a cost out of bounds.
 * @example needsRehash('$argon2id$v=19$m=19456,t=2,p=1$sq6p/F+NCx9MMbhP5H+RyA$v9Qea79zKt24VcM7xMpNxSekAOB65j1RAIspflkC+x4', { memoryKiB: 65_536, passes: 3 })
 */
export function needsRehash(hash: string, cost?: PasswordCost): boolean {
  const wanted = checkedCost(cost);
  const parsed = parse(hash);
  return (
    parsed === null ||
    parsed.memoryKiB < wanted.memoryKiB ||
    parsed.passes < wanted.passes ||
    parsed.parallelism !== 1 ||
    parsed.salt.length < SALT_BYTES ||
    parsed.tag.length < TAG_BYTES
  );
}
