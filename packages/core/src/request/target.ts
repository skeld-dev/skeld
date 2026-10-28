import type { ParsedTarget } from './types.ts';

const ABSOLUTE_FORM = /^https?:\/\//i;

export function splitTarget(url: string): ParsedTarget {
  const hash = url.indexOf('#');
  const target = hash === -1 ? url : url.slice(0, hash);
  const question = target.indexOf('?');
  const beforeQuery = question === -1 ? target : target.slice(0, question);
  const query = question === -1 ? '' : target.slice(question + 1);
  return { path: pathOf(beforeQuery), query };
}

function pathOf(beforeQuery: string): string {
  const scheme = ABSOLUTE_FORM.exec(beforeQuery);
  if (scheme === null) {
    return beforeQuery;
  }
  const pathStart = beforeQuery.indexOf('/', scheme[0].length);
  return pathStart === -1 ? '/' : beforeQuery.slice(pathStart);
}
