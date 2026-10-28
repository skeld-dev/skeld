import type { CheckRow, RouteId, ServerId } from './types.ts';
import { expectedBody, expectedMediaType, host, preflightTimeoutMs } from './values.ts';

const bodyPreviewLength = 60;

export const echoRequestHeaders = { 'content-type': 'application/json' } as const;

const requestFor = (route: RouteId): RequestInit =>
  route === 'hello' ? { method: 'GET' } : { method: 'POST', headers: echoRequestHeaders, body: expectedBody };

const mediaTypeOf = (header: string | null): string | null =>
  header === null ? null : (header.split(';')[0] ?? '').trim().toLowerCase();

const answer = async (port: number, route: RouteId): Promise<{ response: Response; body: string } | null> => {
  try {
    const response = await fetch(`http://${host}:${port}/`, {
      ...requestFor(route),
      signal: AbortSignal.timeout(preflightTimeoutMs),
    });
    return { response, body: await response.text() };
  } catch (error) {
    if (error instanceof TypeError || (error instanceof DOMException && error.name === 'TimeoutError')) {
      return null;
    }
    throw error;
  }
};

export async function preflight(server: ServerId, port: number, route: RouteId): Promise<CheckRow> {
  const answered = await answer(port, route);
  if (answered === null) {
    return { server, route, started: true, status: null, mediaType: null, bytes: null, body: null, passed: false };
  }
  const { response, body } = answered;
  const mediaType = mediaTypeOf(response.headers.get('content-type'));
  return {
    server,
    route,
    started: true,
    status: response.status,
    mediaType,
    bytes: Buffer.byteLength(body),
    body,
    passed: response.status === 200 && mediaType === expectedMediaType && body === expectedBody,
  };
}

const preview = (body: string): string =>
  body.length > bodyPreviewLength ? `${body.slice(0, bodyPreviewLength)}…` : body;

export function preflightFailure(row: CheckRow): string {
  if (row.status === null) {
    return `${row.server} gave no answer to ${row.route}`;
  }
  return `${row.server} answers ${row.route} with ${row.status} ${row.mediaType ?? 'no content-type'} "${preview(row.body ?? '')}"; expected 200 ${expectedMediaType} ${expectedBody}`;
}
