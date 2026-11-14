// Does:  Wraps policy content in the shared site shell and policy navigation.
// Holds: Every page has initial HTML and ordinary links, with no client router or backend dependency.

import { html } from '@lightstart/light/html/core';
import { siteFooter } from './site-footer.ts';
import { siteHeader } from './site-header.ts';
import { symbols } from './symbols.ts';

export function policyPage(name: 'privacy' | 'terms', title: string, content: ReturnType<typeof html>) {
  return html`
    <a class="skip" href="#main">Skip to content</a>${symbols()}${siteHeader()}
    <main class="info-page section-shell" id="main" tabindex="-1">
      <header class="info-heading"><p class="section-label"><img src="/assets/skeld-icon.png" alt="" width="1254" height="1254" />skeld website</p><h1>${title}</h1><p>Last updated November 13, 2026</p></header>
      <div class="info-layout"><nav class="info-navigation" aria-label="Site pages"><a href="/docs/guides/first-request/">Get started</a><a href="/docs/">Documentation</a><a href="/security/">Security</a><a href="/privacy/" aria-current=${name === 'privacy' ? 'page' : 'false'}>Privacy</a><a href="/terms/" aria-current=${name === 'terms' ? 'page' : 'false'}>Terms</a></nav><article class="info-content">${content}</article></div>
    </main>${siteFooter()}
  `;
}
