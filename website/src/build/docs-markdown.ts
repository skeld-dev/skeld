// Does: Publishes Markdown with navigable public links and a compact index for agents.
// Holds: Code fences remain verbatim; only the curated documentation collection is indexed.

import { Marked, type Token } from 'marked';
import type { DocPage } from '../pages/docs/model.ts';

export function markdownUrl(url: string): string {
  return `${url}index.md`;
}

export function publicMarkdown(source: string, resolveLink: (href: string) => string): string {
  const parser = new Marked({ gfm: true });
  function rewrite(text: string, tokens: Token[]): string {
    let result = '';
    let cursor = 0;
    for (const token of tokens) {
      const start = text.indexOf(token.raw, cursor);
      if (start < 0) {
        throw new Error('Cannot locate Markdown token in its source');
      }
      let raw = token.raw;
      if (token.type === 'link') {
        const href = resolveLink(token.href);
        const title = token.title ? ` "${token.title.replaceAll('"', '&quot;')}"` : '';
        raw = `[${token.text}](<${href}>${title})`;
      } else if (token.type === 'list') {
        raw = rewrite(raw, token.items);
      } else if (token.type === 'table') {
        const cells = [...token.header, ...token.rows.flat()];
        raw = rewrite(
          raw,
          cells.map((cell) => ({ type: 'text', raw: cell.text, tokens: cell.tokens })),
        );
      } else if ('tokens' in token && token.tokens !== undefined) {
        raw = rewrite(raw, token.tokens);
      }
      result += text.slice(cursor, start) + raw;
      cursor = start + token.raw.length;
    }
    return result + text.slice(cursor);
  }
  return rewrite(source, parser.lexer(source));
}

export function documentationIndex(pages: DocPage[]): string {
  const lines = [
    '# skeld documentation',
    '',
    '> A TypeScript backend framework for sensitive data, built around shared contracts.',
    '',
    'These are the public documentation pages in Markdown. Start with the overview and first-request guide; use the Core API pages for signatures and constraints.',
    '',
  ];
  for (const group of new Set(pages.map((page) => page.group))) {
    lines.push(`## ${group}`, '');
    for (const page of pages.filter((item) => item.group === group)) {
      const description =
        page.description.match(/^.*?[.!?](?=\s|$)/)?.[0] ?? `${page.description.replace(/\s+\S*$/, '')}…`;
      lines.push(`- [${page.label}](${page.markdownUrl}): ${description}`);
    }
    lines.push('');
  }
  return lines.join('\n');
}
