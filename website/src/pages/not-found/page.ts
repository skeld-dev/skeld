// Does:  Gives missing URLs a clear explanation and useful routes back into the site.
// Holds: Recovery links and site navigation are available in the initial HTML.

import { html, unsafeHTML } from '@lightstart/light/html/core';
import { renderToString } from '@lightstart/light/markup';
import { siteFooter } from '../../components/site-footer.ts';
import { siteHeader } from '../../components/site-header.ts';
import { symbols } from '../../components/symbols.ts';

export function notFoundPage() {
  return html`
    <a class="skip" href="#main">Skip to content</a>${symbols()}
    <div id="not-found-site-header">${unsafeHTML(renderToString(siteHeader()))}</div>
    <main class="not-found-page section-shell" id="main" tabindex="-1">
      <div class="not-found-content">
        <p class="section-label"><img src="/assets/skeld-icon.png" alt="" width="1254" height="1254" />404 · Page not found</p>
        <h1>This page<br /><span>isn't here.</span></h1>
        <p>The link may be out of date, or the address may have a typo. The docs are a good place to pick up from here.</p>
        <div class="not-found-actions">
          <a class="button button-large primary" href="/docs/">Browse the docs<svg aria-hidden="true"><use href="#arrow"></use></svg></a>
          <a class="button button-large" href="/">Back to home</a>
        </div>
      </div>
      <img class="not-found-art" src="/assets/drifting-glacier-fragments.png" alt="" width="1254" height="1254" />
    </main>${siteFooter()}
  `;
}
