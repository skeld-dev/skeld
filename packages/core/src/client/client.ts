// Does:  Defines createClient: one typed call per route, built from the same contract the server uses.
// Holds: A response body is read within its status's byte limit and checked against its schema before it is returned.

import { end, event, track } from '#diag';
import { derivedBodyCap } from '../compile/body-cap.ts';
import { HttpError } from '../contract/http-error.ts';
import { isUnsafeMethod } from '../csrf/check.ts';
import { CSRF_TOKEN_HEADER } from '../gate/gate.ts';
import type { ContractRoutes, ErrorDetail, RouteDefinition } from '../contract/types.ts';
import { compileCheck } from '../schema/check.ts';
import { explain } from '../schema/explain.ts';
import { compileFinish } from '../schema/finish.ts';
import { MAX_JSON_DEPTH, tooDeepPointer } from '../schema/json-depth.ts';
import { isRequired } from '../schema/messages.ts';
import { toPointer } from '../schema/pointer.ts';
import type { Check, Finish, Schema } from '../schema/types.ts';
import { type ReadBody, readResponseBody } from './response.ts';
import type { Client, ClientCredential, ClientOptions } from './types.ts';
import { type CallValues, createUrlBuilder } from './url.ts';

export type {
  CallInput,
  CallResult,
  Client,
  ClientCredential,
  ClientOptions,
  FetchStatus,
  RouteCall,
} from './types.ts';

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

interface ResponseLimits {
  readonly byStatus: ReadonlyMap<number, number>;
  readonly fallback: number;
}

// Why: The server's default bodyLimit; a response no schema bounds is held to what a request may carry.
const FALLBACK_RESPONSE_BYTES = 1_048_576;

// Why: RFC 6750 section 2.1 writes a bearer token as b64token; the contract bounds it to 4,096 characters.
const BEARER_TOKEN = /^[A-Za-z0-9\-._~+/]+=*$/;
const MAX_BEARER_TOKEN = 4096;
const CSRF_TOKEN = /^[A-Za-z0-9_-]{1,256}$/;
const CREDENTIAL_HEADERS = ['authorization', CSRF_TOKEN_HEADER] as const;

// Why: The Fetch standard's redirect statuses (https://fetch.spec.whatwg.org/#redirect-status); 304 is not one.
const REDIRECT_STATUSES: ReadonlySet<number> = new Set([301, 302, 303, 307, 308]);

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

function parseMaxResponseBytes(value: number | undefined): number | null {
  if (value === undefined) {
    return null;
  }
  if (!(Number.isSafeInteger(value) && value > 0)) {
    throw new TypeError(`createClient: maxResponseBytes must be a positive integer, got ${String(value)}`);
  }
  return value;
}

// Does:  Refuses a route whose body or response schema lets a valid value nest past the JSON depth limit.
function checkDepth(name: string, route: RouteDefinition): void {
  const parts: [string, Schema | null | undefined][] = [
    ['body', route.body],
    ...Object.entries(route.responses).map(([status, schema]): [string, Schema | null] => [
      `responses.${status}`,
      schema,
    ]),
  ];
  for (const [part, schema] of parts) {
    const pointer = schema === null || schema === undefined ? null : tooDeepPointer(schema);
    if (pointer !== null) {
      throw new TypeError(
        `createClient: route ${name}: ${part} schema at "${pointer}" nests deeper than ${MAX_JSON_DEPTH} arrays and objects`,
      );
    }
  }
}

// Does:  Copies the credential option once: absent, a bearer token function or a session CSRF token function.
function parseCredential(credential: ClientCredential | undefined): ClientCredential | null {
  if (credential === undefined) {
    return null;
  }
  const value: unknown = credential;
  if (typeof value === 'object' && value !== null) {
    if (credential.kind === 'bearer' && typeof credential.token === 'function') {
      return Object.freeze({ kind: 'bearer', token: credential.token });
    }
    if (credential.kind === 'session' && typeof credential.csrfToken === 'function') {
      return Object.freeze({ kind: 'session', csrfToken: credential.csrfToken });
    }
  }
  throw new TypeError("createClient: credential must be { kind: 'bearer', token } or { kind: 'session', csrfToken }");
}

// Does:  Refuses a non-public route whose headers schema declares a header the client's credential writes.
function checkCredentialHeaders(name: string, route: RouteDefinition): void {
  if (route.access === 'public' || route.headers === undefined) {
    return;
  }
  const { properties } = route.headers;
  const declared = CREDENTIAL_HEADERS.find((header) => Object.hasOwn(properties, header));
  if (declared !== undefined) {
    throw new TypeError(`createClient: route ${name}: headers declares ${declared}, which the credential writes`);
  }
}

function credentialUnavailable(cause?: unknown): HttpError {
  event('client.error', 'CREDENTIAL_UNAVAILABLE');
  return new HttpError(null, 'CREDENTIAL_UNAVAILABLE', 'Credential unavailable', cause === undefined ? {} : { cause });
}

async function readToken(read: () => unknown): Promise<unknown> {
  try {
    return await read();
  } catch (cause) {
    throw credentialUnavailable(cause);
  }
}

// Does:  Reads the credential's token for one call and returns the header it goes in, or null for none.
// Holds: A token outside its grammar is never written to a header, and its value enters no error.
async function credentialHeader(
  credential: ClientCredential,
  unsafe: boolean,
): Promise<readonly [string, string] | null> {
  if (credential.kind === 'bearer') {
    const token = await readToken(credential.token);
    if (typeof token !== 'string' || token.length > MAX_BEARER_TOKEN || !BEARER_TOKEN.test(token)) {
      throw credentialUnavailable();
    }
    return ['authorization', `Bearer ${token}`];
  }
  if (!unsafe) {
    return null;
  }
  const token = await readToken(credential.csrfToken);
  if (token === null) {
    return null;
  }
  if (typeof token !== 'string' || !CSRF_TOKEN.test(token)) {
    throw credentialUnavailable();
  }
  return [CSRF_TOKEN_HEADER, token];
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

// Does:  Sets each declared status's byte limit from its schema's derived cap; an override replaces every limit.
function responseLimits(route: RouteDefinition, override: number | null): ResponseLimits {
  const byStatus = new Map<number, number>();
  if (override !== null) {
    return { byStatus, fallback: override };
  }
  for (const [key, schema] of Object.entries(route.responses)) {
    const cap = schema === null ? Number.POSITIVE_INFINITY : derivedBodyCap(schema);
    byStatus.set(Number(key), Number.isFinite(cap) ? cap : FALLBACK_RESPONSE_BYTES);
  }
  return { byStatus, fallback: FALLBACK_RESPONSE_BYTES };
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

// Does:  Cancels a redirect's body and builds the rejection; the message never holds the Location or concrete URL.
async function redirectError(target: string, response: Response): Promise<HttpError> {
  // Why: A browser's manual mode hides a redirect's status as an opaqueredirect response with status 0.
  const answered = response.type === 'opaqueredirect' ? 'answered' : `answered ${response.status}`;
  const message = `${target} ${answered} with a redirect, which the client does not follow`;
  event('client.error', 'REDIRECT_NOT_SUPPORTED');
  try {
    await response.body?.cancel();
  } catch (cause) {
    // Why: The redirect is what the caller must act on; a failed cancel is kept as its cause, not made a NETWORK error.
    return new HttpError(null, 'REDIRECT_NOT_SUPPORTED', message, { cause });
  }
  return new HttpError(null, 'REDIRECT_NOT_SUPPORTED', message);
}

function createCall(
  name: string,
  route: RouteDefinition,
  base: string,
  fetch: typeof globalThis.fetch,
  maxResponseBytes: number | null,
  credential: ClientCredential | null,
): (input?: CallParts) => Promise<ReceivedResult> {
  checkDepth(name, route);
  if (credential !== null) {
    checkCredentialHeaders(name, route);
  }
  // Why: A token goes only to a route that is not public, so a public call never acquires one.
  const sendsToken = credential !== null && route.access !== 'public';
  const unsafe = isUnsafeMethod(route.method);
  const credentials: RequestInit['credentials'] =
    credential === null ? undefined : credential.kind === 'bearer' ? 'omit' : 'include';
  const buildUrl = createUrlBuilder(base, name, route.path);
  const validators = compileResponseValidators(route);
  const limits = responseLimits(route, maxResponseBytes);
  return async (input) => {
    const call = track('client.call', name);
    try {
      const url = buildUrl(input?.params, input?.query);
      // Why: Concrete parameters and queries may hold secrets; diagnostics use only the declared route.
      const target = `${route.method} ${url.origin}${route.path}`;
      const headers = buildHeaders(route, input?.headers);
      const header = sendsToken && credential !== null ? await credentialHeader(credential, unsafe) : null;
      if (header !== null) {
        headers.set(header[0], header[1]);
      }
      // Why: A followed redirect would be read against this route's responses and re-send a 307 or 308 body elsewhere.
      const init: RequestInit = {
        method: route.method,
        headers,
        redirect: 'manual',
        ...(credentials === undefined ? {} : { credentials }),
        ...(route.body === undefined ? {} : { body: JSON.stringify(input?.body) }),
      };
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
      if (response.type === 'opaqueredirect' || REDIRECT_STATUSES.has(response.status)) {
        throw await redirectError(target, response);
      }
      const limit = limits.byStatus.get(response.status) ?? limits.fallback;
      const read = await readResponseBody(response, limit);
      switch (read.kind) {
        case 'read-failed':
          event('client.error', 'NETWORK');
          throw new HttpError(null, 'NETWORK', `${target} failed: ${failureText(read.cause)}`, { cause: read.cause });
        case 'too-large':
          event('client.error', 'RESPONSE_TOO_LARGE');
          throw new HttpError(
            null,
            'RESPONSE_TOO_LARGE',
            `${target} answered ${response.status} with a body over the limit of ${limit} bytes`,
          );
        case 'too-deep':
          event('client.error', 'INVALID_RESPONSE');
          throw new HttpError(
            null,
            'INVALID_RESPONSE',
            `${target} answered ${response.status} with a body nested deeper than ${MAX_JSON_DEPTH}`,
          );
        default:
          break;
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
 * A call never follows a redirect and rejects with HttpError `NETWORK`, `INVALID_RESPONSE`, `RESPONSE_TOO_LARGE`, `REDIRECT_NOT_SUPPORTED` or `CREDENTIAL_UNAVAILABLE`; throws `TypeError` for a bad option or a schema nested past 64.
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
  const maxResponseBytes = parseMaxResponseBytes(options.maxResponseBytes);
  const credential = parseCredential(options.credential);
  return Object.fromEntries(
    Object.entries(contract).map(([name, route]) => [
      name,
      createCall(name, route, base, fetch, maxResponseBytes, credential),
    ]),
  );
}
