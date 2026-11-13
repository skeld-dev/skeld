// Does:  Renders the static getting-started, privacy and terms pages with the shared site shell.
// Holds: Every page has initial HTML and ordinary links, with no client router or backend dependency.

import { html } from '@lightstart/light/html/core';
import { siteFooter } from '../../components/site-footer.ts';
import { siteHeader } from '../../components/site-header.ts';
import { symbols } from '../../components/symbols.ts';
import { privacyContent, startContent, termsContent } from './content.ts';

export function infoPage(name: string) {
  const start = name === 'start';
  const title = start ? 'Run your first request.' : name === 'privacy' ? 'Privacy' : 'Website terms';
  const description = start
    ? 'Start a local server. Call it through a shared contract.'
    : 'Last updated November 13, 2026';
  const content = start ? startContent() : name === 'privacy' ? privacyContent() : termsContent();
  return html`
    <a class="skip" href="#main">Skip to content</a>${symbols()}${siteHeader()}
    <main class="info-page section-shell" id="main" tabindex="-1">
      <header class="info-heading"><p class="section-label"><img src="/assets/skeld-icon.png" alt="" width="1254" height="1254" />${start ? 'Get started' : 'Skeld website'}</p><h1>${title}</h1><p>${description}</p></header>
      <div class="info-layout"><nav class="info-navigation" aria-label="Site pages"><a href="/start/" aria-current=${start ? 'page' : 'false'}>Get started</a><a href="/#build">Code example</a><a href="/privacy/" aria-current=${name === 'privacy' ? 'page' : 'false'}>Privacy</a><a href="/terms/" aria-current=${name === 'terms' ? 'page' : 'false'}>Terms</a></nav><article class="info-content">${content}</article></div>
    </main>${siteFooter()}
  `;
}
