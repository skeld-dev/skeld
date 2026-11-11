import { maxEncodedBytes } from '../schema/size.ts';
import type { Schema } from '../schema/types.ts';

// Twice the densest encoding plus 1,024 bytes of whitespace allowance.
const ALLOWANCE_BYTES = 1024;

export function derivedBodyCap(body: Schema): number {
  return 2 * maxEncodedBytes(body) + ALLOWANCE_BYTES;
}
