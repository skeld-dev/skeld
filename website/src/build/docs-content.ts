// Does:  Compiles the curated Markdown collection into static HTML, headings and a search index.
// Holds: Raw HTML is escaped; links are checked; Markdown and diagram libraries run only during builds or dev serving.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { html } from '@lightstart/light/html/core';
import { renderToString } from '@lightstart/light/markup';
import { Marked, Renderer } from 'marked';
import { codeExample } from '../components/code-example.ts';
import type { DocHeading, DocPage, SearchEntry } from '../pages/docs/model.ts';
import { createLinkResolver, escapeHtml } from './docs-links.ts';
import { docDefinitions } from './docs-manifest.ts';
import { renderDiagram } from './docs-diagrams.ts';

const repository = fileURLToPath(new URL('../../../', import.meta.url));
function plain(value: string): string {
  return value
    .replace(/[`*_]/g, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .trim();
}
function slug(value: string): string {
  return plain(value)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}_\s-]/gu, '')
    .trim()
    .replace(/\s/g, '-');
}
function renderCode(text: string, language: string): string {
  const highlighted = ['ts', 'typescript', 'js', 'javascript', 'json'].includes(language)
    ? renderToString(html`${codeExample(text)}`)
    : escapeHtml(text);
  return `<div class="docs-code"><div class="docs-code-bar"><span>${escapeHtml(language || 'text')}</span><button type="button" data-copy-code hidden aria-label="Copy code">Copy</button></div><pre tabindex="0" aria-label="${escapeHtml(language || 'Text')} code"><code>${highlighted}</code></pre></div>`;
}
export function buildDocumentation() {
  const resolver = createLinkResolver(repository, docDefinitions);
  const search: SearchEntry[] = [];
  const pages: DocPage[] = docDefinitions.map((definition) => {
    const markdown = readFileSync(resolve(repository, definition.source), 'utf8');
    const headings: DocHeading[] = [];
    const counts = new Map<string, number>();
    let title = definition.label;
    let titleId = '';
    let description = '';
    const renderer = new Renderer();
    renderer.html = ({ text }) => escapeHtml(text);
    renderer.heading = function ({ depth, text, tokens }) {
      const base = slug(text);
      const count = counts.get(base) ?? 0;
      counts.set(base, count + 1);
      const id = count === 0 ? base : `${base}-${count}`;
      if (depth === 1) {
        title = plain(text);
        titleId = id;
        return '';
      }
      headings.push({ id, label: plain(text), depth });
      return `<h${depth} id="${id}"><a class="docs-heading-link" href="#${id}">${this.parser.parseInline(tokens)}</a></h${depth}>`;
    };
    renderer.paragraph = function ({ tokens, text }) {
      if (description === '') {
        description = plain(text).replace(/\s+/g, ' ').slice(0, 170);
      }
      return `<p>${this.parser.parseInline(tokens)}</p>\n`;
    };
    renderer.link = function ({ href, tokens, title: linkTitle }) {
      const destination = resolver.resolveLink(definition.source, href);
      return `<a href="${escapeHtml(destination)}"${typeof linkTitle === 'string' ? ` title="${escapeHtml(linkTitle)}"` : ''}>${this.parser.parseInline(tokens)}</a>`;
    };
    renderer.code = ({ text, lang }) => {
      const language = lang?.split(/\s/)[0] ?? '';
      if (language !== 'mermaid') {
        return renderCode(text, language);
      }
      return renderDiagram(text, title);
    };
    renderer.table = function (table) {
      return `<div class="docs-table" tabindex="0" role="region" aria-label="Reference table">${Renderer.prototype.table.call(this, table)}</div>`;
    };
    const parser = new Marked({ renderer, gfm: true });
    const content = parser.parse(markdown, { async: false });
    search.push({ url: definition.url, title, group: definition.group, text: plain(markdown).replace(/\s+/g, ' ') });
    return { ...definition, title, titleId, description, html: content, headings };
  });
  for (const link of resolver.links) {
    if (link.fragment === '') {
      continue;
    }
    const destination = pages.find((page) => page.source === link.target);
    if (
      destination?.titleId !== link.fragment &&
      !destination?.headings.some((heading) => heading.id === link.fragment)
    ) {
      throw new Error(`Missing heading from ${link.source}: ${link.target}#${link.fragment}`);
    }
  }
  return { pages, search, files: resolver.files, sourceFiles: resolver.sourceFiles };
}
