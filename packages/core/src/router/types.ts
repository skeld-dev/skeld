// Does:  Declares the router's interface and the outcomes of adding and finding a route.
// Holds: A path that cannot be routed is a result (not found, malformed, too long), never an exception.

import type { HttpMethod, PathSegment } from '../contract/types.ts';

export interface RouteParams {
  readonly [name: string]: string;
}

type AddResult<T> = { readonly kind: 'added' } | { readonly kind: 'duplicate'; readonly existing: T };

export type FindResult<T> =
  | { readonly kind: 'found'; readonly value: T; readonly params: RouteParams }
  | { readonly kind: 'not-found' }
  | { readonly kind: 'malformed-path' }
  | { readonly kind: 'param-too-long' };

export interface Router<T> {
  add(method: HttpMethod, path: string, segments: readonly PathSegment[], value: T): AddResult<T>;
  find(method: string, rawPath: string, maxParamLength: number): FindResult<T>;
}
