// Does:  Turns a declared route path into its segments: static, parameter or wildcard.
// Holds: The path has already passed the contract check; '/' is no segments, any other path one per slash.

import type { PathSegment } from './types.ts';

function toSegment(text: string): PathSegment {
  if (text === '*') {
    return { kind: 'wildcard' };
  }
  if (text.startsWith(':')) {
    return { kind: 'param', name: text.slice(1) };
  }
  return { kind: 'static', text };
}

export function parsePath(path: string): readonly PathSegment[] {
  if (path === '/') {
    return [];
  }
  return path.slice(1).split('/').map(toSegment);
}
