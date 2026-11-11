// Does:  Extracts the media type from a Content-Type header, ignoring its parameters.
// Holds: The type returned is lowercase and made of token characters only; parameters never reach the caller.

import { end, start } from '#diag';
import type { MediaTypeResult } from './types.ts';

// Why: type/subtype in RFC 9110 token characters (section 5.6.2), with optional whitespace around it.
const MEDIA_TYPE = /^[ \t]*([\w!#$%&'*+.^`|~-]+\/[\w!#$%&'*+.^`|~-]+)[ \t]*$/;

export function parseMediaType(header: string | undefined): MediaTypeResult {
  const span = start('req.body.media_type');
  if (header === undefined) {
    end(span);
    return { kind: 'missing' };
  }
  const semicolon = header.indexOf(';');
  const essence = MEDIA_TYPE.exec(semicolon === -1 ? header : header.slice(0, semicolon));
  end(span);
  if (essence?.[1] === undefined) {
    return { kind: 'invalid' };
  }
  return { kind: 'ok', type: essence[1].toLowerCase() };
}
