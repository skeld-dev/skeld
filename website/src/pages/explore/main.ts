// Does:  Plays catalog scenes and supports pointer dragging, search, replay and keyboard activation.
// Holds: No fetch, file import, external drop data, code evaluation or framework runtime.
import { configure, disposeTree, render } from '@lightstart/light/html';
import { effect } from '@lightstart/light/signals';
import { mountNavigation } from '../../components/site-header.ts';
import { examples, type Example } from './examples.ts';
import { activeExample, phase, ready, explorePage } from './page.ts';

const root = document.getElementById('app');
if (!root) {
  throw Error('Missing page root');
}
configure({ effect });
render(explorePage(), root, { adopt: true });
const cleanupNavigation = mountNavigation(root);
const lifetime = new AbortController();
const reduced = matchMedia('(prefers-reduced-motion: reduce)');
const timers: ReturnType<typeof setTimeout>[] = [];
const stop = () => {
  for (const timer of timers) {
    clearTimeout(timer);
  }
  timers.length = 0;
};
function play(example: Example) {
  stop();
  activeExample.value = example;
  phase.value = reduced.matches ? 4 : 1;
  if (matchMedia('(max-width: 900px)').matches) {
    const chooser = root?.querySelector<HTMLDetailsElement>('.scene-library-disclosure');
    if (chooser) {
      chooser.open = false;
    }
    const title = document.getElementById('scene-title');
    title?.focus({ preventScroll: true });
    document.getElementById('scenario-stage')?.scrollIntoView({ block: 'start', behavior: 'instant' });
  }
  if (reduced.matches) {
    return;
  }
  timers.push(
    setTimeout(() => {
      phase.value = 2;
    }, 650),
  );
  if (example.stopAt === 3) {
    timers.push(
      setTimeout(() => {
        phase.value = 3;
      }, 1350),
    );
  }
  timers.push(
    setTimeout(
      () => {
        phase.value = 4;
      },
      example.stopAt === 3 ? 2000 : 1400,
    ),
  );
}
reduced.addEventListener(
  'change',
  () => {
    if (reduced.matches && phase.value) {
      stop();
      phase.value = 4;
    }
  },
  { signal: lifetime.signal },
);
document.addEventListener(
  'visibilitychange',
  () => {
    if (document.hidden && phase.value) {
      stop();
      phase.value = 4;
    }
  },
  { signal: lifetime.signal },
);

const dropTarget = root.querySelector<HTMLElement>('[data-drop-target]');
if (!dropTarget) {
  throw Error('Missing request entrance');
}
const zone: HTMLElement = dropTarget;
let drag:
  | {
      pointer: number;
      button: HTMLButtonElement;
      example: Example;
      x: number;
      y: number;
      moved: boolean;
      ghost: HTMLElement | null;
    }
  | undefined;
let suppressClick = false;
let dragFrame = 0;
let pointerX = 0;
let pointerY = 0;
function scrollDrag() {
  if (!drag?.moved) {
    return;
  }
  const distance = pointerY > innerHeight - 72 ? 12 : pointerY < 100 ? -12 : 0;
  if (distance) {
    window.scrollBy({ top: distance, behavior: 'instant' });
  }
  zone.classList.toggle('is-over', inside(pointerX, pointerY));
  dragFrame = requestAnimationFrame(scrollDrag);
}
const inside = (x: number, y: number) => {
  const r = zone.getBoundingClientRect();
  return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
};
function clearDrag() {
  cancelAnimationFrame(dragFrame);
  if (!drag) {
    return;
  }
  drag.ghost?.remove();
  drag.button.classList.remove('is-dragging');
  if (drag.button.hasPointerCapture(drag.pointer)) {
    drag.button.releasePointerCapture(drag.pointer);
  }
  zone.classList.remove('is-over');
  drag = undefined;
}
for (const button of root.querySelectorAll<HTMLButtonElement>('[data-draggable]')) {
  const example = examples.find((item) => item.id === button.dataset.example);
  if (!example) {
    continue;
  }
  button.addEventListener(
    'pointerdown',
    (event) => {
      if (
        !event.isPrimary ||
        event.button !== 0 ||
        (event.pointerType === 'touch' &&
          !(event.target instanceof Element && event.target.closest('[data-drag-handle]')))
      ) {
        return;
      }
      clearDrag();
      suppressClick = false;
      drag = {
        pointer: event.pointerId,
        button,
        example,
        x: event.clientX,
        y: event.clientY,
        moved: false,
        ghost: null,
      };
      button.setPointerCapture(event.pointerId);
    },
    { signal: lifetime.signal },
  );
  button.addEventListener(
    'pointermove',
    (event) => {
      if (!drag || drag.pointer !== event.pointerId) {
        return;
      }
      if (!drag.moved && Math.hypot(event.clientX - drag.x, event.clientY - drag.y) < 8) {
        return;
      }
      drag.moved = true;
      pointerX = event.clientX;
      pointerY = event.clientY;
      suppressClick = true;
      if (!drag.ghost) {
        const ghost = document.createElement('div');
        ghost.className = 'scene-drag-preview';
        ghost.textContent = example.title;
        ghost.setAttribute('aria-hidden', 'true');
        document.body.append(ghost);
        drag.ghost = ghost;
        button.classList.add('is-dragging');
        dragFrame = requestAnimationFrame(scrollDrag);
      }
      drag.ghost.style.left = `${event.clientX}px`;
      drag.ghost.style.top = `${event.clientY}px`;
      zone.classList.toggle('is-over', inside(event.clientX, event.clientY));
    },
    { signal: lifetime.signal },
  );
  button.addEventListener(
    'pointerup',
    (event) => {
      if (!drag || drag.pointer !== event.pointerId) {
        return;
      }
      if (drag.moved && inside(event.clientX, event.clientY)) {
        play(drag.example);
      }
      clearDrag();
    },
    { signal: lifetime.signal },
  );
  button.addEventListener('pointercancel', clearDrag, { signal: lifetime.signal });
  button.addEventListener('lostpointercapture', clearDrag, { signal: lifetime.signal });
}
root.addEventListener(
  'click',
  (event) => {
    if (event.target instanceof Element && event.target.closest('[data-browse]')) {
      const chooser = root.querySelector<HTMLDetailsElement>('.scene-library-disclosure');
      if (chooser) {
        chooser.open = true;
        chooser.querySelector('summary')?.focus({ preventScroll: true });
        chooser.scrollIntoView({ block: 'start', behavior: 'instant' });
      }
      return;
    }
    const button = event.target instanceof Element ? event.target.closest<HTMLButtonElement>('[data-example]') : null;
    const example = examples.find((item) => item.id === button?.dataset.example);
    if (example && (!suppressClick || event.detail === 0)) {
      play(example);
    }
    suppressClick = false;
  },
  { signal: lifetime.signal },
);
root.addEventListener(
  'input',
  (event) => {
    if (!(event.target instanceof HTMLInputElement) || event.target.id !== 'scenario-search') {
      return;
    }
    const list = root.querySelector('.scene-library-list');
    if (list) {
      list.scrollTop = 0;
    }
    if (event.target.value.trim()) {
      for (const group of root.querySelectorAll<HTMLDetailsElement>('.scene-group')) {
        group.open = true;
      }
    }
  },
  { signal: lifetime.signal },
);
const narrow = matchMedia('(max-width: 900px)');
const disclosure = root.querySelector<HTMLDetailsElement>('.scene-library-disclosure');
const syncLibrary = () => {
  if (disclosure) {
    disclosure.open = !narrow.matches;
  }
};
syncLibrary();
narrow.addEventListener('change', syncLibrary, { signal: lifetime.signal });

document.addEventListener(
  'keydown',
  (event) => {
    if (event.key === 'Escape') {
      suppressClick = Boolean(drag?.moved);
      clearDrag();
    }
  },
  { signal: lifetime.signal },
);
window.addEventListener('blur', clearDrag, { signal: lifetime.signal });
ready.value = true;
document.documentElement.dataset.enhanced = 'true';
if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    stop();
    clearDrag();
    lifetime.abort();
    cleanupNavigation();
    disposeTree(root);
  });
}
