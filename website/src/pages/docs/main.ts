// Does:  Adopts the shared Light header and enhances the already-rendered documentation.
// Holds: Markdown, diagram rendering and the article tree stay out of browser execution.

import { configure, disposeTree, render } from '@lightstart/light/html';
import { effect } from '@lightstart/light/signals';
import { mountNavigation, siteHeader } from '../../components/site-header.ts';
import { mountReading } from './reading.ts';
import { mountMarkdown } from './markdown.ts';
import { mountSearch } from './search.ts';

const header = document.getElementById('docs-site-header');
if (header === null) {
  throw new Error('Documentation requires its shared header');
}
// Why: Direct renderer entries must install the signal effect adapter before adoption.
configure({ effect });
render(siteHeader('docs'), header, { adopt: true });
const cleanups = [mountNavigation(header), mountSearch(document), mountReading(document), mountMarkdown(document)];
document.documentElement.dataset.enhanced = 'true';
if (import.meta.hot !== undefined) {
  import.meta.hot.dispose(() => {
    for (const cleanup of cleanups) {
      cleanup();
    }
    disposeTree(header);
  });
}
