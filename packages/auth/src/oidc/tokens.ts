// Does:  Mints the OIDC attempt's random values and derives their digests and the PKCE challenge.
// Holds: The store sees a state or browser-binding token only as the SHA-256 of its 32 bytes, in one spelling.

import { createHash, randomBytes } from 'node:crypto';
import type { Digest } from '../store/types.ts';

const TOKEN_BYTES = 32;
const TOKEN_TEXT = /^[A-Za-z0-9_-]{43}$/;

export interface Minted {
  readonly text: string;
  readonly digest: Digest;
}

function digestOfBytes(bytes: Uint8Array): Digest {
  return new Uint8Array(createHash('sha256').update(bytes).digest());
}

export function mint(): Minted {
  const bytes = randomBytes(TOKEN_BYTES);
  return Object.freeze({ text: bytes.toString('base64url'), digest: digestOfBytes(bytes) });
}

// Does:  Reads a token's canonical 43 base64url characters as its digest; null for any other text.
// Holds: Only the one spelling whose 32 bytes encode back to the same text is read, so no token has a second spelling.
export function digestOf(text: string | undefined): Digest | null {
  if (text === undefined || !TOKEN_TEXT.test(text)) {
    return null;
  }
  const bytes = Buffer.from(text, 'base64url');
  return bytes.toString('base64url') === text ? digestOfBytes(bytes) : null;
}

// Why: RFC 7636 section 4.2: the S256 challenge is base64url of the SHA-256 of the verifier's ASCII text.
export function challengeOf(verifier: string): string {
  return createHash('sha256').update(verifier, 'ascii').digest('base64url');
}
