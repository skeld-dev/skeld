import { parsePath } from '../contract/path.ts';
import type { PathSegment } from '../contract/types.ts';

export interface CallValues {
  readonly [key: string]: unknown;
}

function encodePiece(piece: string, name: string, routeName: string): string {
  if (piece === '.' || piece === '..') {
    throw new TypeError(`Path parameter ${name} of ${routeName} cannot be "." or ".."`);
  }
  return encodeURIComponent(piece);
}

function encodeSegment(segment: PathSegment, params: CallValues | undefined, routeName: string): string {
  if (segment.kind === 'static') {
    return segment.text;
  }
  if (segment.kind === 'param') {
    return encodePiece(String(params?.[segment.name]), segment.name, routeName);
  }
  return String(params?.['*'])
    .split('/')
    .map((piece) => encodePiece(piece, '*', routeName))
    .join('/');
}

function appendQuery(search: URLSearchParams, key: string, value: unknown): void {
  if (value === undefined) {
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      appendQuery(search, key, item);
    }
    return;
  }
  search.append(key, String(value));
}

export function createUrlBuilder(
  base: string,
  routeName: string,
  path: string,
): (params: CallValues | undefined, query: CallValues | undefined) => URL {
  const segments = parsePath(path);
  return (params, query) => {
    const encoded = `/${segments.map((segment) => encodeSegment(segment, params, routeName)).join('/')}`;
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(query ?? {})) {
      appendQuery(search, key, value);
    }
    return new URL(search.size === 0 ? `${base}${encoded}` : `${base}${encoded}?${search}`);
  };
}
