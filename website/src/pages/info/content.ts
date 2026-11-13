// Does:  Provides the getting-started and website-policy content for the static pages.
// Holds: Setup uses a source checkout; policies describe this site without inventing contact details.

import { html } from '@lightstart/light/html/core';

export function startContent() {
  return html`
    <div class="info-notice"><strong>Before you begin</strong><p>The steps below use a Skeld source checkout. Public release downloads and registry installation are not available yet.</p></div>
    <section aria-labelledby="start-requirements"><h2 id="start-requirements">Use the checkout's Node version.</h2><p>Use the version specified in <code>.nvmrc</code> at the repository root. Then install the workspace dependencies.</p><pre tabindex="0" aria-label="Install workspace dependencies"><code>npm install</code></pre></section>
    <section aria-labelledby="start-server"><h2 id="start-server">Start the example server.</h2><p>From the repository root, run the hello example. Keep this terminal open.</p><pre tabindex="0" aria-label="Start the hello server"><code>npm run start --workspace @skeld/example-hello</code></pre><p>The server listens at <code>http://127.0.0.1:3000</code>. Stop it with Ctrl-C when you're done.</p></section>
    <section aria-labelledby="start-client"><h2 id="start-client">Call it through the contract.</h2><p>Open a second terminal at the repository root and run the client.</p><pre tabindex="0" aria-label="Run the hello client"><code>npm run call --workspace @skeld/example-hello</code></pre><p>The client prints:</p><pre tabindex="0" aria-label="Expected client output"><code>Hello, Ada!
Olá, Ada</code></pre></section>
    <section aria-labelledby="start-files"><h2 id="start-files">Read the three files.</h2><p>In <code>examples/hello/</code>, start with <code>contract.ts</code>. It declares the routes and their schemas. <code>hello.ts</code> supplies the handlers, and <code>client.ts</code> calls the same contract.</p><p>The checkout walkthrough is in <code>docs/guides/first-request.md</code>. For a smaller example you can save file by file, use the homepage editor.</p><a class="text-link" href="/#build">Explore the code example <span aria-hidden="true">↗</span></a></section>
  `;
}

export function privacyContent() {
  return html`
    <p>This notice covers the Skeld website, maintained by <a href="https://github.com/ul0gic">ul0gic</a>. It does not describe how applications built with Skeld collect or use data.</p>
    <section><h2>What the website collects</h2><p>The current website has no accounts, signup forms, analytics scripts or advertising trackers. Its examples run in the page without sending example inputs to a backend.</p></section>
    <section><h2>Browser storage and assets</h2><p>The website's application code does not set cookies or store visitor information in local storage or session storage. Fonts and images are served with the website. Your browser may cache these files as part of normal browsing.</p></section>
    <section><h2>Hosting and network requests</h2><p>Loading a page sends request information to the hosting provider, including an IP address, requested URL and browser information. Hosting and security services may process this information to deliver and protect the site.</p><p>The site is configured for Cloudflare hosting. <a href="https://www.cloudflare.com/privacypolicy/">Cloudflare's privacy policy</a> explains its processing when it delivers the site.</p></section>
    <section><h2>Links to other websites</h2><p>Links to GitHub and other external websites take you to services with their own privacy policies. Saving an example file uses your browser's download feature; it does not submit a form to Skeld.</p></section>
    <section><h2>Changes to this notice</h2><p>This notice should be read alongside the date above. It will be updated if the website adds data collection or changes how it handles visitor information.</p></section>
  `;
}

export function termsContent() {
  return html`
    <p>These terms cover the Skeld website, maintained by <a href="https://github.com/ul0gic">ul0gic</a>. The website provides information, documentation and examples for the Skeld framework.</p>
    <section><h2>The software license</h2><p>Skeld software is provided under the <a href="/license.txt">MIT license</a>. That license governs use, modification and distribution of the software, including its warranty and liability provisions. These website terms do not replace it.</p></section>
    <section><h2>Documentation and examples</h2><p>Documentation describes the version or source checkout it accompanies. APIs and installation instructions can change between releases. Review examples and configure your application for its own requirements before using them.</p></section>
    <section><h2>Using this website</h2><p>Do not interfere with the website's operation, attempt to gain unauthorized access to its hosting systems, or use it to distribute harmful content.</p></section>
    <section><h2>Third-party materials and links</h2><p>Third-party fonts and software retain their own license notices. External websites, including GitHub and Lightstart, have their own terms. Linking to a service does not make it part of Skeld.</p></section>
    <section><h2>Updates</h2><p>The website and these terms may change as the project develops. The date above identifies the current version of this page.</p></section>
  `;
}
