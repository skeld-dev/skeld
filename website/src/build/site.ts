// Does: Keeps public site identity consistent across metadata and crawler exports.
// Holds: These describe the public framework, without inventing ratings or business claims.

export const site = {
  origin: 'https://skeld.dev',
  name: 'skeld',
  description: 'A TypeScript backend framework for sensitive data, built around shared contracts.',
  repository: 'https://github.com/skeld-dev/skeld',
  language: 'en',
} as const;

export function publicUrl(path: string): string {
  return new URL(path, site.origin).href;
}
