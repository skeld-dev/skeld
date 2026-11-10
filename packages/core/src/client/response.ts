import { end, track } from '#diag';

export type ReadBody =
  | { readonly kind: 'none'; readonly body: null | '' }
  | { readonly kind: 'text'; readonly body: string }
  | { readonly kind: 'json'; readonly body: unknown }
  | { readonly kind: 'invalid-json'; readonly cause: unknown };

export type BodyResult = ReadBody | { readonly kind: 'read-failed'; readonly cause: unknown };

const MEDIA_TYPE = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+\/[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;

function mediaTypeOf(header: string | null): string | null {
  if (header === null) {
    return null;
  }
  const semicolon = header.indexOf(';');
  const type = (semicolon === -1 ? header : header.slice(0, semicolon)).trim();
  return MEDIA_TYPE.test(type) ? type.toLowerCase() : null;
}

export async function readResponseBody(response: Response): Promise<BodyResult> {
  const span = track('client.read');
  try {
    if (response.status === 204 || response.status === 304 || response.body === null) {
      return { kind: 'none', body: null };
    }
    let text: string;
    try {
      text = await response.text();
    } catch (cause) {
      return { kind: 'read-failed', cause };
    }
    const contentType = response.headers.get('content-type');
    if (text === '' && contentType === null) {
      return { kind: 'none', body: null };
    }
    if (mediaTypeOf(contentType) !== 'application/json') {
      return text === '' ? { kind: 'none', body: '' } : { kind: 'text', body: text };
    }
    try {
      return { kind: 'json', body: JSON.parse(text) };
    } catch (cause) {
      return { kind: 'invalid-json', cause };
    }
  } finally {
    end(span);
  }
}
