// Does:  Renders the Polar hero and its motion control.
// Holds: The hero image has intrinsic dimensions and no essential information depends on motion.

import { html } from '@lightstart/light/html/core';
import { motionToggle } from './hero-motion.ts';

export function hero() {
  return html`
    <section class="hero" id="top" aria-labelledby="hero-title">
      <div class="hero-art" aria-hidden="true">
        <img src="/assets/glacier-monolith.png" alt="" width="1672" height="941" fetchpriority="high" />
      </div>
      <div class="hero-shade" aria-hidden="true"></div>
      <canvas id="frost" aria-hidden="true"></canvas>
      <div class="hero-content">
        <p class="hero-kicker">
          <span class="status-dot"></span>
          A new foundation for TypeScript
        </p>
        <h1 id="hero-title">
          Solid.
          <br />
          By contract.
        </h1>
        <p class="hero-description">
          Define your boundaries.
          <br />
          Build everything on them.
        </p>
        <p class="hero-detail">
          A contract-first backend framework.
          <br />
          Types, validation, and serialization. One foundation.
        </p>
        <div class="hero-actions">
          <a class="button primary" href="#contract">
            Explore the core
            <svg aria-hidden="true"><use href="#arrow"></use></svg>
          </a>
          <a class="text-link" href="#principles">
            Built with intent
            <span aria-hidden="true">↘</span>
          </a>
        </div>
      </div>
      <div class="art-note" aria-hidden="true">
        <span class="hairline"></span>
        <span>Precision at the boundary.</span>
      </div>
      <div class="hero-bottom">
        <a href="#contract" class="scroll-cue">
          <span class="scroll-line" aria-hidden="true"></span>
          Beneath the surface
        </a>
        <div class="hero-meta">
          <span>TypeScript native</span>
          <span class="meta-divider"></span>
          <span>Core complete</span>
        </div>
        ${motionToggle()}
      </div>
    </section>
  `;
}
