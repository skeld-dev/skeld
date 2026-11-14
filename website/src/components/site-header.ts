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

export function siteHeader(current?: 'home' | 'docs' | 'security' | 'explore') {
  return html`
    <header class="header" id="top" tabindex="-1">
      <a class="brand" href="/" aria-label="skeld home">
        <img class="brand-mark" src="/assets/skeld-icon.png" alt="" width="1254" height="1254" />
        <span>skeld</span>
      </a>
      <nav
        id="navigation"
        class=${() => (menuOpen.value ? 'navigation is-open' : 'navigation')}
        @click=${closeMenu}
        aria-label="Main navigation"
      >
        <a href="/" aria-current=${current === 'home' ? 'page' : 'false'}>Home</a>
        <a href="/docs/" aria-current=${current === 'docs' ? 'page' : 'false'}>Docs</a>
        <a href="/explore/" aria-current=${current === 'explore' ? 'page' : 'false'}>Explore</a>
        <a href="/security/" aria-current=${current === 'security' ? 'page' : 'false'}>Security</a>
      </nav>
      <a class="button header-cta" href="/docs/guides/install/">
        Get started
        <svg aria-hidden="true"><use href="#arrow"></use></svg>
      </a>
      <button
        type="button"
        class="button button-icon menu-toggle"
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
