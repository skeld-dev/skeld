// Does:  Gives both OIDC handlers what they share: the address limit, the attempt cookie and the 503 answer.
// Holds: An over-limit request is answered 429, and an unavailable limit 503, before any other step.

import { HttpError } from '@skeld/core/http-error';
import type { Logger } from '@skeld/core/log';
import type { OutgoingCookie } from '@skeld/core/server';
import type { PartDeps } from '../server/internal-types.ts';

const ATTEMPT_SECONDS = 600;

export interface Limited {
  readonly status: 429;
  readonly body: { readonly status: number; readonly code: string; readonly message: string };
  readonly headers: { readonly 'retry-after': number };
}

export function unavailable(): HttpError {
  return new HttpError(503, 'AUTH_UNAVAILABLE', 'Service unavailable');
}

export function notFound(): HttpError {
  return new HttpError(404, 'NOT_FOUND', 'Not found');
}

// Does:  Charges the route's address limit: null to go on, the 429 reply when limited; throws 503 when unavailable.
export async function addressLimit(
  deps: PartDeps,
  routeName: string,
  request: { readonly clientAddress: string; readonly log: Logger; readonly signal: AbortSignal },
): Promise<Limited | null> {
  const verdict = await deps.limits.address(routeName, request);
  if (verdict.kind === 'unavailable') {
    throw unavailable();
  }
  if (verdict.kind === 'limited') {
    return {
      status: 429,
      body: { status: 429, code: 'RATE_LIMITED', message: 'Too many requests' },
      headers: { 'retry-after': verdict.retryAfterSeconds },
    };
  }
  return null;
}

// Does:  Builds the provider's attempt cookie with the session cookie's attributes; an empty value clears it.
export function attemptCookie(name: string, value: string): OutgoingCookie {
  return Object.freeze({
    name,
    value,
    path: '/',
    httpOnly: true,
    secure: true,
    sameSite: 'Lax',
    maxAge: value === '' ? 0 : ATTEMPT_SECONDS,
  });
}
