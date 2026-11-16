// Does:  Invites contributors to help grow the framework, its documentation and real-world feedback.
// Holds: GitHub owns contribution mechanics; this page stays a static invitation with native links.

import { html, unsafeHTML } from '@lightstart/light/html/core';
import { renderToString } from '@lightstart/light/markup';
import { siteFooter } from '../../components/site-footer.ts';
import { siteHeader } from '../../components/site-header.ts';
import { symbols } from '../../components/symbols.ts';

export function contributingPage() {
  const header = renderToString(siteHeader());
  return html`
    <a class="skip" href="#main">Skip to content</a>${symbols()}
    <div id="contributing-site-header">${unsafeHTML(header)}</div>
    <main class="contributing-page section-shell" id="main" tabindex="-1">
      <header class="contributing-heading">
        <p class="section-label"><img src="/assets/skeld-icon.png" alt="" width="1254" height="1254" />Contributing</p>
        <h1>Help build<br /><span>what comes next.</span></h1>
        <div class="contributing-intro">
          <p>We're building skeld for developers who need to handle sensitive data with care. We're looking for people who share that ambition and want to help this framework grow.</p>
          <p>Bring your experience, your curiosity, and the things you wish a backend framework did better. There's room to make a difference here.</p>
        </div>
      </header>
      <section class="contributing-ways" aria-labelledby="contributing-ways-title">
        <div class="contributing-section-heading">
          <h2 id="contributing-ways-title">Find your way in.</h2>
          <p>A useful contribution can be a few lines of code, a clearer explanation, or a problem we haven't seen yet.</p>
        </div>
        <div class="contributing-paths">
          <article>
            <h3>Build the framework.</h3>
            <p>Help improve TypeScript APIs, test difficult edge cases, or investigate performance. Bring a careful eye to the contracts and boundaries that services depend on.</p>
            <a class="text-link" href="/docs/concepts/request-lifecycle/">Follow a request<svg aria-hidden="true"><use href="#arrow"></use></svg></a>
          </article>
          <article>
            <h3>Make it easier to learn.</h3>
            <p>Write an example, improve a guide, or point out where an explanation loses you. A fresh perspective helps the next developer find their footing.</p>
            <a class="text-link" href="/docs/">Explore the docs<svg aria-hidden="true"><use href="#arrow"></use></svg></a>
          </article>
          <article>
            <h3>Bring real experience.</h3>
            <p>Tell us what your service needs. A small reproduction, an awkward workflow, or a thoughtful question can show us where skeld needs to improve.</p>
            <a class="text-link" href="/explore/">Explore the examples<svg aria-hidden="true"><use href="#arrow"></use></svg></a>
          </article>
        </div>
      </section>
      <section class="contributing-start" aria-labelledby="contributing-start-title">
        <div class="contributing-invitation">
          <div>
            <h2 id="contributing-start-title">Start with something you care about.</h2>
            <p>You don't need to know the whole codebase to help. Find a part that interests you and start small. We'd love to build something great with you.</p>
            <p class="contributing-guide-note">Our contribution guide on GitHub covers setup and pull requests.</p>
          </div>
          <a class="button button-large primary" href="https://github.com/skeld-dev/skeld">Find skeld on GitHub<svg aria-hidden="true"><use href="#arrow"></use></svg></a>
        </div>
      </section>
    </main>${siteFooter()}
  `;
}
