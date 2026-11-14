// Does: Publishes Markdown with navigable public links and a compact index for agents.
// Holds: Code fences remain verbatim; only the curated documentation collection is indexed.

import { Marked, type Token } from 'marked';
import type { DocPage } from '../pages/docs/model.ts';
import { publicUrl } from './site.ts';

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
    'These are the public documentation pages in Markdown. Start with the overview and the install guide; use the Core API pages for signatures and constraints.',
    '',
    `Website: ${publicUrl('/')}`,
    `Complete documentation in one file: ${publicUrl('/llms-full.txt')}`,
    '',
  ];
  for (const group of new Set(pages.map((page) => page.group))) {
    lines.push(`## ${group}`, '');
    for (const page of pages.filter((item) => item.group === group)) {
      const description =
        page.description.match(/^.*?[.!?](?=\s|$)/)?.[0] ?? `${page.description.replace(/\s+\S*$/, '')}…`;
      lines.push(`- [${page.label}](${publicUrl(page.markdownUrl)}): ${description}`);
    }
    lines.push('');
  }
  return lines.join('\n');
}

export function fullDocumentation(pages: DocPage[], files: Map<string, string>): string {
  const sections = [
    '# skeld documentation',
    '',
    '> Public documentation, generated from the same sources as the website.',
    '',
  ];
  for (const page of pages) {
    const markdown = files.get(page.markdownUrl.slice(1));
    if (markdown === undefined) {
      throw new Error(`Missing Markdown export: ${page.markdownUrl}`);
    }
    const standalone = publicMarkdown(markdown, (href) => new URL(href, publicUrl(page.markdownUrl)).href);
    sections.push('---', '', `Source: ${publicUrl(page.url)}`, '', standalone.trim(), '');
  }
  return sections.join('\n');
}
