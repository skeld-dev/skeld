// Does: Checks the actual build artifacts before they can be deployed.
// Holds: Broken canonicals, discovery, structured data and CSP hashes fail the build.

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const directory = process.argv[2] ?? fileURLToPath(new URL('../dist/', import.meta.url));
const read = (name: string) => readFileSync(resolve(directory, name), 'utf8');
const headers = read('_headers');
const rules = headers.trim().split(/\n\s*\n/);
assert(rules.length <= 100, 'Cloudflare allows 100 header rules');
assert(
  headers.split('\n').every((line) => line.length <= 2000),
  'Cloudflare header lines must fit',
);
assert(!/unsafe-inline|unsafe-eval/.test(headers), 'CSP must not allow arbitrary inline code or eval');
const base = rules.find((rule) => rule.startsWith('/*\n')) ?? '';
for (const directive of [
  "default-src 'none'",
  "base-uri 'none'",
  "frame-ancestors 'none'",
  'X-Content-Type-Options: nosniff',
  'X-Frame-Options: DENY',
]) {
  assert(base.includes(directive), `Missing security header: ${directive}`);
}
const sitemap = read('sitemap.xml');
const sitemapUrls = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1]);
const canonicalUrls: string[] = [];
const titles = new Set<string>();
const descriptions = new Set<string>();
const documents = readdirSync(directory, { recursive: true, encoding: 'utf8' }).filter((name) =>
  name.endsWith('.html'),
);
for (const name of documents) {
  const document = read(name);
  const head = document.match(/<head>([\s\S]*?)<\/head>/)?.[1] ?? '';
  assert.equal((document.match(/<h1\b/g) ?? []).length, 1, `${name}: one primary heading`);
  if (name === '404.html') {
    assert(head.includes('content="noindex, follow"'), '404 must not be indexed');
    assert(!head.includes('rel="canonical"'), '404 must not canonicalize missing URLs');
    assert(!head.includes('application/ld+json'), '404 must not advertise a real content entity');
    for (const href of ['/', '/docs/']) {
      assert(document.includes(`href="${href}"`), '404 recovery link');
    }
    continue;
  }
  const expectedUrl = `https://skeld.dev/${name.replace(/index\.html$/, '')}`;
  const canonical = [...head.matchAll(/rel="canonical" href="([^"]+)"/g)].map((match) => match[1]);
  assert.deepEqual(canonical, [expectedUrl], `${name}: canonical URL`);
  canonicalUrls.push(expectedUrl);
  const title = head.match(/<title>(.*?)<\/title>/)?.[1] ?? '';
  const description = head.match(/name="description" content="([^"]*)"/)?.[1] ?? '';
  assert(title.length > 0 && !titles.has(title), `${name}: unique title`);
  assert(description.length > 0 && !descriptions.has(description), `${name}: unique description`);
  titles.add(title);
  descriptions.add(description);
  assert(head.includes('max-image-preview:large'), `${name}: image previews`);
  for (const [property, value] of [
    ['og:url', expectedUrl],
    ['og:title', title],
    ['og:description', description],
    ['og:image', 'https://skeld.dev/assets/skeld-social.png'],
  ]) {
    assert.equal((head.match(new RegExp(`property="${property}"`, 'g')) ?? []).length, 1, `${name}: one ${property}`);
    assert(head.includes(`property="${property}" content="${value}"`), `${name}: ${property}`);
  }
  const scripts = [...head.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)];
  assert.equal(scripts.length, 1, `${name}: one JSON-LD graph`);
  const json = scripts[0]?.[1] ?? '';
  const data: unknown = JSON.parse(json);
  assert(isRecord(data));
  assert.equal(data['@context'], 'https://schema.org');
  const graph = data['@graph'];
  assert(Array.isArray(graph) && graph.every(isRecord));
  const page = graph.find((node) => node['@type'] === 'WebPage');
  assert.equal(page?.url, expectedUrl, `${name}: JSON-LD URL`);
  const ids = graph.map((node) => node['@id']);
  assert.equal(new Set(ids).size, ids.length, `${name}: unique entity IDs`);
  if (name.startsWith('docs/')) {
    assert(
      graph.some((node) => node['@type'] === 'TechArticle'),
      `${name}: technical article`,
    );
  }
  const route = new URL(expectedUrl).pathname;
  const rule = rules.find((entry) => entry.startsWith(`${route}\n`)) ?? '';
  const hash = createHash('sha256').update(json).digest('base64');
  assert(rule.includes(`'sha256-${hash}'`), `${name}: CSP hash matches shipped JSON-LD`);
  assert(rule.includes('! Content-Security-Policy'), `${name}: replace the fallback CSP`);
}
assert(documents.includes('404.html'), 'Custom 404 must ship');
assert.deepEqual(sitemapUrls.sort(), canonicalUrls.sort(), 'Sitemap contains exactly the canonical HTML pages');
assert(read('robots.txt').includes('Sitemap: https://skeld.dev/sitemap.xml'), 'robots must advertise sitemap');
assert(read('robots.txt').includes('Allow: /'), 'Public crawling is enabled');
assert(read('llms.txt').includes('https://skeld.dev/llms-full.txt'), 'Agent index points to full documentation');
const full = read('llms-full.txt');
for (const url of canonicalUrls.filter((entry) => entry.includes('/docs/'))) {
  assert(full.includes(`Source: ${url}\n`), `Full documentation includes ${url}`);
}
const image = readFileSync(resolve(directory, 'assets/skeld-social.png'));
assert.equal(image.readUInt32BE(16), 1200);
assert.equal(image.readUInt32BE(20), 630);
process.stdout.write(
  `Delivery checks passed: ${canonicalUrls.length} canonical pages, JSON-LD/CSP, sitemap, crawler exports and 404.\n`,
);
