// Does:  Declares every record the engine writes by name: its category, its severity and the reason codes it carries.
// Holds: EVENTS has exactly one entry per event name; a null severity or category is one the caller must give.

import type { Severity } from './types.ts';

export type Category = 'boot' | 'app' | 'security' | 'access';

export const SEVERITY_NUMBER: { readonly [S in Severity]: number } = Object.freeze({
  debug: 5,
  info: 9,
  warn: 13,
  error: 17,
  fatal: 21,
});

export type RefusalEvent =
  | 'skeld.refuse.framing'
  | 'skeld.refuse.path'
  | 'skeld.refuse.param_too_long'
  | 'skeld.refuse.body_limit'
  | 'skeld.refuse.body_depth'
  | 'skeld.refuse.forbidden_key'
  | 'skeld.refuse.csrf'
  | 'skeld.refuse.preflight'
  | 'skeld.refuse.validation'
  | 'skeld.refuse.not_found'
  | 'skeld.refuse.media_type'
  | 'skeld.refuse.body_json'
  | 'skeld.refuse.credential_missing'
  | 'skeld.refuse.credential_invalid'
  | 'skeld.refuse.credential_conflict'
  | 'skeld.refuse.csrf_token'
  | 'skeld.refuse.rate_limited'
  | 'skeld.refuse.access_denied'
  | 'skeld.refuse.access_hidden'
  | 'skeld.refuse.resource_missing'
  | 'skeld.refuse.unavailable';

export type ErrorEvent = 'skeld.request.error' | 'skeld.hook.error';

export type RequestErrorReason =
  | 'thrown'
  | 'http_error'
  | 'timeout'
  | 'undeclared_status'
  | 'response_mismatch'
  | 'reserved_header'
  | 'invalid_cookie'
  | 'redirect_refused'
  | 'send_status'
  | 'headers_sent'
  | 'gate';

export type HookErrorReason = 'on_response' | 'on_error' | 'late_send' | 'after_response' | 'internal';

type EventName =
  | RefusalEvent
  | ErrorEvent
  | 'skeld.server.listening'
  | 'skeld.server.closed'
  | 'skeld.config.public_origin'
  | 'skeld.log.dropped'
  | 'skeld.log.suppressed'
  | 'skeld.request.closed'
  | 'skeld.app.message';

interface EventSpec {
  readonly category: Category | null;
  readonly severity: Severity | null;
}

function spec(category: Category | null, severity: Severity | null): EventSpec {
  return Object.freeze({ category, severity });
}

export const EVENTS: { readonly [E in EventName]: EventSpec } = Object.freeze({
  'skeld.server.listening': spec('boot', 'info'),
  'skeld.server.closed': spec('boot', 'info'),
  'skeld.config.public_origin': spec('boot', 'warn'),
  'skeld.log.dropped': spec('boot', 'warn'),
  // Why: A summary takes the category and severity of the event it counts.
  'skeld.log.suppressed': spec(null, null),
  'skeld.request.error': spec('app', 'error'),
  'skeld.hook.error': spec('app', 'error'),
  'skeld.refuse.framing': spec('security', 'warn'),
  'skeld.refuse.path': spec('security', 'warn'),
  'skeld.refuse.param_too_long': spec('security', 'warn'),
  'skeld.refuse.body_limit': spec('security', 'warn'),
  'skeld.refuse.body_depth': spec('security', 'warn'),
  'skeld.refuse.forbidden_key': spec('security', 'warn'),
  'skeld.refuse.csrf': spec('security', 'warn'),
  'skeld.refuse.preflight': spec('security', 'warn'),
  'skeld.refuse.validation': spec('security', 'info'),
  'skeld.refuse.not_found': spec('security', 'info'),
  'skeld.refuse.media_type': spec('security', 'info'),
  'skeld.refuse.body_json': spec('security', 'info'),
  'skeld.refuse.credential_missing': spec('security', 'info'),
  'skeld.refuse.credential_invalid': spec('security', 'warn'),
  'skeld.refuse.credential_conflict': spec('security', 'warn'),
  'skeld.refuse.csrf_token': spec('security', 'warn'),
  'skeld.refuse.rate_limited': spec('security', 'warn'),
  'skeld.refuse.access_denied': spec('security', 'warn'),
  'skeld.refuse.access_hidden': spec('security', 'warn'),
  'skeld.refuse.resource_missing': spec('security', 'info'),
  'skeld.refuse.unavailable': spec('security', 'error'),
  'skeld.request.closed': spec('access', 'info'),
  // Why: An author's record takes the severity of the method called.
  'skeld.app.message': spec('app', null),
});

export const KNOWN_METHODS: ReadonlySet<string> = new Set([
  'GET',
  'HEAD',
  'POST',
  'PUT',
  'PATCH',
  'DELETE',
  'OPTIONS',
  'CONNECT',
  'TRACE',
]);
