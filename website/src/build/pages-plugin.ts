// Does:  Maps page folders to public URLs for development, preview and static builds.
// Holds: Page sources stay under pages; public routes never expose source-folder paths.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderToString } from '@lightstart/light/markup';
import type { Connect, Plugin } from 'vite';
import { homePage } from '../pages/home/page.ts';
import { contributingPage } from '../pages/contributing/page.ts';
import { privacyPage } from '../pages/privacy/page.ts';
import { securityPage } from '../pages/security/page.ts';
import { explorePage } from '../pages/explore/page.ts';
import { termsPage } from '../pages/terms/page.ts';
import { notFoundPage } from '../pages/not-found/page.ts';
import { withSocialMetadata } from './social-metadata.ts';

const pages = [
  { name: 'home', url: '/', render: homePage },
  { name: 'docs', url: '/docs/', render: undefined },
  { name: 'explore', url: '/explore/', render: explorePage },
  { name: 'security', url: '/security/', render: securityPage },
  { name: 'contributing', url: '/contributing/', render: contributingPage },
  { name: 'privacy', url: '/privacy/', render: privacyPage },
  { name: 'terms', url: '/terms/', render: termsPage },
  { name: 'not-found', url: '/404.html', render: notFoundPage },
].map((page) => ({
  ...page,
  source: `src/pages/${page.name}/index.html`,
  template: fileURLToPath(new URL(`../pages/${page.name}/index.html`, import.meta.url)),
  output: page.name === 'not-found' ? '404.html' : `${page.url.slice(1)}index.html`,
}));

export const pageInputs = Object.fromEntries(pages.map((page) => [page.name, page.template]));
const redirects = [
  ...['/start', '/start/', '/start/index.html'].map((path) => ({ path, destination: '/docs/guides/first-request/' })),
  ...['/scenarios', '/scenarios/', '/scenarios/index.html'].map((path) => ({ path, destination: '/explore/' })),
];
const license = () => readFileSync(new URL('../../../LICENSE', import.meta.url), 'utf8');
const notFoundTemplate = fileURLToPath(new URL('../pages/not-found/index.html', import.meta.url));

const redirectPage: Connect.NextHandleFunction = (request, response, next) => {
  const url = new URL(request.url ?? '/', 'http://localhost');
  const destination = redirects.find((entry) => entry.path === url.pathname)?.destination;
  if (destination === undefined) {
    next();
    return;
  }
  response.statusCode = 301;
  response.setHeader('Location', destination + url.search);
  response.end();
};

export function pagesPlugin(): Plugin {
  return {
    name: 'skeld-pages',
    configureServer(server) {
      server.middlewares.use(redirectPage);
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
            response.statusCode = page.name === 'not-found' ? 404 : 200;
            response.setHeader('Content-Type', 'text/html; charset=utf-8');
            response.end(document);
          })
          .catch(next);
      });
      return () => {
        server.middlewares.use((request, response, next) => {
          void server
            .transformIndexHtml('/404.html', readFileSync(notFoundTemplate, 'utf8'))
            .then((document) => {
              response.statusCode = 404;
              response.setHeader('Content-Type', 'text/html; charset=utf-8');
              response.end(request.method === 'HEAD' ? undefined : document);
            })
            .catch(next);
        });
      };
    },
    configurePreviewServer(server) {
      server.middlewares.use(redirectPage);
      return () => {
        server.middlewares.use((request, response) => {
          response.statusCode = 404;
          response.setHeader('Content-Type', 'text/html; charset=utf-8');
          response.end(
            request.method === 'HEAD'
              ? undefined
              : readFileSync(resolve(server.config.root, server.config.build.outDir, '404.html')),
          );
        });
      };
    },
    transformIndexHtml: {
      order: 'pre',
      handler(document, context) {
        const page = pages.find((item) => context.filename === item.template || context.path === item.url);
        return page?.render === undefined
          ? document
          : withSocialMetadata(document.replace('<!-- app -->', renderToString(page.render())), page.url);
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
          source: `${redirects.map(({ path, destination }) => `${path} ${destination} 301`).join('\n')}\n`,
        });
      },
    },
  };
}
