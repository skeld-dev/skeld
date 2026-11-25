// Does:  Assigns every correctness script to an explicit suite; adding a script requires choosing its cost group.
// Holds: Full coverage is the union of all five groups, without duplicate executions.

export const suites = {
  runtime: [
    'security/audit-boundaries.ts',
    'security/body-limit-options.ts',
    'security/body-limit.ts',
    'security/client-address.ts',
    'security/client-redirect.ts',
    'security/codeql-boundaries.ts',
    'security/derived-cap.ts',
    'security/duplicate-host.ts',
    'security/error-headers.ts',
    'security/error-leak.ts',
    'security/json-depth.ts',
    'security/malformed-path.ts',
    'security/prototype-poisoning.ts',
    'security/reserved-headers.ts',
    'security/security-headers.ts',
    'security/sensitive-leak.ts',
    'browser/cookie-contract.ts',
    'browser/cookie-read.ts',
    'browser/cookie-write.ts',
    'browser/cors.ts',
    'browser/csrf.ts',
    'browser/redirects.ts',
    'lifecycle/audit-callbacks.ts',
    'lifecycle/audit-lifecycle-races.ts',
    'lifecycle/audit-lifecycle.ts',
    'lifecycle/audit-retention.ts',
    'lifecycle/onsend-observe.ts',
    'contracts/derived-class.ts',
    'contracts/response-contract.ts',
    'schema/audit-schema.ts',
    'schema/differential.ts',
    'schema/no-codegen.ts',
    'schema/serializer-differential.ts',
    'logging/log-boundaries.ts',
    'logging/log-correlation.ts',
    'logging/log-injection.ts',
    'logging/log-redaction.ts',
    'auth/api-keys.ts',
    'auth/client-credential.ts',
    'auth/gate-boot.ts',
    'auth/grants.ts',
    'auth/hash-abandon.ts',
    'auth/limits.ts',
    'auth/password-helpers.ts',
    'auth/session-csrf.ts',
    'auth/store-heap.ts',
    'openapi/no-private-text.ts',
  ],
  database: [
    'auth/credential-change.ts',
    'auth/store-bounds.ts',
    'auth/store-conformance.ts',
    'auth/store-install.ts',
    'auth/store-outage.ts',
    'auth/store-unknown-outcome.ts',
  ],
  protocol: [
    'auth/jwt.ts',
    'auth/oidc-flow.ts',
    'auth/oidc-mapping.ts',
    'auth/oidc-outbound.ts',
    'auth/oidc-tokens.ts',
    'auth/tls-verification.ts',
  ],
  extended: [
    'security/body-refusal.ts',
    'security/client-response-limit.ts',
    'lifecycle/handler-timeout.ts',
    'lifecycle/timeouts.ts',
    'logging/log-close.ts',
    'logging/log-destination.ts',
    'logging/log-errors.ts',
    'logging/log-events.ts',
    'logging/log-lifecycle.ts',
    'logging/log-suppression.ts',
    'auth/callback-faults.ts',
    'auth/gate-refusals.ts',
    'auth/handoff.ts',
    'auth/password-load.ts',
    'auth/secret-containment.ts',
    'auth/security-events.ts',
    'auth/sessions.ts',
  ],
  tooling: ['auth/pack-contents.ts'],
} as const;

export const allScripts: readonly string[] = Object.values(suites).flat();
export const categories = ['security', 'browser', 'lifecycle', 'contracts', 'schema', 'logging', 'auth', 'openapi'];

export function selectScripts(mode: string): readonly string[] {
  if (mode === 'all' || mode === 'full') {
    return allScripts;
  }
  if (mode === 'quick') {
    return suites.runtime;
  }
  if (Object.hasOwn(suites, mode)) {
    return Object.entries(suites).find(([name]) => name === mode)?.[1] ?? [];
  }
  if (categories.includes(mode)) {
    return allScripts.filter((script) => script.startsWith(`${mode}/`));
  }
  throw new Error(`Unknown test selection: ${mode}`);
}
