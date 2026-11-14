// Does:  Renders the privacy page with its own content and the shared policy layout.
// Holds: Policy wording describes the website and identifies its maintainer.

import { html } from '@lightstart/light/html/core';
import { policyPage } from '../../components/policy-page.ts';

export function privacyPage() {
  return policyPage(
    'privacy',
    'Privacy',
    html`
    <p>This notice covers the skeld website, maintained by <a href="https://github.com/ul0gic">ul0gic</a>. It does not describe how applications built with skeld collect or use data.</p>
    <section><h2>What the website collects</h2><p>The current website has no accounts, signup forms, analytics scripts or advertising trackers. Its examples run in the page without sending example inputs to a backend.</p></section>
    <section><h2>Browser storage and assets</h2><p>The website's application code does not set cookies or store visitor information in local storage or session storage. Fonts and images are served with the website. Your browser may cache these files as part of normal browsing.</p></section>
    <section><h2>Hosting and network requests</h2><p>Loading a page sends request information to the hosting provider, including an IP address, requested URL and browser information. Hosting and security services may process this information to deliver and protect the site.</p><p>The site is configured for Cloudflare hosting. <a href="https://www.cloudflare.com/privacypolicy/">Cloudflare's privacy policy</a> explains its processing when it delivers the site.</p></section>
    <section><h2>Links to other websites</h2><p>Links to GitHub and other external websites take you to services with their own privacy policies. Saving an example file uses your browser's download feature; it does not submit a form to skeld.</p></section>
    <section><h2>Changes to this notice</h2><p>This notice should be read alongside the date above. It will be updated if the website adds data collection or changes how it handles visitor information.</p></section>
  `,
  );
}
