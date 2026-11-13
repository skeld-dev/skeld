// Does:  Adds code copying and a current-section indicator to static documentation.
// Holds: Copy failures offer selectable source; content and anchor navigation do not depend on these enhancements.

export function mountReading(root: ParentNode): () => void {
  const lifetime = new AbortController();
  const sidebar = root.querySelector<HTMLElement>('.docs-sidebar');
  const active = sidebar?.querySelector<HTMLElement>('[aria-current=page]');
  if (sidebar !== null && active !== null && active !== undefined) {
    sidebar.scrollTop = Math.max(0, active.offsetTop - sidebar.clientHeight / 2);
  }
  const status = root.querySelector<HTMLElement>('[data-copy-status]');
  const buttons = root.querySelectorAll<HTMLButtonElement>('[data-copy-code]');
  async function copy(button: HTMLButtonElement): Promise<void> {
    const code = button.closest('.docs-code')?.querySelector('code');
    if (code === null || code === undefined) {
      return;
    }
    try {
      if (navigator.clipboard === undefined) {
        throw new Error('Clipboard is unavailable');
      }
      await navigator.clipboard.writeText(code.textContent ?? '');
      button.textContent = 'Copied';
      if (status !== null) {
        status.textContent = 'Code copied.';
      }
    } catch {
      button.textContent = 'Selected';
      const range = document.createRange();
      range.selectNodeContents(code);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
      code.closest('pre')?.focus();
      if (status !== null) {
        status.textContent = 'Code selected. Press Control+C or Command+C to copy.';
      }
    }
  }
  for (const button of buttons) {
    button.hidden = false;
    button.addEventListener(
      'click',
      () => {
        void copy(button);
      },
      { signal: lifetime.signal },
    );
  }
  const headings = [...root.querySelectorAll<HTMLElement>('.docs-prose h2')];
  const links = root.querySelectorAll<HTMLAnchorElement>('[data-doc-heading]');
  const observer = new IntersectionObserver(
    () => {
      const passed = headings.filter((heading) => heading.getBoundingClientRect().top <= 140);
      const current = passed.at(-1) ?? headings[0];
      for (const link of links) {
        if (link.dataset.docHeading === current?.id) {
          link.setAttribute('aria-current', 'location');
        } else {
          link.removeAttribute('aria-current');
        }
      }
    },
    { rootMargin: '-20px 0px -65% 0px' },
  );
  for (const heading of headings) {
    observer.observe(heading);
  }
  return () => {
    lifetime.abort();
    observer.disconnect();
  };
}
