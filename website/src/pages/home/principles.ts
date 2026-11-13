// Does:  Renders the framework principles on the landing page.
// Holds: Performance language states an approach without claiming measured superiority.

import { html } from '@lightstart/light/html/core';

export function principles() {
  return html`
    <section class="principles-section section-shell" id="principles" aria-labelledby="principles-title">
      <div class="principles-heading">
        <p class="section-label">
          <img src="/assets/skeld-icon.png" alt="" width="1254" height="1254" />
          The principles
        </p>
        <h2 id="principles-title">
          Strength starts
          <br />
          at the core.
        </h2>
        <p>
          A small foundation with a clear point of view.
          <br />
          Security and performance are design constraints from the start.
        </p>
        <div class="boundary-art" aria-hidden="true">
          <svg viewBox="0 0 340 180">
            <path
              d="M20 28h145l55 55-55 55H20V28Zm300 14H175l-55 55 55 55h145V42Z"
              fill="none"
              stroke="currentColor"
            ></path>
            <path d="m120 97 45-45 55 31-45 45Z" fill="currentColor" fill-opacity=".07" stroke="currentColor"></path>
            <path d="M20 166h300M20 160v12m300-12v12" fill="none" stroke="currentColor" stroke-opacity=".45"></path>
          </svg>
          <span>Agreement, by design.</span>
        </div>
      </div>
      <div class="principle-list">
        <article class="principle">
          <span class="principle-icon" aria-hidden="true">[&nbsp;]</span>
          <div>
            <h3>Explicit at the edges.</h3>
            <p>
              Declare what belongs in your system. Keep types, validation, and serialization connected to the same
              contract.
            </p>
            <span class="principle-tag">Contracts before conventions</span>
          </div>
        </article>
        <article class="principle">
          <span class="principle-icon" aria-hidden="true">{&nbsp;}</span>
          <div>
            <h3>Security in the foundation.</h3>
            <p>
              Sensitive data deserves deliberate handling. Build around clear boundaries and predictable failure, then
              keep testing those assumptions.
            </p>
            <span class="principle-tag">Security as a design constraint</span>
          </div>
        </article>
        <article class="principle">
          <span class="principle-icon waveform" aria-hidden="true">
            <i></i>
            <i></i>
            <i></i>
            <i></i>
            <i></i>
          </span>
          <div>
            <h3>Performance with evidence.</h3>
            <p>
              Measure the work a request actually costs. Let repeatable benchmarks guide the core, and be precise about
              what they prove.
            </p>
            <span class="principle-tag">Measure. Understand. Improve.</span>
          </div>
        </article>
      </div>
    </section>
  `;
}
