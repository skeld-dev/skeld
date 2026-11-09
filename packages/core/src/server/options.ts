import { end, start } from '#diag';
import { BootError } from './boot-error.ts';
import type { ListenOptions, ResolvedServerOptions, ServerOptions } from './types.ts';

const DEFAULTS: ResolvedServerOptions = {
  bodyLimit: 1_048_576,
  maxParamLength: 100,
  pluginTimeoutMs: 10_000,
  closeTimeoutMs: 10_000,
  keepAliveTimeout: 72_000,
  requestTimeout: 300_000,
  headersTimeout: 60_000,
  maxHeaderSize: 16_384,
};

const DEFAULT_HOST = '127.0.0.1';
const MAX_PORT = 65_535;

export interface ListenTarget {
  readonly host: string;
  readonly port: number;
}

function invalidOption(message: string): BootError {
  return new BootError('INVALID_OPTION', message, null, null);
}

function positiveInteger(name: keyof ServerOptions, value: number | undefined): number {
  if (value === undefined) {
    return DEFAULTS[name];
  }
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw invalidOption(`Invalid server option ${name}: must be a positive integer, got ${value}`);
  }
  return value;
}

export function resolveServerOptions(options: ServerOptions): ResolvedServerOptions {
  const span = start('boot.options');
  try {
    const resolved: ResolvedServerOptions = {
      bodyLimit: positiveInteger('bodyLimit', options.bodyLimit),
      maxParamLength: positiveInteger('maxParamLength', options.maxParamLength),
      pluginTimeoutMs: positiveInteger('pluginTimeoutMs', options.pluginTimeoutMs),
      closeTimeoutMs: positiveInteger('closeTimeoutMs', options.closeTimeoutMs),
      keepAliveTimeout: positiveInteger('keepAliveTimeout', options.keepAliveTimeout),
      requestTimeout: positiveInteger('requestTimeout', options.requestTimeout),
      headersTimeout: positiveInteger('headersTimeout', options.headersTimeout),
      maxHeaderSize: positiveInteger('maxHeaderSize', options.maxHeaderSize),
    };
    if (resolved.headersTimeout > resolved.requestTimeout) {
      throw invalidOption(
        `Invalid server option headersTimeout: must not exceed requestTimeout (${resolved.headersTimeout} > ${resolved.requestTimeout})`,
      );
    }
    return resolved;
  } finally {
    end(span);
  }
}

export function resolveListenOptions(options: ListenOptions): ListenTarget {
  const { port, host = DEFAULT_HOST } = options;
  if (!Number.isInteger(port) || port < 0 || port > MAX_PORT) {
    throw invalidOption(`Invalid listen option port: must be an integer from 0 to ${MAX_PORT}, got ${port}`);
  }
  if (host === '') {
    throw invalidOption('Invalid listen option host: must not be empty');
  }
  return { host, port };
}
