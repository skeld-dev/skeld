import type { MediaTypeResult } from './types.ts';

const MEDIA_TYPE = /^[ \t]*([\w!#$%&'*+.^`|~-]+\/[\w!#$%&'*+.^`|~-]+)[ \t]*$/;

export function parseMediaType(header: string | undefined): MediaTypeResult {
  if (header === undefined) {
    return { kind: 'missing' };
  }
  const semicolon = header.indexOf(';');
  const essence = MEDIA_TYPE.exec(semicolon === -1 ? header : header.slice(0, semicolon));
  if (essence?.[1] === undefined) {
    return { kind: 'invalid' };
  }
  return { kind: 'ok', type: essence[1].toLowerCase() };
}
