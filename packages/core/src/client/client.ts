import { end, event, track } from '#diag';
import { HttpError } from '../contract/http-error.ts';
import type { ContractRoutes, RouteDefinition } from '../contract/types.ts';
import { readResponseBody } from './response.ts';
import type { Client, ClientOptions } from './types.ts';
import { type CallValues, createUrlBuilder } from './url.ts';

export type { CallInput, CallResult, Client, ClientOptions, FetchStatus, RouteCall } from './types.ts';

interface CallParts {
  readonly params?: CallValues;
  readonly query?: CallValues;
  readonly headers?: CallValues;
  readonly body?: unknown;
}

interface ReceivedResult {
  readonly status: number;
  readonly headers: Headers;
  readonly body: unknown;
}

interface RuntimeClient {
  readonly [name: string]: (input?: CallParts) => Promise<ReceivedResult>;
}

function parseBaseUrl(baseUrl: string | URL): string {
  const text = String(baseUrl);
  const url = URL.parse(text);
  if (
    url === null ||
    (url.protocol !== 'http:' && url.protocol !== 'https:') ||
    url.href.includes('?') ||
    url.href.includes('#')
  ) {
    throw new TypeError(
      `createClient: baseUrl must be an absolute http or https URL with no query or fragment, got "${text}"`,
    );
  }
  return `${url.origin}${url.pathname}`.replace(/\/+$/, '');
}

function failureText(error: unknown): string {
  if (!(error instanceof Error)) {
    return String(error);
  }
  return error.cause instanceof Error ? `${error.message} (${error.cause.message})` : error.message;
}

function buildHeaders(route: RouteDefinition, input: CallValues | undefined): Headers {
  const span = track('client.headers');
  try {
    const headers = new Headers();
    for (const [name, value] of Object.entries(input ?? {})) {
      if (value !== undefined) {
        headers.set(name, String(value));
      }
    }
    if (route.body !== undefined) {
      headers.set('content-type', 'application/json');
    }
    return headers;
  } finally {
    end(span);
  }
}

function createCall(
  name: string,
  route: RouteDefinition,
  base: string,
  fetch: typeof globalThis.fetch,
): (input?: CallParts) => Promise<ReceivedResult> {
  const buildUrl = createUrlBuilder(base, name, route.path);
  return async (input) => {
    const call = track('client.call', name);
    try {
      const url = buildUrl(input?.params, input?.query);
      const target = `${route.method} ${url.origin}${url.pathname}`;
      const headers = buildHeaders(route, input?.headers);
      const init: RequestInit =
        route.body === undefined
          ? { method: route.method, headers }
          : { method: route.method, headers, body: JSON.stringify(input?.body) };
      let response: Response;
      const wait = track('client.fetch');
      try {
        response = await fetch(url, init);
      } catch (cause) {
        end(wait);
        event('client.error', 'NETWORK');
        throw new HttpError(null, 'NETWORK', `${target} failed: ${failureText(cause)}`, { cause });
      }
      end(wait);
      const read = await readResponseBody(response);
      if (read.kind === 'read-failed') {
        event('client.error', 'NETWORK');
        throw new HttpError(null, 'NETWORK', `${target} failed: ${failureText(read.cause)}`, { cause: read.cause });
      }
      if (read.kind === 'invalid-json') {
        event('client.error', 'INVALID_RESPONSE');
        throw new HttpError(
          null,
          'INVALID_RESPONSE',
          `${target} answered ${response.status} with a body that is not valid JSON`,
          { cause: read.cause },
        );
      }
      return { status: response.status, headers: response.headers, body: read.body };
    } finally {
      end(call);
    }
  };
}

export function createClient<const C extends ContractRoutes>(contract: C, options: ClientOptions): Client<C>;
// The one erasure point: a mapped Client<C> cannot be built by a loop, so this overload pairs it with RuntimeClient.
export function createClient<const C extends ContractRoutes>(
  contract: C,
  options: ClientOptions,
): Client<C> | RuntimeClient {
  const base = parseBaseUrl(options.baseUrl);
  const fetch = options.fetch ?? globalThis.fetch;
  return Object.fromEntries(
    Object.entries(contract).map(([name, route]) => [name, createCall(name, route, base, fetch)]),
  );
}
