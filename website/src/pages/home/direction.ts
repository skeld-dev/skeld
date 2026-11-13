// Does:  Renders the current core status and subsequent areas of work.
// Holds: Future modules are presented as direction rather than available functionality.

import { html } from '@lightstart/light/html/core';

export function direction() {
  return html`
    <section class="direction-section section-shell" id="direction" aria-labelledby="direction-title">
      <div class="direction-top">
        <p class="section-label">
          <span class="status-dot"></span>
          What comes next
        </p>
        <span class="development-label">Core complete</span>
      </div>
      <div class="direction-content">
        <h2 id="direction-title">
          The core comes first.
          <br />
          Everything else follows.
        </h2>
        <div>
          <p>
            The core brings contracts, validation, serialization, and structured logging together. The next work builds
            on that foundation.
          </p>
          <a class="text-link" href="#contract">
            Explore the foundation
            <svg aria-hidden="true"><use href="#arrow"></use></svg>
          </a>
        </div>
      </div>
      <div class="roadmap">
        <div class="roadmap-item current">
          <span class="roadmap-dot"></span>
          <strong>Core</strong>
          <span>Complete</span>
        </div>
        <div class="roadmap-connector" aria-hidden="true"></div>
        <div class="roadmap-item">
          <span class="roadmap-dot"></span>
          <strong>Stability</strong>
          <span>Ongoing verification</span>
        </div>
        <div class="roadmap-connector" aria-hidden="true"></div>
        <div class="roadmap-item">
          <span class="roadmap-dot"></span>
          <strong>Modules</strong>
          <span>Built on a solid base</span>
        </div>
      </div>
    </section>
  `;
}
