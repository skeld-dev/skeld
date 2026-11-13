// Does:  Adds lightweight syntax colors to the curated TypeScript examples.
// Holds: Every token remains escaped template text; the source is never interpreted as HTML.

import { html } from '@lightstart/light/html/core';

export function codeExample(source: string) {
  const tokens = source.split(
    /(\/\/[^\n]*|'[^'\n]*'|"[^"\n]*"|\b(?:import|from|export|const|await|if|return|as)\b|\b\d+\b|\b[A-Za-z_$][\w$]*(?=\s*[:(]))/g,
  );
  return tokens.map((token, index) => {
    if (index % 2 === 0) {
      return token;
    }
    const kind = token.startsWith('//')
      ? 'comment'
      : token.startsWith("'") || token.startsWith('"')
        ? 'string'
        : /^(import|from|export|const|await|if|return|as)$/.test(token)
          ? 'keyword'
          : /^\d/.test(token)
            ? 'number'
            : tokens[index + 1]?.trimStart().startsWith(':')
              ? 'property'
              : 'function';
    return html`<span class=${`syntax-${kind}`}>${token}</span>`;
  });
}
