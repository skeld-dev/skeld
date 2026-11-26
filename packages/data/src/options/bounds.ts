// Does:  Fills a database's bounds with their defaults, refusing a bound out of range or a key outside the options.
// Holds: Every resolved bound is a positive safe integer, a timer or byte bound within its ceiling, all frozen.

import { BootError } from '@skeld/core/boot-error';
import type { PostgresOptions } from '../postgres/types.ts';
import type { SqliteOptions } from '../sqlite/types.ts';

export interface ResolvedBounds {
  readonly maxConnections: number;
  readonly maxWaiters: number;
  readonly acquireTimeoutMs: number;
  readonly connectTimeoutMs: number;
  readonly maxLifetimeMs: number;
  readonly maxResultBytes: number;
  readonly maxParameterBytes: number;
}

type Bound = keyof ResolvedBounds;

// Why: Node's timers hold a signed 32-bit delay; a longer one fires after 1 ms.
const MAX_TIMER_MS = 2_147_483_647;
const MIB = 1_048_576;

const DEFAULTS: ResolvedBounds = {
  maxConnections: 10,
  maxWaiters: 50,
  acquireTimeoutMs: 5_000,
  connectTimeoutMs: 5_000,
  maxLifetimeMs: 1_800_000,
  maxResultBytes: 16 * MIB,
  maxParameterBytes: 4 * MIB,
};

// Why: Under 1 GiB a message's Int32 length fits with its overhead; postgres-js and pgx cap a message there too.
const MAX_MESSAGE_BYTES = 1_073_741_824;

const CEILINGS: { readonly [B in Bound]?: number } = {
  acquireTimeoutMs: MAX_TIMER_MS,
  connectTimeoutMs: MAX_TIMER_MS,
  maxLifetimeMs: MAX_TIMER_MS,
  maxResultBytes: MAX_MESSAGE_BYTES,
  maxParameterBytes: MAX_MESSAGE_BYTES,
};

const KEYS: { readonly [E in 'postgres' | 'sqlite']: ReadonlySet<string> } = {
  postgres: new Set([
    'url',
    'tls',
    'insecure',
    'maxConnections',
    'maxWaiters',
    'acquireTimeoutMs',
    'connectTimeoutMs',
    'maxLifetimeMs',
    'maxResultBytes',
    'maxParameterBytes',
  ]),
  sqlite: new Set(['path', 'maxWaiters', 'acquireTimeoutMs', 'maxResultBytes', 'maxParameterBytes']),
};

function invalidOption(message: string): BootError {
  return new BootError('INVALID_OPTION', message, null, null);
}

function bound(given: ReadonlyMap<string, unknown>, name: Bound): number {
  const value = given.get(name);
  if (value === undefined) {
    return DEFAULTS[name];
  }
  const ceiling = CEILINGS[name];
  if (
    typeof value !== 'number' ||
    !Number.isSafeInteger(value) ||
    value <= 0 ||
    (ceiling !== undefined && value > ceiling)
  ) {
    const range = ceiling === undefined ? 'positive integer' : `positive integer up to ${ceiling}`;
    throw invalidOption(`Invalid option ${name}: must be a ${range}, got ${String(value)}`);
  }
  return value;
}

export function resolveBounds(options: PostgresOptions | SqliteOptions, engine: 'postgres' | 'sqlite'): ResolvedBounds {
  const given = new Map<string, unknown>(Object.entries(options));
  for (const key of given.keys()) {
    if (!KEYS[engine].has(key)) {
      throw invalidOption(`Invalid option ${key}: unknown option`);
    }
  }
  const sqlite = engine === 'sqlite';
  return Object.freeze({
    maxConnections: sqlite ? 1 : bound(given, 'maxConnections'),
    maxWaiters: bound(given, 'maxWaiters'),
    acquireTimeoutMs: bound(given, 'acquireTimeoutMs'),
    connectTimeoutMs: bound(given, 'connectTimeoutMs'),
    maxLifetimeMs: bound(given, 'maxLifetimeMs'),
    maxResultBytes: bound(given, 'maxResultBytes'),
    maxParameterBytes: bound(given, 'maxParameterBytes'),
  });
}
