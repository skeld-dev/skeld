// Does:  Introduces skeld with an illustrated schema-to-log classification example.
// Holds: Copy and the complete example remain readable without motion or JavaScript.

import { html } from '@lightstart/light/html/core';

export function hero() {
  return html`
    <section class="hero" id="top" aria-labelledby="hero-title">
      <div class="hero-art" aria-hidden="true">
        <img src="/assets/glacier-monolith.png" alt="" width="1672" height="941" fetchpriority="high" />
      </div>
      <div class="hero-shade" aria-hidden="true"></div>
      <div class="hero-stage">
        <div class="hero-content">
          <p class="hero-kicker">
            <img src="/assets/skeld-icon.png" alt="" width="1254" height="1254" />
            <span>A TypeScript backend framework for sensitive data.</span>
          </p>
          <h1 id="hero-title">
            <span class="hero-title-line">Your API.</span>
            <span class="hero-title-line hero-title-accent">Under contract.</span>
          </h1>
          <p class="hero-description">
            Define data limits and sensitive fields in your schema.
            skeld applies them to requests, responses and schema-aware logs.
          </p>
          <div class="hero-actions">
            <a class="button button-large primary" href="#contract">
              See the contract
              <svg aria-hidden="true"><use href="#arrow"></use></svg>
            </a>
            <a class="text-link" href="#principles">
              Why skeld
              <span aria-hidden="true">↘</span>
            </a>
          </div>
        </div>
        <figure class="hero-example" aria-labelledby="hero-example-title">
          <figcaption id="hero-example-title">
            <span>From schema to log</span>
            <span class="hero-example-label">Example</span>
          </figcaption>
          <div class="hero-schema">
            <span class="hero-code-label">Contract</span>
            <pre><code>apiKey: t.string({
  maxLength: <span class="hero-code-number">128</span>,
  <span class="hero-classification">sensitivity: <span class="hero-code-value">'secret'</span></span>
})</code></pre>
          </div>
          <div class="hero-transfer">
            <span class="hero-transfer-line" aria-hidden="true"></span>
            <span>Schema-aware logging</span>
          </div>
          <div class="hero-log">
            <svg aria-hidden="true"><use href="#check"></use></svg>
            <code>apiKey: <span class="hero-redacted">'[secret]'</span></code>
          </div>
        </figure>
      </div>
      <div class="hero-bottom">
        <a href="#contract" class="scroll-cue">
          <svg class="scroll-arrow" viewBox="0 0 24 24" aria-hidden="true"><use href="#arrow" transform="rotate(90 12 12)"></use></svg>
          Follow a request
        </a>
      </div>
    </section>
  `;
}
