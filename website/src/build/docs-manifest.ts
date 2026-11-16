// Does:  Selects public documentation and its learning order from the canonical repository files.
// Holds: Maintainer guidance is deliberately absent; adding a public page requires an explicit entry.

import type { DocDefinition } from '../pages/docs/model.ts';

const groups = [
  [
    'Start here',
    [
      ['README', 'Overview'],
      ['guides/install', 'Install skeld'],
      ['guides/first-request', 'Your first request'],
    ],
  ],
  [
    'Build a service',
    [
      ['guides/contracts', 'Design a contract'],
      ['guides/client-and-errors', 'Clients and errors'],
      ['guides/plugins-and-lifecycle', 'Plugins and lifecycle'],
      ['guides/classification', 'Classify data'],
      ['guides/browser-security', 'Connect a browser'],
      ['guides/running-a-service', 'Run a service'],
      ['guides/troubleshooting', 'Troubleshoot'],
    ],
  ],
  [
    'Add authentication',
    [
      ['guides/auth', 'Add authentication'],
      ['guides/auth-obligations', "The application's obligations"],
      ['reference/auth', 'Auth behavior reference'],
    ],
  ],
  [
    'Understand the model',
    [
      ['concepts/request-lifecycle', 'Request lifecycle'],
      ['reference/core', 'Core behavior reference'],
      ['concepts/security-boundaries', 'Security boundaries'],
      ['concepts/threat-model', 'Threat model'],
    ],
  ],
  [
    'Logging',
    [
      ['logging/logging', 'Logging overview'],
      ['logging/record-format', 'Record format'],
      ['logging/events', 'Events'],
      ['logging/errors', 'Error disclosure'],
      ['logging/collector', 'Collector ingestion'],
    ],
  ],
  [
    'API reference',
    [
      ['api/README', 'API overview'],
      ['api/core/contract', 'Contract'],
      ['api/core/schema', 'Schema'],
      ['api/core/server', 'Server'],
      ['api/core/client', 'Client'],
      ['api/core/http-error', 'HTTP errors'],
      ['api/core/boot-error', 'Boot errors'],
      ['api/core/gate', 'Gate'],
      ['api/core/secret', 'Secret'],
      ['api/core/redact', 'Redact'],
      ['api/core/log', 'Log'],
      ['api/core/redirect', 'Redirect'],
      ['api/core/json-schema', 'JSON Schema'],
      ['api/auth/server', 'Auth server'],
      ['api/auth/policy', 'Policies'],
      ['api/auth/routes', 'Auth routes'],
      ['api/auth/auth-error', 'Auth errors'],
      ['api/auth/store', 'Store'],
      ['api/auth/sqlite', 'SQLite store'],
      ['api/auth/postgres', 'PostgreSQL store'],
      ['api/auth/store-conformance', 'Store conformance'],
      ['api/auth/api-key', 'API keys'],
      ['api/auth/jwt', 'JWT'],
      ['api/auth/oidc', 'OpenID Connect'],
      ['api/auth/password', 'Passwords'],
    ],
  ],
] as const;

export const docDefinitions: DocDefinition[] = groups.flatMap(([group, entries]) =>
  entries.map(([path, label]) => ({
    source: `docs/${path}.md`,
    url: `/docs/${path.replace(/README$/, '').replace(/\/$/, '')}${path === 'README' ? '' : '/'}`,
    label,
    group,
    ...(path.startsWith('api/core/') || path.startsWith('api/auth/') ? { parent: '/docs/api/' } : {}),
  })),
);
