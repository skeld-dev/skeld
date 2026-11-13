// Does:  Builds the landing page's initial HTML and its browser assets with Light.
// Holds: Initial page content comes from the same templates the browser adopts.

import { renderToString } from '@lightstart/light/markup';
import { defineConfig } from 'vite';
import { homePage } from './src/pages/home/page.ts';

export default defineConfig({
  appType: 'mpa',
  plugins: [
    {
      name: 'skeld-page',
      transformIndexHtml: {
        order: 'pre',
        handler: (document) => document.replace('<!-- app -->', renderToString(homePage())),
      },
    },
  ],
  build: { target: 'esnext' },
  server: { host: '0.0.0.0', port: 5173, strictPort: true },
  preview: { host: '0.0.0.0', port: 4173, strictPort: true },
});
