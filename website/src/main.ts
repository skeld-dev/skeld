// Does:  Adopts the initial page with Light and starts its browser-only behavior.
// Holds: Hot replacement releases listeners, observers and animation frames before restarting.

import tabs from '@lightstart/components/navigation/tabs.js';
import View from '@lightstart/light';
import { disposeTree, render } from '@lightstart/light/html';
import { mountNavigation } from './components/site-header.ts';
import { mountContractWalkthrough } from './pages/home/contract-walkthrough.ts';
import { mountHeroMotion } from './pages/home/hero-motion.ts';
import { homePage } from './pages/home/page.ts';

const root = document.getElementById('app');
if (root === null) {
  throw new Error('The site entry requires an #app element');
}

render(homePage(), root, { adopt: true });
// Why: The site owns component styling through its Polar tokens, including the Light tabs.
// Why: Package declarations allow explicit undefined; omit absent members under exactOptionalPropertyTypes.
const { events, mixins, ...tabDefinition } = tabs;
View.define({
  ...tabDefinition,
  ...(events === undefined ? {} : { events }),
  ...(mixins === undefined ? {} : { mixins }),
  style: false,
  firstUpdated() {
    tabs.firstUpdated?.call(this);
    this.querySelector('[role=tablist]')?.setAttribute('aria-label', 'Contract flow');
  },
});
const cleanups = [mountNavigation(root), mountContractWalkthrough(), mountHeroMotion(root)];
document.documentElement.dataset.enhanced = 'true';

if (import.meta.hot !== undefined) {
  import.meta.hot.dispose(() => {
    for (const cleanup of cleanups) {
      cleanup();
    }
    disposeTree(root);
  });
}
