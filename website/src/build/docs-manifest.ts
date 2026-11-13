// Does:  Selects public documentation and its learning order from the canonical repository files.
// Holds: Maintainer guidance is deliberately absent; adding a public page requires an explicit entry.

import type { DocDefinition } from '../pages/docs/model.ts';

const groups = [
  [
    'Start here',
    [
      ['README', 'Overview'],
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
    'Understand the model',
    [
      ['concepts/request-lifecycle', 'Request lifecycle'],
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
      ['api/README', 'Core API'],
      ['api/core/contract', 'Contract'],
      ['api/core/schema', 'Schema'],
      ['api/core/server', 'Server'],
      ['api/core/client', 'Client'],
      ['api/core/http-error', 'HTTP errors'],
      ['api/core/boot-error', 'Boot errors'],
      ['api/core/secret', 'Secret'],
      ['api/core/redact', 'Redact'],
      ['api/core/log', 'Log'],
      ['api/core/redirect', 'Redirect'],
      ['api/core/json-schema', 'JSON Schema'],
    ],
  ],
] as const;

export const docDefinitions: DocDefinition[] = groups.flatMap(([group, entries]) =>
  entries.map(([path, label]) => ({
    source: `docs/${path}.md`,
    url: `/docs/${path.replace(/README$/, '').replace(/\/$/, '')}${path === 'README' ? '' : '/'}`,
    label,
    group,
    ...(path.startsWith('api/core/') ? { parent: '/docs/api/' } : {}),
  })),
);
