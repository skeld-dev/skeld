// Does:  Searches the static documentation index on demand and renders ordinary result links.
// Holds: Only the latest query can update results; errors remain retryable and all result text is escaped by the DOM.

import type { SearchEntry } from './model.ts';

function isEntry(value: unknown): value is SearchEntry {
  return (
    typeof value === 'object' &&
    value !== null &&
    'url' in value &&
    typeof value.url === 'string' &&
    value.url.startsWith('/docs/') &&
    'title' in value &&
    typeof value.title === 'string' &&
    'group' in value &&
    typeof value.group === 'string' &&
    'text' in value &&
    typeof value.text === 'string'
  );
}
function searchElements(root: ParentNode) {
  const form = root.querySelector<HTMLFormElement>('.docs-search');
  const input = root.querySelector<HTMLInputElement>('#docs-search-input');
  const results = root.querySelector<HTMLUListElement>('#docs-search-results');
  const status = root.querySelector<HTMLElement>('.docs-search-status');
  const clear = root.querySelector<HTMLButtonElement>('[data-clear-search]');
  if (form === null || input === null || results === null || status === null || clear === null) {
    throw new Error('Documentation search requires its controls');
  }
  return { form, input, results, status, clear };
}

function resultSummary(count: number): string {
  if (count === 0) {
    return 'No matching pages. Try a different term.';
  }
  return `${count} matching ${count === 1 ? 'page' : 'pages'}${count > 8 ? '. Showing the first 8' : ''}.`;
}

export function mountSearch(root: ParentNode): () => void {
  const { form, input, results, status, clear } = searchElements(root);
  const lifetime = new AbortController();
  let pending: Promise<SearchEntry[]> | undefined;
  let sequence = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  function index(): Promise<SearchEntry[]> {
    pending ??= fetch('/docs/search-index.json', { signal: lifetime.signal })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error('Documentation search is unavailable');
        }
        const value: unknown = await response.json();
        if (!Array.isArray(value) || !value.every(isEntry)) {
          throw new Error('Invalid documentation search index');
        }
        return value;
      })
      .catch((error: unknown) => {
        pending = undefined;
        throw error;
      });
    return pending;
  }
  async function search(version: number): Promise<void> {
    const query = input.value.trim().toLowerCase();
    results.replaceChildren();
    results.hidden = true;
    status.textContent = query.length < 2 ? (query === '' ? '' : 'Type at least two characters.') : 'Searching…';
    if (query.length < 2) {
      return;
    }
    try {
      const entries = await index();
      if (version !== sequence || lifetime.signal.aborted) {
        return;
      }
      const words = query.split(/\s+/);
      const matches = entries.filter((entry) =>
        words.every((word) => `${entry.title} ${entry.text}`.toLowerCase().includes(word)),
      );
      matches.sort(
        (a, b) => Number(b.title.toLowerCase().includes(query)) - Number(a.title.toLowerCase().includes(query)),
      );
      for (const entry of matches.slice(0, 8)) {
        const item = document.createElement('li');
        const link = document.createElement('a');
        link.href = entry.url;
        const title = document.createElement('strong');
        title.textContent = entry.title;
        const group = document.createElement('span');
        group.textContent = entry.group;
        link.append(title, group);
        item.append(link);
        results.append(item);
      }
      results.hidden = matches.length === 0;
      status.textContent = resultSummary(matches.length);
    } catch {
      if (version === sequence && !lifetime.signal.aborted) {
        status.textContent = 'Search could not load. Press Enter to retry, or browse the topics.';
      }
    }
  }
  function schedule(): void {
    sequence += 1;
    clearTimeout(timer);
    const version = sequence;
    timer = setTimeout(() => {
      void search(version);
    }, 140);
  }
  input.disabled = false;
  clear.disabled = false;
  input.addEventListener(
    'input',
    (event) => {
      if (!(event instanceof InputEvent) || !event.isComposing) {
        schedule();
      }
    },
    { signal: lifetime.signal },
  );
  input.addEventListener('compositionend', schedule, { signal: lifetime.signal });
  form.addEventListener(
    'submit',
    (event) => {
      event.preventDefault();
      clearTimeout(timer);
      sequence += 1;
      void search(sequence);
    },
    { signal: lifetime.signal },
  );
  clear.addEventListener(
    'click',
    () => {
      input.value = '';
      sequence += 1;
      clearTimeout(timer);
      results.replaceChildren();
      results.hidden = true;
      status.textContent = '';
      input.focus();
    },
    { signal: lifetime.signal },
  );
  return () => {
    lifetime.abort();
    clearTimeout(timer);
  };
}
