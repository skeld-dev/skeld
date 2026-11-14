// Does:  Renders the documentation shell, topic navigation, contents and compiled article.
// Holds: Article HTML is generated from curated local Markdown; navigation and reading work without JavaScript.

import { html, unsafeHTML } from '@lightstart/light/html/core';
import { renderToString } from '@lightstart/light/markup';
import { siteFooter } from '../../components/site-footer.ts';
import { siteHeader } from '../../components/site-header.ts';
import { symbols } from '../../components/symbols.ts';
import type { DocDefinition, DocHeading, DocPage } from './model.ts';

function topicLink(page: DocPage, definition: DocDefinition, label = definition.label) {
  return html`<a href=${definition.url} aria-current=${definition.url === page.url ? 'page' : 'false'}>${label}</a>`;
}
function topic(page: DocPage, definition: DocDefinition, definitions: DocDefinition[]) {
  const children = definitions.filter((entry) => entry.parent === definition.url);
  if (children.length === 0) {
    return topicLink(page, definition);
  }
  const current = page.url === definition.url || children.some((entry) => entry.url === page.url);
  return html`
    <details class=${current ? 'docs-nav-branch is-current' : 'docs-nav-branch'} ?open=${current}>
      <summary class="docs-nav-parent">${definition.label}<svg class="docs-nav-chevron" aria-hidden="true" viewBox="0 0 24 24"><path d="m9 5 7 7-7 7"></path></svg></summary>
      <ul class="docs-nav-children"><li>${topicLink(page, definition, 'Overview')}</li>${children.map((entry) => html`<li>${topicLink(page, entry)}</li>`)}</ul>
    </details>
  `;
}
function navigation(page: DocPage, definitions: DocDefinition[]) {
  const groups = [...new Set(definitions.map((definition) => definition.group))];
  return groups.map(
    (group) => html`
    <div class="docs-nav-group"><p>${group}</p>${definitions
      .filter((definition) => definition.group === group && definition.parent === undefined)
      .map((definition) => topic(page, definition, definitions))}</div>
  `,
  );
}
function contents(headings: DocHeading[]) {
  return headings
    .filter((heading) => heading.depth === 2)
    .map(
      (heading) => html`
    <a href=${`#${heading.id}`} data-doc-heading=${heading.id}>${heading.label}</a>
  `,
    );
}
export function docsPage(page: DocPage, definitions: DocDefinition[]) {
  const index = definitions.findIndex((definition) => definition.url === page.url);
  const previous = definitions[index - 1];
  const next = definitions[index + 1];
  // Why: The browser adopts only the header, so it needs its own root adoption markers.
  const header = renderToString(siteHeader('docs'));
  return html`
    <a class="skip" href="#main">Skip to content</a>${symbols()}
    <div id="docs-site-header">${unsafeHTML(header)}</div>
    <div class="docs-layout">
      <nav class="docs-sidebar" aria-label="Documentation topics"><a class="docs-home" href="/docs/">Documentation</a>${navigation(page, definitions)}</nav>
      <main class="docs-main" id="main" tabindex="-1">
        <form class="docs-search" role="search">
          <label class="sr-only" for="docs-search-input">Search documentation</label>
          <div class="docs-search-control"><svg aria-hidden="true" viewBox="0 0 24 24"><circle cx="10.5" cy="10.5" r="6.5" fill="none" stroke="currentColor" stroke-width="1.5"></circle><path d="m16 16 5 5" stroke="currentColor" stroke-width="1.5"></path></svg><input id="docs-search-input" type="search" placeholder="Search documentation" autocomplete="off" aria-controls="docs-search-results" disabled /><button type="button" class="button button-icon" data-clear-search aria-label="Clear search" disabled><span class="button-glyph" aria-hidden="true">×</span></button></div>
          <p class="docs-search-status" role="status" aria-live="polite"></p><noscript><p class="docs-search-status">Search needs JavaScript. Use the topic navigation to browse.</p></noscript><ul id="docs-search-results" class="docs-search-results" hidden></ul>
        </form>
        <details class="docs-mobile-navigation"><summary>Browse documentation</summary><nav aria-label="Documentation topics">${navigation(page, definitions)}</nav></details>
        <header class="docs-heading"><p class="section-label"><img src="/assets/skeld-icon.png" alt="" width="1254" height="1254" />${page.group}</p><h1 id=${page.titleId}>${page.title}</h1></header>
        <div class="docs-page-formats" role="group" aria-label="Page formats">
          <button type="button" class="button docs-format-action" data-copy-markdown hidden>Copy Markdown</button>
          <a class="button docs-format-action" href=${page.markdownUrl} data-view-markdown>View Markdown</a>
          <a class="text-link docs-llms-link" href="/llms.txt">LLM index <span aria-hidden="true">↗</span></a>
        </div>
        <p class="docs-markdown-status" data-markdown-status role="status" aria-live="polite"></p>
        <details class="docs-markdown-fallback" data-markdown-fallback hidden><summary>Select Markdown to copy</summary><textarea readonly aria-label="Page Markdown" spellcheck="false"></textarea></details>
        ${page.url === '/docs/guides/first-request/' ? html`<aside class="docs-checkout"><strong>Run from a source checkout.</strong> Public release downloads and npm installation are not available yet.</aside>` : ''}
        <details class="docs-mobile-contents"><summary>On this page</summary><nav aria-label="On this page">${contents(page.headings)}</nav></details>
        <article class="docs-prose" aria-labelledby=${page.titleId}>${unsafeHTML(page.html)}</article>
        <nav class="docs-pagination" aria-label="Continue reading">
          ${previous === undefined ? html`<span></span>` : html`<a href=${previous.url}><span>Previous</span><strong>${previous.label}</strong></a>`}
          ${next === undefined ? '' : html`<a href=${next.url}><span>Next</span><strong>${next.label}<span aria-hidden="true"> →</span></strong></a>`}
        </nav>
        <p class="sr-only" data-copy-status role="status" aria-live="polite"></p>
      </main>
      <aside class="docs-contents"><nav aria-label="On this page"><p>On this page</p>${contents(page.headings)}</nav><a class="docs-github" href="https://github.com/skeld-dev/skeld">skeld on GitHub ↗</a></aside>
    </div>${siteFooter()}
  `;
}
