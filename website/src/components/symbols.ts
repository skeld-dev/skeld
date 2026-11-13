// Does:  Defines the shared brand mark and interface symbols.
// Holds: Decorative symbols stay outside the accessibility tree.

import { html } from '@lightstart/light/html/core';

export function symbols() {
  return html`
    <svg class="svg-defs" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <defs>
        <symbol id="mark" viewBox="0 0 40 44">
          <path d="M9 2h29L25 15H14l8 8H5L0 18z"></path>
          <path d="M31 42H2l13-13h11l-8-8h17l5 5z"></path>
        </symbol>
        <symbol id="arrow" viewBox="0 0 24 24">
          <path
            d="M5 12h14M13 6l6 6-6 6"
            fill="none"
            stroke="currentColor"
            stroke-width="1.5"
            stroke-linecap="square"
          ></path>
        </symbol>
        <symbol id="check" viewBox="0 0 20 20">
          <path d="m4 10 4 4 8-8" fill="none" stroke="currentColor" stroke-width="1.5"></path>
        </symbol>
      </defs>
    </svg>
  `;
}
