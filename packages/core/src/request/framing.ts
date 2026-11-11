// Does:  Checks the raw header list for a repeated Host and a Transfer-Encoding other than chunked.
// Holds: Only an exact 'chunked' Transfer-Encoding passes; any other coding, or a list of codings, is a fault.

import type { FramingFault } from './types.ts';

export function checkFraming(rawHeaders: readonly string[]): FramingFault | null {
  // Why: rawHeaders keeps the repeats that Node's merged headers object drops.
  let hosts = 0;
  for (let i = 0; i + 1 < rawHeaders.length; i += 2) {
    const name = rawHeaders[i]?.toLowerCase();
    if (name === 'host') {
      hosts += 1;
      if (hosts > 1) {
        return 'duplicate-host';
      }
    } else if (name === 'transfer-encoding' && rawHeaders[i + 1]?.trim().toLowerCase() !== 'chunked') {
      return 'transfer-encoding';
    }
  }
  return null;
}
