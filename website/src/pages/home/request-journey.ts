// Does:  Coordinates the illustrative request path, scenario selection and finite playback.
// Holds: No request is sent; hidden pages pause playback and reduced motion skips transitions.

import { signal } from '@lightstart/light/signals';

export const journeyStep = signal(0);
export const journeyInvalid = signal(false);
export const journeyPlaying = signal(false);
export const projectName = 'polar';
export const longProjectName = 'polar-observatory-expedition';
export const projectNameLimit = 24;

export function mountContractWalkthrough(root: HTMLElement): () => void {
  const section = root.querySelector<HTMLElement>('#contract');
  const path = root.querySelector<HTMLElement>('.journey-tabs');
  if (section === null || path === null) {
    throw new Error('Request journey requires its section and path');
  }
  const lifetime = new AbortController();
  const options = { signal: lifetime.signal };
  const preference = matchMedia('(prefers-reduced-motion: reduce)');
  let timer: ReturnType<typeof setTimeout> | undefined;
  let visible = false;
  let started = false;

  function clearTimer(): void {
    clearTimeout(timer);
    timer = undefined;
  }

  function stop(): void {
    clearTimer();
    journeyPlaying.value = false;
  }

  function schedule(): void {
    clearTimer();
    if (!journeyPlaying.value || !visible || document.hidden) {
      return;
    }
    const last = journeyInvalid.value ? 1 : 3;
    if (journeyStep.value >= last) {
      stop();
      return;
    }
    // Why: A four-second overview leaves the final state in place; each stage also supports manual inspection.
    timer = setTimeout(
      () => {
        journeyStep.value += 1;
        schedule();
      },
      journeyStep.value === 0 ? 1000 : 1500,
    );
  }

  function run(): void {
    started = true;
    stop();
    if (preference.matches) {
      journeyStep.value = journeyInvalid.value ? 1 : 3;
      return;
    }
    journeyStep.value = 0;
    journeyPlaying.value = true;
    schedule();
  }

  section.addEventListener(
    'click',
    (event) => {
      if (!(event.target instanceof Element)) {
        return;
      }
      const button = event.target.closest('button');
      if (button?.hasAttribute('data-journey-run')) {
        if (journeyPlaying.value) {
          stop();
        } else {
          run();
        }
      }
      const scenario = button?.dataset.scenario;
      if (scenario === 'valid' || scenario === 'invalid') {
        journeyInvalid.value = scenario === 'invalid';
        run();
      }
    },
    options,
  );
  path.addEventListener(
    'tab-change',
    (event) => {
      if (event instanceof CustomEvent && typeof event.detail === 'number') {
        started = true;
        stop();
        journeyStep.value = event.detail;
      }
    },
    options,
  );
  section.addEventListener(
    'focusin',
    (event) => {
      if (event.target instanceof Element && event.target.closest('.journey-tabs')) {
        started = true;
        stop();
      }
    },
    options,
  );
  preference.addEventListener(
    'change',
    () => {
      if (preference.matches) {
        stop();
      }
    },
    options,
  );
  document.addEventListener('visibilitychange', schedule, options);
  const observer = new IntersectionObserver(
    (entries) => {
      visible = entries.some((entry) => entry.isIntersecting);
      if (visible && !started && !preference.matches) {
        run();
      } else {
        schedule();
      }
    },
    { rootMargin: '-15% 0px -15% 0px', threshold: 0 },
  );
  observer.observe(path);
  return () => {
    stop();
    lifetime.abort();
    observer.disconnect();
  };
}
