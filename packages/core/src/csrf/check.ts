// Does:  Decides whether an unsafe request may come from where it says it does: Origin first, then Sec-Fetch-Site.
// Holds: Only an exact allowed Origin or the browser's same-origin attestation passes a request that names an origin.

import type { ResolvedCsrf } from './policy.ts';

// Does:  Why a request was refused, from a closed set: never anything the request carried.
export type CsrfReason = 'origin' | 'unverifiable' | 'fetch-site' | 'missing';

export interface CsrfRoute {
  readonly allowed: ReadonlySet<string>;
  readonly strict: boolean;
  readonly verifiable: boolean;
}

export function csrfRoute(policy: ResolvedCsrf, publicOrigin: readonly string[]): CsrfRoute {
  return Object.freeze({
    allowed: new Set([...publicOrigin, ...policy.trustedOrigins]),
    strict: policy.strict,
    verifiable: publicOrigin.length > 0,
  });
}

export function isUnsafeMethod(method: string): boolean {
  return method === 'POST' || method === 'PUT' || method === 'PATCH' || method === 'DELETE';
}

// Does:  Returns null when an unsafe-method request passes, or the reason it is refused.
export function checkCrossOrigin(
  origin: string | readonly string[] | undefined,
  fetchSite: string | readonly string[] | undefined,
  route: CsrfRoute,
): CsrfReason | null {
  if (origin !== undefined) {
    if (typeof origin === 'string' && route.allowed.has(origin)) {
      return null;
    }
    // Why: Script cannot set Sec-Fetch-Site, and a no-referrer page sends Origin null on its own same-origin posts.
    if (fetchSite === 'same-origin') {
      return null;
    }
    if (fetchSite !== undefined) {
      return 'fetch-site';
    }
    return route.verifiable ? 'origin' : 'unverifiable';
  }
  if (fetchSite === undefined) {
    return route.strict ? 'missing' : null;
  }
  // Why: none is a navigation the user started (a bookmark, the address bar), never a page of another site.
  return fetchSite === 'same-origin' || fetchSite === 'none' ? null : 'fetch-site';
}
