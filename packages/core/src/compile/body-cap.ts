// Does:  Derives a route's body cap from the densest JSON encoding its body schema allows.
// Holds: A valid body in its densest encoding always fits: the cap is twice that size plus 1,024 bytes.

import { maxEncodedBytes } from '../schema/size.ts';
import type { Schema } from '../schema/types.ts';

// Why: The densest encoding has no whitespace; doubling it and adding this leaves room for a formatted body.
const ALLOWANCE_BYTES = 1024;

export function derivedBodyCap(body: Schema): number {
  return 2 * maxEncodedBytes(body) + ALLOWANCE_BYTES;
}
