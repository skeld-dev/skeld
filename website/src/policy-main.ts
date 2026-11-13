// Does:  Adopts the current policy page and enables its shared navigation.
// Holds: Policy pages load independently of homepage animations and tabs.

import { configure, disposeTree, render } from '@lightstart/light/html';
import { effect } from '@lightstart/light/signals';
import { mountNavigation } from './components/site-header.ts';
import { privacyPage } from './pages/privacy/page.ts';
import { termsPage } from './pages/terms/page.ts';

const root = document.getElementById('app');
const name = document.body.dataset.page;
if (root === null || (name !== 'privacy' && name !== 'terms')) {
  throw new Error('Policy pages require an #app element and a known page name');
}
// Why: Direct renderer entries must install the signal effect adapter before adoption.
configure({ effect });
render(name === 'privacy' ? privacyPage() : termsPage(), root, { adopt: true });
const cleanup = mountNavigation(root);
document.documentElement.dataset.enhanced = 'true';
if (import.meta.hot !== undefined) {
  import.meta.hot.dispose(() => {
    cleanup();
    disposeTree(root);
  });
}
