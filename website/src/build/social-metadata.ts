// Does: Adds search metadata, linked data and social cards to fully rendered HTML.
// Holds: Each route keeps its own title and description; crawlers need no JavaScript.

import { publicUrl } from './site.ts';
import { structuredData, type PageDetails } from './structured-data.ts';

const image = publicUrl('/assets/skeld-social.png');
const imageAlt = 'skeld — Your API. Under contract. An ice-blue glacier against a dark Polar background.';

function plainMetadata(value: string): string {
  // Templates use the same five HTML entities as escapeHtml in docs-links.
  return value.replace(/&(amp|lt|gt|quot|#39);/g, (entity) => {
    switch (entity) {
      case '&amp;':
        return '&';
      case '&lt;':
        return '<';
      case '&gt;':
        return '>';
      case '&quot;':
        return '"';
      default:
        return "'";
    }
  });
}

export function withSocialMetadata(document: string, path: string, details?: PageDetails): string {
  // Titles and descriptions are already HTML-escaped by their owning templates.
  const title = document.match(/<title>([\s\S]*?)<\/title>/)?.[1]?.replace(/"/g, '&quot;');
  const description = document.match(/<meta name="description" content="([^"]*)"\s*\/?>/)?.[1];
  if (title === undefined || description === undefined) {
    throw new Error(`Missing social title or description for ${path}`);
  }
  const url = publicUrl(path);
  const metadata =
    path === '/404.html'
      ? '<!-- social-start --><meta name="robots" content="noindex, follow" /><!-- social-end -->'
      : `<!-- social-start -->
    <link rel="canonical" href="${url}" />
    <meta name="robots" content="index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1" />
    <meta name="application-name" content="skeld" />
    <meta property="og:type" content="website" />
    <meta property="og:site_name" content="skeld" />
    <meta property="og:locale" content="en_US" />
    <meta property="og:title" content="${title}" />
    <meta property="og:description" content="${description}" />
    <meta property="og:url" content="${url}" />
    <meta property="og:image" content="${image}" />
    <meta property="og:image:type" content="image/png" />
    <meta property="og:image:width" content="1200" />
    <meta property="og:image:height" content="630" />
    <meta property="og:image:alt" content="${imageAlt}" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${title}" />
    <meta name="twitter:description" content="${description}" />
    <meta name="twitter:image" content="${image}" />
    <meta name="twitter:image:alt" content="${imageAlt}" />
    <script type="application/ld+json">${structuredData(path, details ?? { title: plainMetadata(title), description: plainMetadata(description) })}</script>
    <!-- social-end -->`;
  // Documentation reuses the built index shell; replace its card for each route.
  return document
    .replace(/<!-- social-start -->[\s\S]*?<!-- social-end -->\s*/, '')
    .replace('</head>', () => `${metadata}\n  </head>`);
}
