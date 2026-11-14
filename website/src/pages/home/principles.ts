// Does:  Explains the framework's choices about bounds, secret exposure and client verification.
// Holds: Copy describes core behavior; the glacier is decorative and the section needs no JavaScript.

import { html } from '@lightstart/light/html/core';

export function principles() {
  return html`
    <section class="principles-section" id="principles" aria-labelledby="principles-title">
      <div class="section-shell principles-shell">
        <div class="principles-heading">
          <p class="section-label">
            <img src="/assets/skeld-icon.png" alt="" width="1254" height="1254" />
            Why skeld
          </p>
          <h2 id="principles-title">The defaults<br /><span>are deliberate.</span></h2>
          <p class="principles-intro">
            skeld makes limits, secret exposure and response checks part of how you define an API.
          </p>
          <div class="principles-art" aria-hidden="true">
            <img
              src="/assets/glacier-shelf-overhang.png"
              alt=""
              width="1536"
              height="1024"
              loading="lazy"
              decoding="async"
            />
          </div>
        </div>
        <div class="principle-list">
          <article class="principle">
            <h3>Limits belong in the contract.</h3>
            <p>Strings, arrays and records require bounds. Leaving one unbounded takes an explicit reason.</p>
            <div class="principle-detail">
              <code>maxLength</code><span aria-hidden="true">·</span><code>maxItems</code><span aria-hidden="true">·</span><code>maxProperties</code>
            </div>
          </article>
          <article class="principle">
            <h3>Secret exposure takes a decision.</h3>
            <p>
              A response schema containing a secret is rejected at startup unless its exposure is explicitly
              declared with a reason.
            </p>
            <div class="principle-detail"><span class="principle-refusal" aria-hidden="true">×</span><code>SECRET_IN_RESPONSE</code><span>Checked before serving requests</span></div>
          </article>
          <article class="principle">
            <h3>The client checks, too.</h3>
            <p>
              skeld's client validates declared JSON responses against the contract before returning typed data
              to your code.
            </p>
            <div class="principle-detail">
              <span>JSON</span><svg aria-hidden="true"><use href="#arrow"></use></svg><span>Schema check</span><svg aria-hidden="true"><use href="#arrow"></use></svg><span>Typed result</span>
            </div>
          </article>
        </div>
      </div>
    </section>
  `;
}
