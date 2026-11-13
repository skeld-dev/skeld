// Does:  Adopts the shared navigation on the static Security page.
// Holds: The security article and links work without browser JavaScript.

import { configure, disposeTree, render } from '@lightstart/light/html';
import { effect } from '@lightstart/light/signals';
import { mountNavigation, siteHeader } from '../../components/site-header.ts';

const header = document.getElementById('security-site-header');
if (header === null) {
  throw new Error('Security page requires its shared header');
}
// Why: Direct renderer entries must install the signal effect adapter before adoption.
configure({ effect });
render(siteHeader('security'), header, { adopt: true });
const cleanup = mountNavigation(header);
document.documentElement.dataset.enhanced = 'true';
if (import.meta.hot !== undefined) {
  import.meta.hot.dispose(() => {
    cleanup();
    disposeTree(header);
  });
}
