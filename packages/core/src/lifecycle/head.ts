// Does:  Completes every response head the engine writes: request id, redirect check, Set-Cookie, CORS, security.
// Holds: A refused Location throws with nothing added to the head and no Location left on the response.

import type { OutgoingHttpHeaders, ServerResponse } from 'node:http';
import { event } from '#diag';
import { type CorsGrant, writeGrant } from '../cors/grant.ts';
import { checkRedirect } from '../redirect/redirect.ts';
import { engineFault } from './engine-fault.ts';
import type { RouteRuntime } from './types.ts';

const FIRST_REDIRECT = 300;
const LAST_REDIRECT = 399;

// Why: OWASP's REST guidance; the two frame bans cover old and new browsers, no-store keeps replies out of caches.
const SECURITY_HEADERS = [
  ['x-content-type-options', 'nosniff'],
  ['content-security-policy', "frame-ancestors 'none'"],
  ['x-frame-options', 'DENY'],
  ['cache-control', 'no-store'],
] as const;

// Does:  Replaces a 3xx response's Location with its checked form, or throws when the route may not send it.
function checkLocation(res: ServerResponse, route: RouteRuntime): void {
  const location = res.getHeader('location');
  if (location === undefined) {
    return;
  }
  const verdict = checkRedirect(location, route.redirectOrigins);
  if (verdict.kind === 'refused') {
    res.removeHeader('location');
    event('refuse.redirect', route.info.name);
    throw engineFault('redirect_refused', `redirect refused at ${route.info.name}: ${verdict.reason}`, null);
  }
  res.setHeader('location', verdict.location);
}

// Does:  Adds to the head about to be written what the response still needs; route is null for an engine-written error.
export function finishHead(
  res: ServerResponse,
  requestId: string,
  status: number,
  head: OutgoingHttpHeaders,
  securityHeaders: boolean,
  route: RouteRuntime | null,
  cookies: ReadonlyMap<string, string> | null,
  cors: CorsGrant | null,
): void {
  if (route !== null && status >= FIRST_REDIRECT && status <= LAST_REDIRECT) {
    checkLocation(res, route);
  }
  // Why: Set here, never with setHeader at request start, which would put every writeHead on Node's slow header path.
  head['x-request-id'] = requestId;
  // Why: One field line per cookie; a comma-joined Set-Cookie cannot be split back apart (RFC 9110 section 5.3).
  if (cookies !== null && cookies.size > 0) {
    head['set-cookie'] = [...cookies.values()];
  }
  if (cors !== null) {
    writeGrant(res, head, cors);
  }
  if (securityHeaders) {
    for (const [name, value] of SECURITY_HEADERS) {
      if (!res.hasHeader(name)) {
        head[name] = value;
      }
    }
  }
}
