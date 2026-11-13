// Does:  Organizes site navigation, project attribution and legal links in the shared footer.
// Holds: Links resolve to existing pages or verified external profiles; Lightstart credit uses the upstream repository.

import { html } from '@lightstart/light/html/core';

export function siteFooter() {
  return html`
    <footer class="footer">
      <div class="section-shell footer-shell">
        <div class="footer-top">
          <div class="footer-identity">
            <a class="brand" href="/#top" aria-label="Skeld home"><img class="brand-mark" src="/assets/skeld-icon.png" alt="" width="1254" height="1254" /><span>skeld</span></a>
            <p>A TypeScript backend framework<br />for sensitive data.</p>
          </div>
          <nav class="footer-navigation" aria-label="Footer">
            <div><h2>Build</h2><a href="/start/">Get started</a><a href="/#build">Code example</a><a href="/#contract">Follow a request</a></div>
            <div><h2>Project</h2><a href="/#principles">Why Skeld</a><a href="https://github.com/skeld-dev">Skeld on GitHub</a><a href="/license.txt">MIT license</a></div>
            <div><h2>Website</h2><a href="/privacy/">Privacy</a><a href="/terms/">Terms</a></div>
          </nav>
        </div>
        <div class="footer-bottom"><span class="footer-copyright">© 2026 ul0gic</span><a class="footer-note" href="https://github.com/alantriesagain/lightstart">Built with Lightstart</a><a href="#main" class="back-top">Back to top<svg aria-hidden="true"><use href="#arrow" transform="rotate(-90 12 12)"></use></svg></a></div>
      </div>
    </footer>
  `;
}
