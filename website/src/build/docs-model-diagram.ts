// Does: Draws the documentation overview with deliberate node placement and arrow routes.
// Holds: Both layouts show the same contract and HTTP relationships; Markdown keeps the Mermaid equivalent.

import { escapeHtml } from './docs-links.ts';

const nodes = {
  contract: ['Contract', 'Routes and schemas'],
  client: ['Client', 'Typed calls', 'Validate replies'],
  server: ['Server', 'Validate input', 'Serialize output'],
} as const;

function node(name: keyof typeof nodes, x: number, y: number, width: number, height: number, compact: boolean): string {
  const [title, ...lines] = nodes[name];
  const center = x + width / 2;
  const titleY = y + (compact ? 30 : 40);
  return `<g class="docs-model-node" data-model-node="${name}"><rect x="${x}" y="${y}" width="${width}" height="${height}"></rect><text class="docs-model-title" x="${center}" y="${titleY}">${title}</text>${lines.map((line, index) => `<text class="docs-model-detail" x="${center}" y="${titleY + (compact ? 24 : 30) + index * (compact ? 20 : 26)}">${line}</text>`).join('')}</g>`;
}

function arrows(layout: string): string {
  return `<defs><marker id="model-${layout}-contract" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="10" markerHeight="10" markerUnits="userSpaceOnUse" orient="auto"><path class="docs-model-contract-head" d="M0 0 10 5 0 10Z"></path></marker><marker id="model-${layout}-http" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="10" markerHeight="10" markerUnits="userSpaceOnUse" orient="auto"><path class="docs-model-http-head" d="M0 0 10 5 0 10Z"></path></marker></defs>`;
}

function description(layout: string): string {
  return `<title id="model-${layout}-title">One contract, two sides</title><desc id="model-${layout}-description">The contract defines routes and schemas for both client and server. The client sends an HTTP request to the server, which validates input and serializes output. The server sends an HTTP response back to the client, which provides typed calls and validates replies.</desc>`;
}

export function renderModelDiagram(source: string): string {
  const landscape = `<svg class="docs-model-landscape" viewBox="0 0 720 440" role="img" aria-labelledby="model-wide-title model-wide-description">${description('wide')}${arrows('wide')}
    <g class="docs-model-contract-links" marker-end="url(#model-wide-contract)"><path d="M360 128V176H140V232"></path><path d="M360 128V176H580V232"></path></g>
    <g class="docs-model-label"><text x="230" y="164">Defines</text><text x="490" y="164">Defines</text></g>
    ${node('contract', 240, 28, 240, 100, false)}${node('client', 36, 232, 208, 160, false)}${node('server', 476, 232, 208, 160, false)}
    <g class="docs-model-http-links" marker-end="url(#model-wide-http)"><path d="M244 294H476"></path><path d="M476 350H244"></path></g>
    <g class="docs-model-http-label"><text x="360" y="280">HTTP request</text><text x="360" y="336">HTTP response</text></g>
  </svg>`;
  const portrait = `<svg class="docs-model-portrait" viewBox="0 0 280 440" role="img" aria-labelledby="model-narrow-title model-narrow-description">${description('narrow')}${arrows('narrow')}
    <g class="docs-model-contract-links" marker-end="url(#model-narrow-contract)"><path d="M140 100V154"></path><path d="M48 56H20V379H48"></path></g>
    <g class="docs-model-label"><text x="177" y="132">Defines</text><text transform="translate(10 269) rotate(-90)">Defines</text></g>
    ${node('contract', 48, 12, 184, 88, true)}${node('client', 48, 154, 184, 100, true)}${node('server', 48, 330, 184, 98, true)}
    <g class="docs-model-http-links" marker-end="url(#model-narrow-http)"><path d="M106 254V330"></path><path d="M174 330V254"></path></g>
    <g class="docs-model-http-label"><text x="72" y="286">HTTP</text><text x="72" y="302">request</text><text x="213" y="286">HTTP</text><text x="213" y="302">response</text></g>
  </svg>`;
  return `<figure class="docs-diagram docs-diagram-fit docs-model-diagram"><div class="docs-diagram-canvas">${landscape}${portrait}</div><details><summary>Mermaid equivalent</summary><pre tabindex="0"><code>${escapeHtml(source)}</code></pre></details></figure>`;
}
