// Does: Generates crawl discovery and Cloudflare headers from the finished static build.
// Holds: CSP hashes match shipped JSON-LD; only canonical HTML enters the sitemap.

import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Plugin, ResolvedConfig } from 'vite';
import { publicUrl } from './site.ts';

function contentPolicy(hashes: string[] = []): string {
  return [
    "default-src 'none'",
    `script-src 'self' ${hashes.join(' ')}`.trim(),
    "script-src-attr 'none'",
    "style-src 'self'",
    "style-src-attr 'none'",
    "img-src 'self'",
    "font-src 'self'",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; ');
}

function pageHeaders(document: string, name: string, urls: string[]): string[] {
  const canonical = document.match(/<link rel="canonical" href="([^"]+)"/)?.[1];
  if (canonical === undefined) {
    if (name !== '404.html') {
      throw new Error(`Missing canonical URL: ${name}`);
    }
    return [];
  }
  const path = new URL(canonical).pathname;
  if (canonical !== publicUrl(path) || urls.includes(canonical)) {
    throw new Error(`Invalid or duplicate canonical URL: ${canonical}`);
  }
  urls.push(canonical);
  const hashes = [...document.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map(
    (match) =>
      `'sha256-${createHash('sha256')
        .update(match[1] ?? '')
        .digest('base64')}'`,
  );
  if (hashes.length !== 1) {
    throw new Error(`Expected one structured-data graph: ${name}`);
  }
  return [path, '  ! Content-Security-Policy', `  Content-Security-Policy: ${contentPolicy(hashes)}`, ''];
}

export function deliveryPlugin(): Plugin {
  let config: ResolvedConfig;
  return {
    name: 'skeld-delivery',
    configResolved(value) {
      config = value;
    },
    writeBundle(_options, bundle) {
      const headers = [
        '/*',
        `  Content-Security-Policy: ${contentPolicy()}`,
        '  X-Content-Type-Options: nosniff',
        '  X-Frame-Options: DENY',
        '  Referrer-Policy: strict-origin-when-cross-origin',
        '  Strict-Transport-Security: max-age=31536000',
        '  Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=()',
        '',
        '/assets/*',
        '  Cache-Control: public, max-age=3600',
        '',
        '/robots.txt',
        '  Content-Type: text/plain; charset=utf-8',
        '',
        '/sitemap.xml',
        '  Content-Type: application/xml; charset=utf-8',
        '',
        '/llms.txt',
        '  Content-Type: text/plain; charset=utf-8',
        '',
        '/llms-full.txt',
        '  Content-Type: text/plain; charset=utf-8',
        '',
        '/docs/index.md',
        '  Content-Type: text/plain; charset=utf-8',
        `  Link: <${publicUrl('/docs/')}>; rel="canonical"`,
        '',
        '/docs/*/index.md',
        '  Content-Type: text/plain; charset=utf-8',
        `  Link: <${publicUrl('/docs/:splat/')}>; rel="canonical"`,
        '',
        '/docs/files/*',
        '  Content-Type: text/plain; charset=utf-8',
        '  X-Robots-Tag: noindex',
        '',
        '/docs/search-index.json',
        '  X-Robots-Tag: noindex',
        '',
        '/404.html',
        '  X-Robots-Tag: noindex',
        '',
        '/404',
        '  X-Robots-Tag: noindex',
        '',
        'https://:worker.:account.workers.dev/*',
        '  X-Robots-Tag: noindex',
        '',
      ];
      const urls: string[] = [];
      for (const [name, entry] of Object.entries(bundle)) {
        if (/^assets\/[^/]+-[\w-]{8}\.(?:js|css)$/.test(name)) {
          headers.push(`/${name}`, '  ! Cache-Control', '  Cache-Control: public, max-age=31536000, immutable', '');
        }
        if (entry.type !== 'asset' || !name.endsWith('.html')) {
          continue;
        }
        const document = typeof entry.source === 'string' ? entry.source : new TextDecoder().decode(entry.source);
        headers.push(...pageHeaders(document, name, urls));
      }
      if (
        headers.some((line) => line.length > 2000) ||
        headers.filter((line) => line !== '' && !line.startsWith(' ')).length > 100
      ) {
        throw new Error('Generated headers exceed Cloudflare static asset limits');
      }
      const directory = resolve(config.root, config.build.outDir);
      writeFileSync(resolve(directory, '_headers'), `${headers.join('\n')}\n`);
      writeFileSync(
        resolve(directory, 'robots.txt'),
        `User-agent: *\nAllow: /\n\nSitemap: ${publicUrl('/sitemap.xml')}\n`,
      );
      writeFileSync(
        resolve(directory, 'sitemap.xml'),
        `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls
          .sort()
          .map((url) => `  <url><loc>${url}</loc></url>`)
          .join('\n')}\n</urlset>\n`,
      );
    },
  };
}
