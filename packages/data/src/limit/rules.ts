// Does:  Checks the limiter's options at the call and builds the frozen table from a method and path to its rule.
// Holds: Every entry belongs to a rule that passed every check, and a method and path is in one rule at most.

import { BootError } from '@skeld/core/boot-error';
import type { Database } from '../database/types.ts';
import type { LimitOptions, LimitRule } from './types.ts';

export interface CheckedRule {
  readonly name: string;
  readonly max: number;
  readonly windowSeconds: number;
}

interface RuleRoute {
  readonly rule: string;
  readonly method: string;
  readonly path: string;
}

export interface CheckedLimits {
  readonly database: Database;
  readonly chargeTimeoutMs: number;
  readonly table: { readonly [route: string]: CheckedRule };
  readonly routes: readonly RuleRoute[];
}

const OPTION_KEYS: ReadonlySet<string> = new Set(['database', 'rules', 'chargeTimeoutMs']);
const RULE_KEYS: ReadonlySet<string> = new Set(['max', 'windowSeconds', 'routes']);
const NAME = /^[a-z][A-Za-z0-9._-]{0,63}$/;
const MAX_COUNT = 1_000_000;
// Why: One day is also the longest retry-after core's gate accepts (packages/core/src/lifecycle/gate.ts:69).
const MAX_WINDOW_SECONDS = 86_400;
const DEFAULT_CHARGE_TIMEOUT_MS = 1_000;
// Why: Node's timers hold a signed 32-bit delay; a longer one fires after 1 ms.
const MAX_TIMER_MS = 2_147_483_647;

function refuse(what: string): BootError {
  return new BootError('INVALID_OPTION', `Invalid option ${what}`, null, null);
}

function unknownKey(given: object, keys: ReadonlySet<string>): string | null {
  return Object.keys(given).find((key) => !keys.has(key)) ?? null;
}

function integerIn(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max;
}

export function routeKey(method: string, path: string): string {
  return `${method} ${path}`;
}

function checkRule(name: string, rule: LimitRule, table: { [route: string]: CheckedRule }, listed: RuleRoute[]): void {
  if (!NAME.test(name)) {
    throw refuse(`rules: the name ${JSON.stringify(name.slice(0, 64))} is outside the rule name grammar`);
  }
  const given: unknown = rule;
  if (typeof given !== 'object' || given === null) {
    throw refuse(`rules.${name}: must be an object`);
  }
  const unknown = unknownKey(given, RULE_KEYS);
  if (unknown !== null) {
    throw refuse(`rules.${name}.${unknown}: unknown option`);
  }
  const { max, windowSeconds, routes } = rule;
  if (!integerIn(max, 1, MAX_COUNT)) {
    throw refuse(`rules.${name}.max: must be an integer from 1 to ${MAX_COUNT}`);
  }
  if (!integerIn(windowSeconds, 1, MAX_WINDOW_SECONDS)) {
    throw refuse(`rules.${name}.windowSeconds: must be an integer from 1 to ${MAX_WINDOW_SECONDS}`);
  }
  if (!Array.isArray(routes) || routes.length === 0) {
    throw refuse(`rules.${name}.routes: must list at least one route`);
  }
  const checked: CheckedRule = Object.freeze({ name, max, windowSeconds });
  for (const route of routes) {
    const entry: unknown = route;
    if (
      typeof entry !== 'object' ||
      entry === null ||
      typeof route.method !== 'string' ||
      typeof route.path !== 'string'
    ) {
      throw refuse(`rules.${name}.routes: every entry must be a route with a string method and path`);
    }
    const key = routeKey(route.method, route.path);
    const owner = table[key];
    if (owner !== undefined && owner !== checked) {
      throw refuse(`rules.${name}.routes: ${key} is already in rule ${owner.name}`);
    }
    if (owner === undefined) {
      table[key] = checked;
      listed.push(Object.freeze({ rule: name, method: route.method, path: route.path }));
    }
  }
}

export function checkLimits(options: LimitOptions): CheckedLimits {
  const unknown = unknownKey(options, OPTION_KEYS);
  if (unknown !== null) {
    throw refuse(`${unknown}: unknown option`);
  }
  const rules: unknown = options.rules;
  if (typeof rules !== 'object' || rules === null || Object.keys(rules).length === 0) {
    throw refuse('rules: must name at least one rule');
  }
  const chargeTimeoutMs = options.chargeTimeoutMs ?? DEFAULT_CHARGE_TIMEOUT_MS;
  if (!integerIn(chargeTimeoutMs, 1, MAX_TIMER_MS)) {
    throw refuse(`chargeTimeoutMs: must be an integer from 1 to ${MAX_TIMER_MS}`);
  }
  const table: { [route: string]: CheckedRule } = Object.create(null);
  const listed: RuleRoute[] = [];
  for (const [name, rule] of Object.entries(options.rules)) {
    checkRule(name, rule, table, listed);
  }
  return Object.freeze({
    database: options.database,
    chargeTimeoutMs,
    table: Object.freeze(table),
    routes: Object.freeze(listed),
  });
}
