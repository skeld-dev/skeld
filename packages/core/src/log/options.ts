// Does:  Checks the server's `log` option at boot and resolves it to frozen settings with the safe defaults filled in.
// Holds: Only own keys are read; an unknown key or a wrong value refuses boot; a refused string or object is unprinted.

import { BootError } from '../server/boot-error.ts';
import { MAX_TIMER_MS } from '../server/options.ts';
import { SEVERITY_NUMBER } from './events.ts';
import { FLUSH_TIMEOUT_MS } from './limits.ts';
import type { ResolvedLog } from './shapes.ts';
import type { LogSink, Severity } from './types.ts';

interface OptionObject {
  readonly [key: string | symbol]: unknown;
}
type Thresholds = { -readonly [C in keyof ResolvedLog['thresholds']]: number };

const DEFAULT_THRESHOLDS: ResolvedLog['thresholds'] = Object.freeze({
  boot: SEVERITY_NUMBER.info,
  app: SEVERITY_NUMBER.info,
  security: SEVERITY_NUMBER.warn,
});

const DISABLED: ResolvedLog = Object.freeze({
  enabled: false,
  access: false,
  thresholds: DEFAULT_THRESHOLDS,
  correlation: false,
  clientAddress: false,
  errorIdentifiers: false,
  errorText: false,
  errorFrames: false,
  sink: null,
  flushTimeoutMs: FLUSH_TIMEOUT_MS,
});

const DEFAULTS: ResolvedLog = Object.freeze({ ...DISABLED, enabled: true });

// Does:  Names a refused value: a number or boolean by its value, anything else by its type alone.
function describe(value: unknown): string {
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  if (value === null) {
    return 'null';
  }
  return Array.isArray(value) ? 'array' : typeof value;
}

function invalid(name: string, rule: string, value: unknown): BootError {
  return new BootError('INVALID_OPTION', `Invalid server option ${name}: ${rule}, got ${describe(value)}`, null, null);
}

function isPlainObject(value: unknown): value is OptionObject {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isSeverity(value: string): value is Severity {
  return Object.hasOwn(SEVERITY_NUMBER, value);
}

// Why: A function's parameters are not observable at run time, so its LogSink signature is the compiler's to check.
function isSink(value: unknown): value is LogSink {
  return typeof value === 'function';
}

function flag(name: string, value: unknown): boolean {
  if (value === undefined) {
    return false;
  }
  if (typeof value !== 'boolean') {
    throw invalid(`log.${name}`, 'must be a boolean', value);
  }
  return value;
}

function resolveThresholds(value: unknown): ResolvedLog['thresholds'] {
  if (value === undefined) {
    return DEFAULT_THRESHOLDS;
  }
  if (!isPlainObject(value)) {
    throw invalid('log.thresholds', 'must be a plain object', value);
  }
  const thresholds: Thresholds = { ...DEFAULT_THRESHOLDS };
  for (const key of Reflect.ownKeys(value)) {
    const severity = value[key];
    if (key !== 'boot' && key !== 'app' && key !== 'security') {
      throw invalid(`log.thresholds.${String(key)}`, 'must be one of boot, app, security', severity);
    }
    if (severity === undefined) {
      continue;
    }
    if (typeof severity !== 'string' || !isSeverity(severity)) {
      throw invalid(`log.thresholds.${key}`, 'must be one of debug, info, warn, error, fatal', severity);
    }
    thresholds[key] = SEVERITY_NUMBER[severity];
  }
  return Object.freeze(thresholds);
}

function resolveSink(value: unknown): LogSink | null {
  if (value === undefined) {
    return null;
  }
  if (!isSink(value)) {
    throw invalid('log.sink', 'must be a function', value);
  }
  return value;
}

function resolveFlushTimeout(value: unknown): number {
  if (value === undefined) {
    return FLUSH_TIMEOUT_MS;
  }
  // Why: Node's timers take a 32-bit signed delay and fire after 1 ms for anything larger.
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > MAX_TIMER_MS) {
    throw invalid('log.flushTimeoutMs', `must be an integer from 1 to ${MAX_TIMER_MS}`, value);
  }
  return value;
}

// Does:  Resolves the `log` option: false turns every record off, undefined takes every default.
export function resolveLog(option: unknown): ResolvedLog {
  if (option === false) {
    return DISABLED;
  }
  if (option === undefined) {
    return DEFAULTS;
  }
  if (!isPlainObject(option)) {
    throw invalid('log', 'must be false or a plain object', option);
  }
  const flags = {
    access: false,
    correlation: false,
    clientAddress: false,
    errorIdentifiers: false,
    errorText: false,
    errorFrames: false,
  };
  let thresholds = DEFAULT_THRESHOLDS;
  let sink: LogSink | null = null;
  let flushTimeoutMs = FLUSH_TIMEOUT_MS;
  for (const key of Reflect.ownKeys(option)) {
    const value = option[key];
    switch (key) {
      case 'access':
      case 'correlation':
      case 'clientAddress':
      case 'errorIdentifiers':
      case 'errorText':
      case 'errorFrames':
        flags[key] = flag(key, value);
        break;
      case 'thresholds':
        thresholds = resolveThresholds(value);
        break;
      case 'sink':
        sink = resolveSink(value);
        break;
      case 'flushTimeoutMs':
        flushTimeoutMs = resolveFlushTimeout(value);
        break;
      default:
        throw invalid(`log.${String(key)}`, 'is not a key of LogOptions', value);
    }
  }
  return Object.freeze({ enabled: true, ...flags, thresholds, sink, flushTimeoutMs });
}
