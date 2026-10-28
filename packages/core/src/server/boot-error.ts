import type { RouteInfo } from '../contract/types.ts';

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
  | 'SERVER_CLOSED';

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
