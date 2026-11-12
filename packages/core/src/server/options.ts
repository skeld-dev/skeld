// Does:  Resolves and checks the server and listen options against their defaults.
// Holds: Every limit is a positive safe integer, every timer fits Node's timers, every proxy and origin entry is valid.

import { BlockList, isIP } from 'node:net';
import { end, start } from '#diag';
import { resolveCors } from '../cors/policy.ts';
import { BASELINE, resolveCsrf, resolvePublicOrigin } from '../csrf/policy.ts';
import { parseOrigin } from '../origin/origin.ts';
import { BootError } from './boot-error.ts';
import type { ListenOptions, ResolvedServerOptions, ServerOptions } from './types.ts';

const DEFAULTS: ResolvedServerOptions = {
  bodyLimit: 1_048_576,
  maxParamLength: 100,
  pluginTimeoutMs: 10_000,
  pluginCloseTimeoutMs: 10_000,
  closeTimeoutMs: 10_000,
  keepAliveTimeout: 72_000,
  requestTimeout: 300_000,
  headersTimeout: 60_000,
  maxHeaderSize: 16_384,
  // Why: Within the 29 to 60 s that common proxies in front allow (AWS API Gateway, nginx, AWS ALB).
  handlerTimeoutMs: 30_000,
  securityHeaders: true,
  redirectOrigins: Object.freeze([]),
  cors: null,
  publicOrigin: Object.freeze([]),
  csrf: BASELINE,
};

type LimitOption = Exclude<
  keyof ResolvedServerOptions,
  'securityHeaders' | 'redirectOrigins' | 'cors' | 'publicOrigin' | 'csrf'
>;

// Why: Node's timers take a 32-bit signed delay and fire after 1 ms for anything larger (TimeoutOverflowWarning).
export const MAX_TIMER_MS = 2_147_483_647;

// Why: Loopback unless the author names a host, so a new service is never exposed by default.
const DEFAULT_HOST = '127.0.0.1';
const MAX_PORT = 65_535;

export interface ListenTarget {
  readonly host: string;
  readonly port: number;
}

function invalidOption(message: string): BootError {
  return new BootError('INVALID_OPTION', message, null, null);
}

function positiveInteger(name: LimitOption, value: number | undefined, max = Number.MAX_SAFE_INTEGER): number {
  if (value === undefined) {
    return DEFAULTS[name];
  }
  if (!Number.isSafeInteger(value) || value <= 0 || value > max) {
    throw invalidOption(`Invalid server option ${name}: must be a positive integer up to ${max}, got ${value}`);
  }
  return value;
}

export function resolveServerOptions(options: ServerOptions): ResolvedServerOptions {
  const span = start('boot.options');
  try {
    const resolved: ResolvedServerOptions = {
      bodyLimit: positiveInteger('bodyLimit', options.bodyLimit),
      maxParamLength: positiveInteger('maxParamLength', options.maxParamLength),
      pluginTimeoutMs: positiveInteger('pluginTimeoutMs', options.pluginTimeoutMs, MAX_TIMER_MS),
      pluginCloseTimeoutMs: positiveInteger('pluginCloseTimeoutMs', options.pluginCloseTimeoutMs, MAX_TIMER_MS),
      closeTimeoutMs: positiveInteger('closeTimeoutMs', options.closeTimeoutMs, MAX_TIMER_MS),
      keepAliveTimeout: positiveInteger('keepAliveTimeout', options.keepAliveTimeout),
      requestTimeout: positiveInteger('requestTimeout', options.requestTimeout),
      headersTimeout: positiveInteger('headersTimeout', options.headersTimeout),
      maxHeaderSize: positiveInteger('maxHeaderSize', options.maxHeaderSize),
      // biome-ignore lint/security/noSecrets: an option name, flagged only for the entropy of its letters
      handlerTimeoutMs: positiveInteger('handlerTimeoutMs', options.handlerTimeoutMs, MAX_TIMER_MS),
      securityHeaders: resolveSecurityHeaders(options.securityHeaders),
      redirectOrigins: resolveRedirectOrigins(options.redirectOrigins),
      cors: resolveCors(options.cors, 'server option cors', '') || null,
      publicOrigin: resolvePublicOrigin(options.publicOrigin),
      csrf: resolveCsrf(options.csrf, 'server option csrf', '') ?? DEFAULTS.csrf,
    };
    if (resolved.csrf.strict && resolved.publicOrigin.length === 0) {
      throw invalidOption('Invalid server option csrf.mode: strict needs the server option publicOrigin');
    }
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

function resolveRedirectOrigins(entries: readonly string[] | undefined): readonly string[] {
  return entries === undefined ? DEFAULTS.redirectOrigins : resolveOrigins(entries, 'server option redirectOrigins');
}

function resolveSecurityHeaders(value: boolean | undefined): boolean {
  if (value === undefined) {
    return DEFAULTS.securityHeaders;
  }
  if (typeof value !== 'boolean') {
    throw invalidOption(`Invalid server option securityHeaders: must be a boolean, got ${typeof value}`);
  }
  return value;
}

// Does:  Checks every entry of an option's list of origins and returns the list frozen.
export function resolveOrigins(entries: readonly string[], option: string): readonly string[] {
  if (!Array.isArray(entries)) {
    throw invalidOption(`Invalid ${option}: must be an array of strings`);
  }
  return Object.freeze(entries.map((entry: unknown) => parseOrigin(entry, option)));
}

function invalidProxy(entry: unknown, reason: string): BootError {
  return invalidOption(`Invalid server option trustProxy: ${String(entry)} ${reason}`);
}

const MALFORMED = 'is not an IP address or CIDR range';

// Does:  Adds one trustProxy entry, an address or a CIDR range, to the list; a malformed entry throws.
function addTrusted(list: BlockList, entry: unknown): void {
  if (typeof entry !== 'string') {
    throw invalidProxy(entry, MALFORMED);
  }
  // Why: BlockList ignores a zone id, so the entry would trust more peers than it names.
  if (entry.includes('%')) {
    throw invalidProxy(entry, 'has a zone id');
  }
  const slash = entry.indexOf('/');
  const address = slash === -1 ? entry : entry.slice(0, slash);
  const version = isIP(address);
  if (version === 0) {
    throw invalidProxy(entry, MALFORMED);
  }
  const family = version === 4 ? 'ipv4' : 'ipv6';
  if (slash === -1) {
    list.addAddress(address, family);
    return;
  }
  const prefix = entry.slice(slash + 1);
  const bits = Number(prefix);
  if (!/^\d{1,3}$/.test(prefix) || bits > (version === 4 ? 32 : 128)) {
    throw invalidProxy(entry, MALFORMED);
  }
  // Why: A zero-length prefix trusts every peer, which hands the client's own leftmost entry the address.
  if (bits === 0) {
    throw invalidProxy(entry, 'trusts every address');
  }
  list.addSubnet(address, bits, family);
}

// Does:  Builds the list of trusted proxies; null when none is trusted, so a request never consults it.
export function resolveTrustProxy(entries: readonly string[] | undefined): BlockList | null {
  if (entries === undefined) {
    return null;
  }
  if (!Array.isArray(entries)) {
    throw invalidOption('Invalid server option trustProxy: must be an array of strings');
  }
  if (entries.length === 0) {
    return null;
  }
  const list = new BlockList();
  for (const entry of entries) {
    addTrusted(list, entry);
  }
  return list;
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
