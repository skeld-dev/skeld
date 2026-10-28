export type BodyResult =
  | { readonly kind: 'ok'; readonly body: unknown }
  | { readonly kind: 'read-failed'; readonly cause: unknown }
  | { readonly kind: 'invalid-json'; readonly cause: unknown };

const MEDIA_TYPE = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+\/[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;

function mediaTypeOf(header: string | null): string | null {
  if (header === null) {
    return null;
  }
  const end = header.indexOf(';');
  const type = (end === -1 ? header : header.slice(0, end)).trim();
  return MEDIA_TYPE.test(type) ? type.toLowerCase() : null;
}

export async function readResponseBody(response: Response): Promise<BodyResult> {
  if (response.status === 204 || response.status === 304 || response.body === null) {
    return { kind: 'ok', body: null };
  }
  let text: string;
  try {
    text = await response.text();
  } catch (cause) {
    return { kind: 'read-failed', cause };
  }
  const contentType = response.headers.get('content-type');
  if (text === '' && contentType === null) {
    return { kind: 'ok', body: null };
  }
  if (mediaTypeOf(contentType) !== 'application/json') {
    return { kind: 'ok', body: text };
  }
  try {
    return { kind: 'ok', body: JSON.parse(text) };
  } catch (cause) {
    return { kind: 'invalid-json', cause };
  }
}
