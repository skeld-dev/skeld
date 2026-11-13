// Does:  Renders the documentation shell, topic navigation, contents and compiled article.
// Holds: Article HTML is generated from curated local Markdown; navigation and reading work without JavaScript.

import { html, unsafeHTML } from '@lightstart/light/html/core';
import { renderToString } from '@lightstart/light/markup';
import { siteFooter } from '../../components/site-footer.ts';
import { siteHeader } from '../../components/site-header.ts';
import { symbols } from '../../components/symbols.ts';
import type { DocDefinition, DocHeading, DocPage } from './model.ts';

function navigation(page: DocPage, definitions: DocDefinition[]) {
  const groups = [...new Set(definitions.map((definition) => definition.group))];
  return groups.map(
    (group) => html`
    <div class="docs-nav-group"><p>${group}</p>${definitions
      .filter((definition) => definition.group === group)
      .map(
        (definition) => html`
      <a href=${definition.url} aria-current=${definition.url === page.url ? 'page' : 'false'}>${definition.label}</a>
    `,
      )}</div>
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
          <div class="docs-search-control"><svg aria-hidden="true" viewBox="0 0 24 24"><circle cx="10.5" cy="10.5" r="6.5" fill="none" stroke="currentColor" stroke-width="1.5"></circle><path d="m16 16 5 5" stroke="currentColor" stroke-width="1.5"></path></svg><input id="docs-search-input" type="search" placeholder="Search documentation" autocomplete="off" aria-controls="docs-search-results" disabled /><button type="button" data-clear-search aria-label="Clear search" disabled>Clear</button></div>
          <p class="docs-search-status" role="status" aria-live="polite"></p><noscript><p class="docs-search-status">Search needs JavaScript. Use the topic navigation to browse.</p></noscript><ul id="docs-search-results" class="docs-search-results" hidden></ul>
        </form>
        <details class="docs-mobile-navigation"><summary>Browse documentation</summary><nav aria-label="Documentation topics">${navigation(page, definitions)}</nav></details>
        <header class="docs-heading"><p class="section-label"><img src="/assets/skeld-icon.png" alt="" width="1254" height="1254" />${page.group}</p><h1 id=${page.titleId}>${page.title}</h1></header>
        ${page.url === '/docs/guides/first-request/' ? html`<aside class="docs-checkout"><strong>Run from a source checkout.</strong> Public release downloads and npm installation are not available yet.</aside>` : ''}
        <details class="docs-mobile-contents"><summary>On this page</summary><nav aria-label="On this page">${contents(page.headings)}</nav></details>
        <article class="docs-prose" aria-labelledby=${page.titleId}>${unsafeHTML(page.html)}</article>
        <nav class="docs-pagination" aria-label="Continue reading">
          ${previous === undefined ? html`<span></span>` : html`<a href=${previous.url}><span>Previous</span><strong>${previous.label}</strong></a>`}
          ${next === undefined ? '' : html`<a href=${next.url}><span>Next</span><strong>${next.label}<span aria-hidden="true"> →</span></strong></a>`}
        </nav>
        <p class="sr-only" data-copy-status role="status" aria-live="polite"></p>
      </main>
      <aside class="docs-contents"><nav aria-label="On this page"><p>On this page</p>${contents(page.headings)}</nav><a class="docs-github" href="https://github.com/skeld-dev">Skeld on GitHub ↗</a></aside>
    </div>${siteFooter()}
  `;
}
