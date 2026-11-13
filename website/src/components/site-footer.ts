// Does:  Renders the landing page footer.
// Holds: The return link targets the visible page heading.

import { html } from '@lightstart/light/html/core';

export function siteFooter() {
  return html`
    <footer class="footer section-shell">
      <a class="brand" href="#top" aria-label="Back to top">
        <img class="brand-mark" src="/assets/skeld-icon.png" alt="" width="1254" height="1254" />
        <span>skeld</span>
      </a>
      <p>Cold precision. Clear boundaries.</p>
      <span class="footer-note">Built with Light</span>
      <a href="#top" class="back-top" aria-label="Back to top">↑</a>
    </footer>
  `;
}
