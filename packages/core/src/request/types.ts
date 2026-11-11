// Does:  Declares the results of the request parsers: target, query, media type, body read and JSON parse.
// Holds: Every parser result is a union tagged by kind, so a refusal is a value the caller must handle.

export type FramingFault = 'duplicate-host' | 'transfer-encoding';

export interface ParsedTarget {
  readonly path: string;
  readonly query: string;
}

export interface QueryObject {
  readonly [key: string]: string | readonly string[];
}

export type MediaTypeResult =
  | { readonly kind: 'missing' }
  | { readonly kind: 'invalid' }
  | { readonly kind: 'ok'; readonly type: string };

export type BodyReadResult =
  | { readonly kind: 'ok'; readonly text: string }
  | { readonly kind: 'too-large' }
  | { readonly kind: 'aborted' };

export type JsonParseResult =
  | { readonly kind: 'ok'; readonly value: unknown }
  | { readonly kind: 'invalid-json' }
  | { readonly kind: 'forbidden-key'; readonly key: '__proto__' | 'constructor.prototype' };
