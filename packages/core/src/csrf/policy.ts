// Does:  Checks a csrf option at boot and returns it as a frozen copy with its defaults filled in.
// Holds: An accepted policy has a known mode, says whether the author stated it, and only exact trusted origins.

import { parseOrigin } from '../origin/origin.ts';
import { BootError } from '../server/boot-error.ts';
import type { CsrfPolicy } from '../server/types.ts';

export interface ResolvedCsrf {
  readonly strict: boolean;
  readonly modeStated: boolean;
  readonly trustedOrigins: readonly string[];
}

export const BASELINE: ResolvedCsrf = Object.freeze({
  strict: false,
  modeStated: false,
  trustedOrigins: Object.freeze([]),
});

function invalid(label: string, reason: string): BootError {
  return new BootError('INVALID_OPTION', `Invalid ${label}: ${reason}`, null, null);
}

// Does:  Returns the checked copy of a policy, or null when it is not set; where names a group's routes.
export function resolveCsrf(value: CsrfPolicy | undefined, option: string, where: string): ResolvedCsrf | null {
  if (value === undefined) {
    return null;
  }
  const name = (field: string): string => `${option}${field}${where}`;
  if (typeof value !== 'object' || value === null) {
    throw invalid(name(''), 'must be a policy object');
  }
  const stated: unknown = value.mode;
  // Why: Only undefined means not given; null or any other value must meet the refusal below.
  const mode = stated === undefined ? 'baseline' : stated;
  if (mode !== 'baseline' && mode !== 'strict') {
    throw invalid(name('.mode'), `must be 'baseline' or 'strict', got ${String(mode)}`);
  }
  const listed: unknown = value.trustedOrigins;
  const trusted = listed === undefined ? [] : listed;
  if (!Array.isArray(trusted)) {
    throw invalid(name('.trustedOrigins'), 'must be an array of origins');
  }
  return Object.freeze({
    strict: mode === 'strict',
    modeStated: stated !== undefined,
    trustedOrigins: Object.freeze(trusted.map((entry: unknown) => parseOrigin(entry, name('.trustedOrigins')))),
  });
}

// Does:  Returns the publicOrigin option as a frozen list of checked origins; empty when it is not set.
export function resolvePublicOrigin(value: string | readonly string[] | undefined): readonly string[] {
  if (value === undefined) {
    return Object.freeze([]);
  }
  const label = 'server option publicOrigin';
  const entries: readonly unknown[] = Array.isArray(value) ? value : [value];
  if (entries.length === 0) {
    throw invalid(label, 'must name at least one origin when set');
  }
  return Object.freeze(entries.map((entry) => parseOrigin(entry, label)));
}
