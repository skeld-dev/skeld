// Does: Enables the shared navigation on the static 404 page.
// Holds: Missing-page recovery does not require client-side routing.

import { configure, disposeTree, render } from '@lightstart/light/html';
import { effect } from '@lightstart/light/signals';
import { mountNavigation, siteHeader } from '../../components/site-header.ts';

const header = document.getElementById('not-found-site-header');
if (header === null) {
  throw new Error('The 404 page requires its shared header');
}
configure({ effect });
render(siteHeader(), header, { adopt: true });
const cleanup = mountNavigation(header);
document.documentElement.dataset.enhanced = 'true';
if (import.meta.hot !== undefined) {
  import.meta.hot.dispose(() => {
    cleanup();
    disposeTree(header);
  });
}
