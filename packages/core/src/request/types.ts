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
