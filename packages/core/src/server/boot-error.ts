// Does:  Defines BootError and the codes for everything that can refuse a server before it listens.
// Holds: Every boot refusal carries one of the listed codes, and the route or plugin it concerns when there is one.

import type { RouteInfo } from '../contract/types.ts';

/**
 * Why a service could not boot.
 * The schema codes `UNBOUNDED_FIELD`, `INVALID_BOUND` and `SECRET_IN_RESPONSE` come from `listen` and name the route, part and JSON pointer.
 */
export type BootErrorCode =
  | 'INVALID_OPTION'
  | 'ROUTE_DUPLICATE'
  | 'ERROR_HANDLER_ALREADY_SET'
  | 'REGISTRATION_CLOSED'
  | 'PLUGIN_FAILED'
  | 'PLUGIN_TIMEOUT'
  | 'COMPILE_FAILED'
  | 'LISTEN_FAILED'
  | 'ALREADY_LISTENING'
  | 'SERVER_CLOSED'
  | 'UNBOUNDED_FIELD'
  | 'INVALID_BOUND'
  | 'SECRET_IN_RESPONSE'
  | 'CODEGEN_UNAVAILABLE';

/**
 * The error thrown when a service cannot boot: a bad option, a refused route or plugin, or a failed listen.
 * `code` names the reason; `route` and `plugin` say where, and are `null` when the error belongs to neither.
 */
export class BootError extends Error {
  override readonly name = 'BootError';
  readonly code: BootErrorCode;
  readonly route: RouteInfo | null;
  readonly plugin: string | null;

  constructor(
    code: BootErrorCode,
    message: string,
    route: RouteInfo | null,
    plugin: string | null,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.code = code;
    this.route = route;
    this.plugin = plugin;
  }
}
