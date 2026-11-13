// Does:  Renders site navigation with a reactive mobile disclosure.
// Holds: The menu button and visible navigation share the same open state.

import { html } from '@lightstart/light/html/core';
import { signal } from '@lightstart/light/signals';

const menuOpen = signal(false);

function closeMenu() {
  menuOpen.value = false;
}

function toggleMenu() {
  menuOpen.value = !menuOpen.value;
}

export function siteHeader() {
  return html`
    <header class="header">
      <a class="brand" href="#top" aria-label="Skeld home">
        <img class="brand-mark" src="/assets/skeld-icon.png" alt="" width="1254" height="1254" />
        <span>skeld</span>
      </a>
      <nav
        id="navigation"
        class=${() => (menuOpen.value ? 'navigation is-open' : 'navigation')}
        @click=${closeMenu}
        aria-label="Main navigation"
      >
        <a href="#contract">Framework</a>
        <a href="#principles">Principles</a>
        <a href="#direction">Direction</a>
      </nav>
      <a class="header-cta" href="#contract">
        Explore the core
        <svg aria-hidden="true"><use href="#arrow"></use></svg>
      </a>
      <button
        type="button"
        class="menu-toggle"
        aria-expanded=${() => String(menuOpen.value)}
        @click=${toggleMenu}
        aria-controls="navigation"
        aria-label=${() => (menuOpen.value ? 'Close navigation' : 'Open navigation')}
      >
        <span></span>
        <span></span>
      </button>
    </header>
  `;
}

export function mountNavigation(root: HTMLElement): () => void {
  const lifetime = new AbortController();
  const desktop = matchMedia('(min-width: 761px)');
  desktop.addEventListener('change', closeMenu, { signal: lifetime.signal });
  document.addEventListener(
    'keydown',
    (event) => {
      if (event.key === 'Escape' && menuOpen.value) {
        closeMenu();
        root.querySelector<HTMLButtonElement>('.menu-toggle')?.focus();
      }
    },
    { signal: lifetime.signal },
  );
  return () => lifetime.abort();
}
