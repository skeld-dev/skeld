// Does:  Resolves Markdown links to published pages or explicitly referenced checkout files.
// Holds: Source reads stay inside the repository and never publish project, credential or maintainer files.

import { closeSync, constants, fstatSync, openSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import type { DocDefinition } from '../pages/docs/model.ts';

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    switch (character) {
      case '&':
        return '&amp;';
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '"':
        return '&quot;';
      default:
        return '&#39;';
    }
  });
}
export interface DocLink {
  source: string;
  target: string;
  fragment: string;
}
export function createLinkResolver(root: string, definitions: DocDefinition[]) {
  const pages = new Map(definitions.map((page) => [page.source, page]));
  const files = new Map<string, string>();
  const links: DocLink[] = [];
  const sourceFiles = new Set<string>();
  const repository = realpathSync(root);
  function resolveLink(source: string, href: string): string {
    if (/^(https?:|mailto:)/i.test(href)) {
      return href;
    }
    if (/^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(href)) {
      throw new Error(`Unsupported link in ${source}: ${href}`);
    }
    const [pathname = '', hash = ''] = href.split('#');
    const fragment = decodeURIComponent(hash);
    const target = pathname === '' ? source : join(dirname(source), decodeURIComponent(pathname));
    const page = pages.get(target);
    if (page !== undefined) {
      links.push({ source, target, fragment });
      return `${page.url}${fragment === '' ? '' : `#${encodeURIComponent(fragment)}`}`;
    }
    const allowed =
      /^(?:examples\/|(?:tests|benchmarks)\/README\.md$|packages\/core\/README\.md$|docs\/logging\/collector\.yaml$|CONTRIBUTING\.md$|\.nvmrc$)/.test(
        target,
      );
    if (!allowed || /(?:^|\/)\.{1,2}(?:\/|$)/.test(target)) {
      throw new Error(`Unpublished documentation link in ${source}: ${href}`);
    }
    const path = realpathSync(resolve(repository, target));
    if (relative(repository, path).startsWith(`..${sep}`) || relative(repository, path) === '..') {
      throw new Error(`Documentation source link leaves the repository: ${target}`);
    }
    const asset = target === '.nvmrc' ? 'docs/files/node-version.txt' : `docs/files/${target}.txt`;
    // Inspect and read the same descriptor; refuse a final-component symlink replacement.
    // The build checkout and its ancestor directories are controlled by the maintainer.
    const descriptor = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      if (!fstatSync(descriptor).isFile()) {
        throw new Error(`Documentation source is not a regular file: ${target}`);
      }
      files.set(asset, readFileSync(descriptor, 'utf8'));
      sourceFiles.add(path);
    } finally {
      closeSync(descriptor);
    }
    return `/${asset}`;
  }
  return { resolveLink, files, links, sourceFiles };
}
