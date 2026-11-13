// Does:  Composes the landing page from the shared shell and home sections.
// Holds: Build-time HTML and browser adoption use this same template tree.

import { html } from '@lightstart/light/html/core';
import { siteFooter } from '../../components/site-footer.ts';
import { siteHeader } from '../../components/site-header.ts';
import { symbols } from '../../components/symbols.ts';
import { buildExample } from './build-example.ts';
import { contractWalkthrough } from './contract-walkthrough.ts';
import { direction } from './direction.ts';
import { hero } from './hero.ts';
import { principles } from './principles.ts';

export function homePage() {
  return html`
    <a class="skip" href="#main">Skip to content</a>
    ${symbols()} ${siteHeader('home')}
    <main id="main" tabindex="-1">${hero()} ${contractWalkthrough()} ${principles()} ${buildExample()} ${direction()}</main>
    ${siteFooter()}
  `;
}
