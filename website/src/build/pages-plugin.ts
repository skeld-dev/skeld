// Does:  Maps page folders to public URLs for development, preview and static builds.
// Holds: Page sources stay under pages; public routes never expose source-folder paths.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { renderToString } from '@lightstart/light/markup';
import type { Connect, Plugin } from 'vite';
import { homePage } from '../pages/home/page.ts';
import { privacyPage } from '../pages/privacy/page.ts';
import { termsPage } from '../pages/terms/page.ts';

const pages = [
  { name: 'home', url: '/', render: homePage },
  { name: 'docs', url: '/docs/', render: undefined },
  { name: 'privacy', url: '/privacy/', render: privacyPage },
  { name: 'terms', url: '/terms/', render: termsPage },
].map((page) => ({
  ...page,
  source: `src/pages/${page.name}/index.html`,
  template: fileURLToPath(new URL(`../pages/${page.name}/index.html`, import.meta.url)),
  output: `${page.url.slice(1)}index.html`,
}));

export const pageInputs = Object.fromEntries(pages.map((page) => [page.name, page.template]));
const startPaths = ['/start', '/start/', '/start/index.html'];
const firstRequest = '/docs/guides/first-request/';
const license = () => readFileSync(new URL('../../../LICENSE', import.meta.url), 'utf8');

const redirectStart: Connect.NextHandleFunction = (request, response, next) => {
  const url = new URL(request.url ?? '/', 'http://localhost');
  if (!startPaths.includes(url.pathname)) {
    next();
    return;
  }
  response.statusCode = 301;
  response.setHeader('Location', firstRequest + url.search);
  response.end();
};

export function pagesPlugin(): Plugin {
  return {
    name: 'skeld-pages',
    configureServer(server) {
      server.middlewares.use(redirectStart);
      server.middlewares.use('/license.txt', (_request, response) => {
        response.setHeader('Content-Type', 'text/plain; charset=utf-8');
        response.end(license());
      });
      server.watcher.on('change', (path) => {
        if (pages.some((page) => page.template === path)) {
          server.ws.send({ type: 'full-reload' });
        }
      });
      server.middlewares.use((request, response, next) => {
        const url = new URL(request.url ?? '/', 'http://localhost');
        const page = pages.find((item) => item.url === url.pathname.replace(/index\.html$/, ''));
        if (page === undefined) {
          const directory = pages.find((item) => item.url === `${url.pathname}/`);
          if (directory === undefined) {
            next();
            return;
          }
          response.statusCode = 302;
          response.setHeader('Location', directory.url + url.search);
          response.end();
          return;
        }
        void server
          .transformIndexHtml(page.url, readFileSync(page.template, 'utf8'))
          .then((document) => {
            response.setHeader('Content-Type', 'text/html; charset=utf-8');
            response.end(document);
          })
          .catch(next);
      });
    },
    configurePreviewServer(server) {
      server.middlewares.use(redirectStart);
    },
    transformIndexHtml: {
      order: 'pre',
      handler(document, context) {
        const page = pages.find((item) => context.filename === item.template || context.path === item.url);
        return page?.render === undefined ? document : document.replace('<!-- app -->', renderToString(page.render()));
      },
    },
    generateBundle: {
      order: 'post',
      handler(_options, bundle) {
        for (const page of pages) {
          const entry = bundle[page.source];
          if (entry?.type !== 'asset') {
            throw new Error(`Missing page entry: ${page.source}`);
          }
          delete bundle[page.source];
          this.emitFile({ type: 'asset', fileName: page.output, source: entry.source });
        }
        this.emitFile({ type: 'asset', fileName: 'license.txt', source: license() });
        this.emitFile({
          type: 'asset',
          fileName: '_redirects',
          source: `${startPaths.map((path) => `${path} ${firstRequest} 301`).join('\n')}\n`,
        });
      },
    },
  };
}
