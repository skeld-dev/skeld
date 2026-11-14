// Does: Copies the current page's public Markdown and offers a selectable fallback.
// Holds: The source loads only on demand; failures preserve a working native Markdown link.

export function mountMarkdown(root: ParentNode): () => void {
  const lifetime = new AbortController();
  const button = root.querySelector<HTMLButtonElement>('[data-copy-markdown]');
  const link = root.querySelector<HTMLAnchorElement>('[data-view-markdown]');
  const status = root.querySelector<HTMLElement>('[data-markdown-status]');
  const fallback = root.querySelector<HTMLDetailsElement>('[data-markdown-fallback]');
  const textarea = fallback?.querySelector('textarea');
  if (button === null || link === null || status === null || fallback === null || textarea == null) {
    return () => lifetime.abort();
  }
  let markdown: string | undefined;
  const copy = async (): Promise<void> => {
    button.disabled = true;
    button.textContent = 'Loading Markdown';
    status.textContent = '';
    try {
      if (markdown === undefined) {
        const response = await fetch(link.href, { signal: lifetime.signal });
        if (!response.ok || !response.headers.get('content-type')?.startsWith('text/plain')) {
          throw new Error('Markdown is unavailable');
        }
        markdown = await response.text();
      }
      if (lifetime.signal.aborted) {
        return;
      }
      try {
        if (navigator.clipboard === undefined) {
          throw new Error('Clipboard is unavailable');
        }
        await navigator.clipboard.writeText(markdown);
        if (lifetime.signal.aborted) {
          return;
        }
        fallback.hidden = true;
        button.textContent = 'Copied';
        status.textContent = 'Page copied as Markdown.';
      } catch {
        if (lifetime.signal.aborted) {
          return;
        }
        textarea.value = markdown;
        fallback.hidden = false;
        fallback.open = true;
        textarea.focus();
        textarea.select();
        button.textContent = 'Copy Markdown';
        status.textContent = 'Markdown selected. Copy the selected text, or open View Markdown.';
      }
    } catch {
      if (!lifetime.signal.aborted) {
        button.textContent = 'Copy Markdown';
        status.textContent = 'Could not load Markdown. Try again or open View Markdown.';
      }
    } finally {
      if (!lifetime.signal.aborted) {
        button.disabled = false;
      }
    }
  };
  button.hidden = false;
  button.addEventListener(
    'click',
    () => {
      void copy();
    },
    { signal: lifetime.signal },
  );
  return () => lifetime.abort();
}
