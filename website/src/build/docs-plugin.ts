// Does:  Serves documentation during development and emits complete static pages in production.
// Holds: Generated pages share Vite's hashed assets; authored Markdown is never shipped as a browser dependency.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { renderToString } from '@lightstart/light/markup';
import type { Connect, Plugin } from 'vite';
import { docsPage } from '../pages/docs/page.ts';
import type { DocPage } from '../pages/docs/model.ts';
import { buildDocumentation } from './docs-content.ts';
import { escapeHtml } from './docs-links.ts';
import { docDefinitions } from './docs-manifest.ts';

const templatePath = fileURLToPath(new URL('../pages/docs/index.html', import.meta.url));
const docsRoot = fileURLToPath(new URL('../../../docs/', import.meta.url));
function pagePath(path: string): string {
  return path.replace(/index\.html$/, '');
}
function renderPage(document: string, page: DocPage): string {
  return document
    .replace(/<title>[\s\S]*?<\/title>/, `<title>${escapeHtml(page.title)} | skeld docs</title>`)
    .replace(
      /<meta name="description" content="[^"]*"\s*\/>/,
      `<meta name="description" content="${escapeHtml(page.description)}" />`,
    )
    .replace('<!-- canonical -->', `<link rel="canonical" href="https://skeld.dev${page.url}" />`)
    .replace(
      '<!-- markdown -->',
      `<link rel="alternate" type="text/markdown" href="${page.markdownUrl}" /><link rel="describedby" href="/llms.txt" />`,
    )
    .replace(
      /<!-- docs-start -->[\s\S]*?<!-- docs-end -->/,
      `<!-- docs-start -->${renderToString(docsPage(page, docDefinitions))}<!-- docs-end -->`,
    );
}
export function docsPlugin(): Plugin {
  let collection = buildDocumentation();
  const markdownHeaders: Connect.NextHandleFunction = (request, response, next) => {
    const path = new URL(request.url ?? '/', 'http://localhost').pathname;
    if (collection.pages.some((page) => page.markdownUrl === path)) {
      response.setHeader('Content-Type', 'text/plain; charset=utf-8');
      response.setHeader('X-Content-Type-Options', 'nosniff');
    }
    next();
  };
  return {
    name: 'skeld-documentation',
    configureServer(server) {
      server.middlewares.use(markdownHeaders);
      server.watcher.add([docsRoot, ...collection.sourceFiles]);
      const refresh = (path: string) => {
        if (path.startsWith(docsRoot) || collection.sourceFiles.has(path)) {
          try {
            collection = buildDocumentation();
            server.watcher.add([...collection.sourceFiles]);
            server.ws.send({ type: 'full-reload' });
          } catch (error) {
            server.config.logger.error(error instanceof Error ? error.message : String(error));
          }
        }
      };
      server.watcher.on('change', refresh);
      server.watcher.on('add', refresh);
      server.watcher.on('unlink', refresh);
      server.middlewares.use((request, response, next) => {
        const path = new URL(request.url ?? '/', 'http://localhost').pathname;
        if (path === '/docs/search-index.json') {
          response.setHeader('Content-Type', 'application/json; charset=utf-8');
          response.end(JSON.stringify(collection.search));
          return;
        }
        const file = collection.files.get(path.slice(1));
        if (file !== undefined) {
          response.setHeader('Content-Type', 'text/plain; charset=utf-8');
          response.end(file);
          return;
        }
        if (!path.endsWith('/') && collection.pages.some((item) => item.url === pagePath(`${path}/`))) {
          response.statusCode = 302;
          response.setHeader('Location', `${path}/`);
          response.end();
          return;
        }
        const page = collection.pages.find((item) => item.url === pagePath(path));
        if (page === undefined) {
          next();
          return;
        }
        const document = readFileSync(templatePath, 'utf8');
        void server
          .transformIndexHtml(path, document)
          .then((rendered) => {
            response.setHeader('Content-Type', 'text/html; charset=utf-8');
            response.end(rendered);
          })
          .catch(next);
      });
    },
    configurePreviewServer(server) {
      server.middlewares.use(markdownHeaders);
    },
    transformIndexHtml: {
      order: 'pre',
      handler(document, context) {
        const path = context.filename === templatePath ? '/docs/' : pagePath(context.path);
        const page = collection.pages.find((item) => item.url === path);
        return page === undefined ? document : renderPage(document, page);
      },
    },
    generateBundle: {
      order: 'post',
      handler(_options, bundle) {
        const template = bundle['docs/index.html'];
        if (template?.type !== 'asset') {
          throw new Error('Documentation entry HTML is missing');
        }
        const templateSource =
          typeof template.source === 'string' ? template.source : new TextDecoder().decode(template.source);
        const document = templateSource
          .replace(/<link rel="canonical"[^>]*>/, '<!-- canonical -->')
          .replace(/<link rel="alternate"[^>]*>/, '<!-- markdown -->')
          .replace(/<link rel="describedby"[^>]*>/, '');
        for (const page of collection.pages) {
          if (page.url !== '/docs/') {
            this.emitFile({
              type: 'asset',
              fileName: `${page.url.slice(1)}index.html`,
              source: renderPage(document, page),
            });
          }
        }
        this.emitFile({ type: 'asset', fileName: 'docs/search-index.json', source: JSON.stringify(collection.search) });
        for (const [fileName, source] of collection.files) {
          this.emitFile({ type: 'asset', fileName, source });
        }
        this.emitFile({
          type: 'asset',
          fileName: '_headers',
          source:
            '/docs/*/index.md\n  Content-Type: text/plain; charset=utf-8\n  X-Content-Type-Options: nosniff\n/docs/index.md\n  Content-Type: text/plain; charset=utf-8\n  X-Content-Type-Options: nosniff\n',
        });
      },
    },
  };
}
