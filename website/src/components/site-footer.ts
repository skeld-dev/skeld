// Does:  Organizes site navigation, project attribution and legal links in the shared footer.
// Holds: Links resolve to existing pages or verified external profiles; Lightstart credit uses the upstream repository.

import { html } from '@lightstart/light/html/core';

export function siteFooter() {
  return html`
    <footer class="footer">
      <div class="section-shell footer-shell">
        <div class="footer-top">
          <div class="footer-identity">
            <a class="brand" href="/" aria-label="skeld home"><img class="brand-mark" src="/assets/skeld-icon.png" alt="" width="1254" height="1254" /><span>skeld</span></a>
            <p>A TypeScript backend framework<br />for sensitive data.</p>
          </div>
          <nav class="footer-navigation" aria-label="Footer navigation">
            <div>
              <h2 id="footer-documentation">Documentation</h2>
              <ul aria-labelledby="footer-documentation" role="list">
                <li><a href="/docs/guides/first-request/">Get started</a></li>
                <li><a href="/docs/">Overview</a></li>
                <li><a href="/docs/api/">Core API</a></li>
              </ul>
            </div>
            <div>
              <h2 id="footer-resources">Resources</h2>
              <ul aria-labelledby="footer-resources" role="list">
                <li><a href="/explore/">Explore examples</a></li>
                <li><a href="/security/">Security</a></li>
                <li><a href="/docs/concepts/threat-model/">Threat model</a></li>
              </ul>
            </div>
            <div>
              <h2 id="footer-project">Project</h2>
              <ul aria-labelledby="footer-project" role="list">
                <li><a href="https://github.com/skeld-dev">GitHub <span class="footer-external" aria-hidden="true">↗</span></a></li>
                <li><a href="/contributing/">Contributing</a></li>
                <li><a href="/license.txt">MIT license</a></li>
              </ul>
            </div>
          </nav>
        </div>
        <div class="footer-bottom">
          <span class="footer-copyright">© 2026 ul0gic</span>
          <nav class="footer-legal" aria-label="Legal"><a href="/privacy/">Privacy</a><a href="/terms/">Terms</a></nav>
          <a class="footer-note" href="https://github.com/alantriesagain/lightstart">Built with Lightstart</a>
          <a href="#top" class="back-top">Back to top<svg aria-hidden="true"><use href="#arrow" transform="rotate(-90 12 12)"></use></svg></a>
        </div>
      </div>
    </footer>
  `;
}
