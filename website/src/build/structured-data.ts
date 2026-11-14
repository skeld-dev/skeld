// Does: Describes visible pages and the open-source framework as linked structured data.
// Holds: No fabricated dates, reviews, offers, organization or search endpoint.

import { publicUrl, site } from './site.ts';

export interface Breadcrumb {
  name: string;
  path: string;
}
export interface PageDetails {
  title: string;
  description: string;
  breadcrumbs?: Breadcrumb[];
  articleSection?: string;
}

export function structuredData(path: string, details: PageDetails): string {
  const url = publicUrl(path);
  const websiteId = publicUrl('/#website');
  const softwareId = publicUrl('/#software');
  const pageId = `${url}#webpage`;
  const breadcrumbs = details.breadcrumbs ?? [
    { name: 'skeld', path: '/' },
    { name: details.title.replace(/ \| skeld$/, ''), path },
  ];
  const graph: Record<string, unknown>[] = [
    {
      '@type': 'WebSite',
      '@id': websiteId,
      url: publicUrl('/'),
      name: site.name,
      description: site.description,
      inLanguage: site.language,
      about: { '@id': softwareId },
    },
    {
      '@type': 'SoftwareSourceCode',
      '@id': softwareId,
      name: site.name,
      url: publicUrl('/'),
      description: site.description,
      codeRepository: site.repository,
      programmingLanguage: 'TypeScript',
      runtimePlatform: 'Node.js',
      license: publicUrl('/license.txt'),
    },
    {
      '@type': 'WebPage',
      '@id': pageId,
      url,
      name: details.title,
      description: details.description,
      inLanguage: site.language,
      isPartOf: { '@id': websiteId },
      about: { '@id': softwareId },
      primaryImageOfPage: {
        '@type': 'ImageObject',
        url: publicUrl('/assets/skeld-social.png'),
        width: 1200,
        height: 630,
      },
      ...(path === '/'
        ? {
            mainEntity: { '@id': softwareId },
            speakable: { '@type': 'SpeakableSpecification', cssSelector: ['.hero-kicker', '.hero-description'] },
          }
        : { breadcrumb: { '@id': `${url}#breadcrumbs` } }),
      ...(details.articleSection === undefined ? {} : { mainEntity: { '@id': `${url}#article` } }),
    },
  ];
  if (path !== '/') {
    graph.push({
      '@type': 'BreadcrumbList',
      '@id': `${url}#breadcrumbs`,
      itemListElement: breadcrumbs.map((crumb, index) => ({
        '@type': 'ListItem',
        position: index + 1,
        name: crumb.name,
        item: publicUrl(crumb.path),
      })),
    });
  }
  if (details.articleSection !== undefined) {
    graph.push({
      '@type': 'TechArticle',
      '@id': `${url}#article`,
      headline: details.title.replace(/ \| skeld docs$/, ''),
      description: details.description,
      url,
      inLanguage: site.language,
      articleSection: details.articleSection,
      mainEntityOfPage: { '@id': pageId },
      about: { '@id': softwareId },
      isAccessibleForFree: true,
    });
  }
  // A literal '<' could terminate the script element even in a JSON string.
  return JSON.stringify({ '@context': 'https://schema.org', '@graph': graph }).replace(/</g, '\\u003c');
}
