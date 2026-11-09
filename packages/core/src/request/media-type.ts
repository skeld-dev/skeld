import { end, start } from '#diag';
import type { MediaTypeResult } from './types.ts';

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
