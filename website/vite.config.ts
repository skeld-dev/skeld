// Does:  Builds Light-rendered HTML pages, browser assets and the canonical software license.
// Holds: Static pages use the same templates the browser adopts; the license is read from the repository source.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { renderToString } from '@lightstart/light/markup';
import { defineConfig } from 'vite';
import { homePage } from './src/pages/home/page.ts';
import { infoPage } from './src/pages/info/page.ts';

const license = () => readFileSync(new URL('../LICENSE', import.meta.url), 'utf8');
const pages = ['start', 'privacy', 'terms'];

export default defineConfig({
  appType: 'mpa',
  plugins: [
    {
      name: 'skeld-page',
      transformIndexHtml: {
        order: 'pre',
        handler: (document, context) => {
          const name = pages.find((page) => context.path.startsWith(`/${page}/`));
          return document.replace('<!-- app -->', renderToString(name === undefined ? homePage() : infoPage(name)));
        },
      },
      configureServer(server) {
        server.middlewares.use('/license.txt', (_request, response) => {
          response.setHeader('Content-Type', 'text/plain; charset=utf-8');
          response.end(license());
        });
      },
      generateBundle() {
        this.emitFile({ type: 'asset', fileName: 'license.txt', source: license() });
      },
    },
  ],
  build: {
    target: 'esnext',
    rolldownOptions: {
      input: Object.fromEntries(
        ['index.html', ...pages.map((page) => `${page}/index.html`)].map((page) => [
          page,
          fileURLToPath(new URL(page, import.meta.url)),
        ]),
      ),
    },
  },
  server: { host: '0.0.0.0', port: 5173, strictPort: true },
  preview: { host: '0.0.0.0', port: 4173, strictPort: true },
});
