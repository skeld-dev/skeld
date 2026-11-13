// Does:  Invites visitors to build their first API through the getting-started page.
// Holds: The CTA leads to available installation guidance without claiming a published package.

import { html } from '@lightstart/light/html/core';

export function direction() {
  return html`
    <section class="direction-section" id="direction" aria-labelledby="direction-title">
      <div class="direction-art" aria-hidden="true"><img src="/assets/polar-ice-peak.png" alt="" width="2172" height="724" loading="lazy" decoding="async" /></div>
      <div class="section-shell direction-shell">
        <p class="section-label"><img src="/assets/skeld-icon.png" alt="" width="1254" height="1254" />Start building</p>
        <h2 id="direction-title">Make your first<br /><span>request.</span></h2>
        <p class="direction-description">Define a contract. Write a handler. See what Skeld checks before the data reaches your code.</p>
        <a class="button primary" href="/start/">Get started<svg aria-hidden="true"><use href="#arrow"></use></svg></a>
      </div>
    </section>
  `;
}
