// Does:  Renders the repository's Mermaid diagrams as static SVG for the Light document shell.
// Holds: Fonts and colors come from the site's CSS; SVG elements have explicit closing tags for markup parsing.

import { readFileSync } from 'node:fs';
import { renderMermaidSVG } from 'beautiful-mermaid';
import { escapeHtml } from './docs-links.ts';

const tokens = readFileSync(new URL('../design-system/tokens.css', import.meta.url), 'utf8');
const family = /--font-sans:\s*"([^"]+)"/.exec(tokens)?.[1];
if (family === undefined) {
  throw new Error('Documentation diagrams require the site font token');
}
const font = family;
export function renderDiagram(source: string, title: string): string {
  const diagram = renderMermaidSVG(source, { font, padding: 24 })
    .replace(/<style>[\s\S]*?<\/style>/g, '')
    .replace(/ style="[^"]*"/, '')
    .replace(/<([a-zA-Z][\w:-]*)([^<>]*?)\s*\/>/g, '<$1$2></$1>')
    .replace('<svg ', () => `<svg role="img" aria-label="${escapeHtml(title)} diagram" `);
  return `<figure class="docs-diagram"><div class="docs-diagram-canvas" tabindex="0" role="region" aria-label="${escapeHtml(title)} diagram">${diagram}</div><details><summary>Diagram source</summary><pre tabindex="0"><code>${escapeHtml(source)}</code></pre></details></figure>`;
}
