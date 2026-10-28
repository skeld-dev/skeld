import type { FramingFault } from './types.ts';

export function checkFraming(rawHeaders: readonly string[]): FramingFault | null {
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
