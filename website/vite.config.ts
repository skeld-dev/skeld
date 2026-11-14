// Does:  Builds independently addressable Light pages and canonical Markdown documentation.
// Holds: Page sources live under src/pages; build plugins emit their public URL structure.

import { defineConfig } from 'vite';
import { docsPlugin } from './src/build/docs-plugin.ts';
import { deliveryPlugin } from './src/build/delivery-plugin.ts';
import { pageInputs, pagesPlugin } from './src/build/pages-plugin.ts';

export default defineConfig({
  appType: 'mpa',
  plugins: [pagesPlugin(), docsPlugin(), deliveryPlugin()],
  build: {
    target: 'esnext',
    rolldownOptions: { input: pageInputs },
  },
  server: { host: '0.0.0.0', port: 5173, strictPort: true },
  preview: { host: '0.0.0.0', port: 4173, strictPort: true },
});
