// Does:  Reads a fetch response into nothing, text, parsed JSON or a failure, within a byte limit.
// Holds: No more than the limit plus one chunk is held, and no returned value nests deeper than the depth limit.

import { end, track } from '#diag';
import { exceedsJsonDepth } from '../schema/json-depth.ts';

export type ReadBody =
  | { readonly kind: 'none'; readonly body: null | '' }
  | { readonly kind: 'text'; readonly body: string }
  | { readonly kind: 'json'; readonly body: unknown }
  | { readonly kind: 'invalid-json'; readonly cause: unknown };

export type BodyResult =
  | ReadBody
  | { readonly kind: 'read-failed'; readonly cause: unknown }
  | { readonly kind: 'too-large' }
  | { readonly kind: 'too-deep' };

const DIGITS = /^\d+$/;

const MEDIA_TYPE = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+\/[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;

function mediaTypeOf(header: string | null): string | null {
  if (header === null) {
    return null;
  }
  const semicolon = header.indexOf(';');
  const type = (semicolon === -1 ? header : header.slice(0, semicolon)).trim();
  return MEDIA_TYPE.test(type) ? type.toLowerCase() : null;
}

// Does:  Reads the body as UTF-8 text, or returns null once the decoded bytes pass the limit and the read is cancelled.
async function readLimited(body: ReadableStream<Uint8Array>, limit: number): Promise<string | null> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let received = 0;
  let text = '';
  for (;;) {
    // biome-ignore lint/performance/noAwaitInLoops: each chunk is counted against the limit before the next is read.
    const chunk = await reader.read();
    if (chunk.done) {
      return text + decoder.decode();
    }
    received += chunk.value.byteLength;
    if (received > limit) {
      await reader.cancel();
      return null;
    }
    text += decoder.decode(chunk.value, { stream: true });
  }
}

// Does:  Reads the body unless it is absent; a body over limit bytes, declared or received, is too-large.
export async function readResponseBody(response: Response, limit: number): Promise<BodyResult> {
  const span = track('client.read');
  try {
    const { body } = response;
    if (response.status === 204 || response.status === 304 || body === null) {
      return { kind: 'none', body: null };
    }
    const declared = response.headers.get('content-length');
    if (declared !== null && DIGITS.test(declared) && Number(declared) > limit) {
      try {
        await body.cancel();
      } catch (cause) {
        return { kind: 'read-failed', cause };
      }
      return { kind: 'too-large' };
    }
    let text: string;
    try {
      const read = await readLimited(body, limit);
      if (read === null) {
        return { kind: 'too-large' };
      }
      text = read;
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
    if (exceedsJsonDepth(text)) {
      return { kind: 'too-deep' };
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
