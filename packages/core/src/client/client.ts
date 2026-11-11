// Does:  Defines createClient: one typed call per route, built from the same contract the server uses.
// Holds: A declared response body is checked against its schema before the caller sees it.

import { end, event, track } from '#diag';
import { HttpError } from '../contract/http-error.ts';
import type { ContractRoutes, ErrorDetail, RouteDefinition } from '../contract/types.ts';
import { compileCheck } from '../schema/check.ts';
import { explain } from '../schema/explain.ts';
import { compileFinish } from '../schema/finish.ts';
import { isRequired } from '../schema/messages.ts';
import { toPointer } from '../schema/pointer.ts';
import type { Check, Finish, Schema } from '../schema/types.ts';
import { type ReadBody, readResponseBody } from './response.ts';
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

interface ResponseValidator {
  readonly schema: Schema;
  readonly check: Check;
  readonly finish: Finish | null;
}

interface RuntimeClient {
  readonly [name: string]: (input?: CallParts) => Promise<ReceivedResult>;
}

// Does:  Returns the base as origin and path with no trailing slash; anything but a clean http(s) URL is refused.
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

function compileResponseValidators(route: RouteDefinition): ReadonlyMap<number, ResponseValidator> {
  const validators = new Map<number, ResponseValidator>();
  for (const key of Object.keys(route.responses)) {
    const status = Number(key);
    const schema = route.responses[status];
    if (schema !== null && schema !== undefined) {
      // Why: The closure check, not the generated one, so the client runs where code generation is forbidden.
      validators.set(status, { schema, check: compileCheck(schema), finish: compileFinish(schema, 'raw') });
    }
  }
  return validators;
}

function bodyDetails(validator: ResponseValidator, read: ReadBody): readonly ErrorDetail[] {
  if (read.kind === 'json') {
    return explain(validator.schema, read.body, 100).map((issue) => ({
      path: `/body${toPointer(issue.path)}`,
      message: issue.message,
    }));
  }
  return [{ path: '/body', message: read.kind === 'none' ? isRequired : 'must be JSON' }];
}

function validateResponse(validator: ResponseValidator, target: string, status: number, read: ReadBody): unknown {
  const span = track('client.validate');
  try {
    if (read.kind === 'json' && validator.check(read.body)) {
      return validator.finish === null ? read.body : validator.finish(read.body);
    }
    const details = bodyDetails(validator, read);
    event('client.error', 'INVALID_RESPONSE');
    throw new HttpError(
      null,
      'INVALID_RESPONSE',
      `${target} answered ${status} with a body that does not match the contract`,
      { details },
    );
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
  const validators = compileResponseValidators(route);
  return async (input) => {
    const call = track('client.call', name);
    try {
      const url = buildUrl(input?.params, input?.query);
      // Why: Error messages name the method, origin and path only; a query may hold a secret.
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
      const validator = validators.get(response.status);
      if (validator !== undefined) {
        const body = validateResponse(validator, target, response.status, read);
        return { status: response.status, headers: response.headers, body };
      }
      // Why: An undeclared status has no schema; only a body that claims to be JSON and is not is refused.
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

/**
 * Creates a typed client with one call per route of a contract.
 * A call rejects with HttpError `INVALID_RESPONSE` when a declared body fails its schema; throws `TypeError` for a bad `baseUrl`.
 * @example createClient(defineContract({ health: { method: 'GET', path: '/health', responses: { 204: null } } }), { baseUrl: 'http://127.0.0.1:3000' })
 */
export function createClient<const C extends ContractRoutes>(contract: C, options: ClientOptions): Client<C>;
// Why: The one erasure point: a mapped Client<C> cannot be built by a loop, so this overload adds RuntimeClient.
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
