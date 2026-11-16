// Does:  Declares the store conformance kit's target and report.
// Holds: A case that needs a lock holder the target lacks is reported skipped, never passed.

import type { AuthStore, Digest } from '../store/types.ts';

/** One fresh store for one case, with a way to hold a row's lock from a second connection. */
export interface ConformanceTarget {
  /** The store under test. */
  readonly store: AuthStore;
  /** Takes the named row's lock from a second connection and holds it for `ms` milliseconds. */
  readonly holdLock?: (
    table: 'subjects' | 'sessions' | 'api_keys' | 'limit_windows' | 'oidc_attempts',
    key: string | Digest,
    ms: number,
  ) => Promise<void>;
  /** What a `holdLock` call blocks: the named row or the whole database; absent reads as `'database'`. */
  readonly lockScope?: 'row' | 'database';
  /** Replaces the rows of `schema_version` with one row per given version; without it the version cases are skipped. */
  readonly writeVersions?: (versions: readonly number[]) => Promise<void>;
  /** Releases the store and everything the target made. */
  readonly dispose: () => Promise<void>;
}

/** The outcome of a conformance run; each case name is `<operation>.<case>`. */
export interface ConformanceReport {
  /** The cases that passed. */
  readonly passed: readonly string[];
  /** The cases that failed, with what was observed. */
  readonly failed: readonly { readonly name: string; readonly detail: string }[];
  /** The cases that could not run on this target. */
  readonly skipped: readonly string[];
}
