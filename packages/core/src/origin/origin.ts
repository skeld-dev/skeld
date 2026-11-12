// Does:  Parses an origin a boot option names: an http or https scheme, a host and an optional port.
// Holds: An accepted value is returned unchanged and equals its own WHATWG URL origin; anything else throws.

import { BootError } from '../server/boot-error.ts';

// Does:  Returns the value when it is exactly an http or https origin; throws BootError INVALID_OPTION naming option.
export function parseOrigin(value: unknown, option: string): string {
  const url = typeof value === 'string' ? URL.parse(value) : null;
  // Why: Only the exact serialisation is accepted, so a path, a default port or upper case cannot widen the match.
  if (url === null || (url.protocol !== 'http:' && url.protocol !== 'https:') || url.origin !== value) {
    throw new BootError(
      'INVALID_OPTION',
      `Invalid ${option}: ${String(value)} is not an origin; write the scheme, host and port only, as new URL(x).origin gives it`,
      null,
      null,
    );
  }
  return url.origin;
}
