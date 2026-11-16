// Does:  Makes the process's outbound HTTPS requests for provider documents, key sets and token exchanges.
// Holds: A request runs only to a configured https URL with verification pinned on, follows no redirect, settles once.

import type { ClientRequest, IncomingMessage } from 'node:http';
import { Agent, request as httpsRequest } from 'node:https';
import { checkServerIdentity } from 'node:tls';
import { expose, type Secret } from '@skeld/core/secret';
import { count, end, limit, start } from '#diag';

const DEADLINE_MS = 5_000;
const MAX_BODY_BYTES = 262_144;
const MAX_IN_FLIGHT = 16;
const MAX_WAITING = 64;
const MAX_URL_LENGTH = 2_048;
// Why: Captured at load, so code that later replaces tls.checkServerIdentity cannot relax the host-name check.
const verifyHost = checkServerIdentity;
// Why: An agent's options override a request's (Node lib/_http_agent.js:393), so only auth's own agent keeps the pins.
const AGENT = new Agent({ keepAlive: false, rejectUnauthorized: true, checkServerIdentity: verifyHost });

export interface JsonObject {
  readonly [name: string]: unknown;
}

// Does:  An https URL taken from configuration or a configured provider's document, the only address a request accepts.
export interface ConfiguredUrl {
  readonly href: string;
}

const configured = new WeakSet<object>();

// Does:  Accepts an https URL of at most 2,048 characters with no userinfo and no fragment; null for anything else.
// Holds: Only a value returned here passes isConfiguredUrl; it is frozen, so its address never changes.
export function configuredUrl(text: string): ConfiguredUrl | null {
  if (text.length > MAX_URL_LENGTH || text.includes('#')) {
    return null;
  }
  const url = URL.parse(text);
  if (url === null || url.protocol !== 'https:' || url.username !== '' || url.password !== '') {
    return null;
  }
  const value: ConfiguredUrl = Object.freeze({ href: url.href });
  configured.add(value);
  return value;
}

function isConfiguredUrl(value: unknown): value is ConfiguredUrl {
  return typeof value === 'object' && value !== null && configured.has(value);
}

export interface OutboundRequest {
  readonly url: ConfiguredUrl;
  readonly form?: { readonly body: string; readonly authorization: Secret<string> };
  readonly signal?: AbortSignal;
}

export interface CacheHeaders {
  readonly cacheControl: string | undefined;
  readonly age: string | undefined;
  readonly expires: string | undefined;
  readonly date: string | undefined;
}

export type FetchFailure =
  | 'url'
  | 'bound'
  | 'aborted'
  | 'connect'
  | 'network'
  | 'deadline'
  | 'redirect'
  | 'status'
  | 'size'
  | 'json';

export type Fetched =
  | { readonly kind: 'ok'; readonly body: JsonObject; readonly headers: CacheHeaders }
  | { readonly kind: 'failed'; readonly reason: FetchFailure };

let inFlight = 0;
const waiting = new Set<() => void>();

export function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// Does:  Sends one request and resolves with the parsed JSON object of a 200 response or the reason it failed.
// Holds: It never rejects, and the failure carries a reason alone: nothing of the response, the URL or the secret.
export function fetchJson(request: OutboundRequest): Promise<Fetched> {
  if (!isConfiguredUrl(request.url)) {
    return refuse('url');
  }
  const signal = request.signal;
  if (signal?.aborted === true) {
    return refuse('aborted');
  }
  if (inFlight < MAX_IN_FLIGHT) {
    return run(request);
  }
  if (waiting.size >= MAX_WAITING) {
    return refuse('bound');
  }
  return new Promise((resolve) => {
    const go = (): void => {
      waiting.delete(go);
      signal?.removeEventListener('abort', drop);
      resolve(run(request));
    };
    const drop = (): void => {
      waiting.delete(go);
      limit('auth.outbound.waiting', waiting.size, MAX_WAITING);
      resolve(refuse('aborted'));
    };
    waiting.add(go);
    signal?.addEventListener('abort', drop, { once: true });
    limit('auth.outbound.waiting', waiting.size, MAX_WAITING);
  });
}

function failure(reason: FetchFailure): Fetched {
  return { kind: 'failed', reason };
}

function refuse(reason: FetchFailure): Promise<Fetched> {
  count('auth.outbound.refused', reason);
  return Promise.resolve(failure(reason));
}

function release(): void {
  inFlight -= 1;
  const next = waiting.values().next();
  if (next.done === true) {
    limit('auth.outbound.in_flight', inFlight, MAX_IN_FLIGHT);
    return;
  }
  next.value();
  limit('auth.outbound.waiting', waiting.size, MAX_WAITING);
}

function run(request: OutboundRequest): Promise<Fetched> {
  inFlight += 1;
  limit('auth.outbound.in_flight', inFlight, MAX_IN_FLIGHT);
  const form = request.form;
  const span = start('auth.outbound.fetch', form === undefined ? 'GET' : 'POST');
  return new Promise((resolve) => {
    let settled = false;
    let secured = false;
    const headers: Record<string, string> = { accept: 'application/json' };
    if (form !== undefined) {
      headers['content-type'] = 'application/x-www-form-urlencoded';
      headers['content-length'] = String(Buffer.byteLength(form.body));
      headers.authorization = expose(form.authorization);
    }
    // Why: The agent keeps no connection alive, so destroying the request ends its socket and nothing outlives it.
    let req: ClientRequest;
    try {
      // Why: Explicit, because the default reads NODE_TLS_REJECT_UNAUTHORIZED, which would switch verification off.
      req = httpsRequest(request.url.href, {
        method: form === undefined ? 'GET' : 'POST',
        headers,
        agent: AGENT,
        rejectUnauthorized: true,
        checkServerIdentity: verifyHost,
      });
    } catch (error) {
      // Why: Node throws TypeError before any socket for a header value it refuses, such as one holding a line break.
      if (!(error instanceof TypeError)) {
        throw error;
      }
      count('auth.outbound.refused', 'url');
      end(span);
      release();
      resolve(failure('url'));
      return;
    }
    const settle = (outcome: Fetched): void => {
      if (settled) {
        return;
      }
      settled = true;
      if (outcome.kind === 'failed') {
        count('auth.outbound.refused', outcome.reason);
      }
      clearTimeout(timer);
      request.signal?.removeEventListener('abort', abort);
      req.destroy();
      end(span);
      release();
      resolve(outcome);
    };
    const abort = (): void => settle(failure('aborted'));
    const timer = setTimeout(() => settle(failure('deadline')), DEADLINE_MS);
    request.signal?.addEventListener('abort', abort, { once: true });
    req.on('socket', (socket) => {
      socket.once('secureConnect', () => {
        secured = true;
      });
    });
    // Why: An error before the handshake completed is a refused connection: DNS, TCP or the certificate check.
    req.on('error', () => settle(failure(secured ? 'network' : 'connect')));
    req.on('response', (res) => readResponse(res, settle));
    req.end(form?.body);
  });
}

function readResponse(res: IncomingMessage, settle: (outcome: Fetched) => void): void {
  const status = res.statusCode ?? 0;
  if (status !== 200) {
    settle(failure(status >= 300 && status < 400 ? 'redirect' : 'status'));
    return;
  }
  const declared = res.headers['content-length'];
  if (declared !== undefined && Number(declared) > MAX_BODY_BYTES) {
    settle(failure('size'));
    return;
  }
  const chunks: Buffer[] = [];
  let total = 0;
  res.on('data', (chunk: Buffer) => {
    total += chunk.length;
    if (total > MAX_BODY_BYTES) {
      settle(failure('size'));
      return;
    }
    chunks.push(chunk);
  });
  res.on('error', () => settle(failure('network')));
  res.on('close', () => {
    if (!res.complete) {
      settle(failure('network'));
    }
  });
  res.on('end', () => {
    const body = parseJsonObject(Buffer.concat(chunks, total));
    if (body === null) {
      settle(failure('json'));
      return;
    }
    settle({
      kind: 'ok',
      body,
      headers: {
        cacheControl: res.headers['cache-control'],
        age: res.headers.age,
        expires: res.headers.expires,
        date: res.headers.date,
      },
    });
  });
}

// Does:  Decodes UTF-8 JSON text that must be one object; null for anything else.
export function parseJsonObject(bytes: Uint8Array): JsonObject | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch (error) {
    // Why: The decoder throws TypeError on invalid UTF-8 and JSON.parse throws SyntaxError; nothing else throws here.
    if (error instanceof TypeError || error instanceof SyntaxError) {
      return null;
    }
    throw error;
  }
  return isJsonObject(parsed) ? parsed : null;
}
