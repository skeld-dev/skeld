// Does:  Runs the hero's optional frost and pointer motion while the page is visible.
// Holds: Reduced motion wins over preferences, and teardown stops every observer and frame.

import { html } from '@lightstart/light/html/core';
import { effect, signal } from '@lightstart/light/signals';

const motion = signal(false);
const reduced = signal(false);

interface Particle {
  x: number;
  y: number;
  readonly radius: number;
  readonly opacity: number;
  readonly speed: number;
}

function rememberMotion(): void {
  try {
    sessionStorage.setItem('skeld-motion', motion.value ? 'on' : 'off');
  } catch (error) {
    if (!(error instanceof DOMException) || !['SecurityError', 'QuotaExceededError'].includes(error.name)) {
      throw error;
    }
  }
}

function savedMotion(): boolean {
  try {
    return sessionStorage.getItem('skeld-motion') !== 'off';
  } catch (error) {
    if (!(error instanceof DOMException) || error.name !== 'SecurityError') {
      throw error;
    }
    return true;
  }
}

function toggleMotion(): void {
  if (!reduced.value) {
    motion.value = !motion.value;
    rememberMotion();
  }
}

export function motionToggle() {
  return html`
    <button
      type="button"
      class="motion-toggle"
      aria-pressed=${() => String(motion.value)}
      aria-disabled=${() => String(reduced.value)}
      @click=${toggleMotion}
    >
      <span class="motion-icon" aria-hidden="true">
        <i></i>
        <i></i>
        <i></i>
      </span>
      <span>${() => (reduced.value ? 'Reduced motion' : motion.value ? 'Motion on' : 'Motion off')}</span>
    </button>
  `;
}

export function mountHeroMotion(root: HTMLElement): () => void {
  const hero = root.querySelector<HTMLElement>('.hero');
  const art = root.querySelector<HTMLElement>('.hero-art');
  const canvas = root.querySelector<HTMLCanvasElement>('#frost');
  if (hero === null || art === null || canvas === null) {
    throw new Error('Hero motion requires its hero, image and canvas');
  }
  const context = canvas.getContext('2d');
  const preference = matchMedia('(prefers-reduced-motion: reduce)');
  const lifetime = new AbortController();
  const options = { signal: lifetime.signal };
  const frostColor = getComputedStyle(hero).getPropertyValue('--color-frost').trim();
  let width = 0;
  let height = 0;
  let frame = 0;
  let visible = true;
  let lastTime = 0;
  let pointerX = 0;
  let pointerY = 0;
  let artX = 0;
  let artY = 0;
  let particles: Particle[] = [];

  function sizeCanvas(): void {
    if (hero === null || canvas === null) {
      return;
    }
    width = hero.clientWidth;
    height = hero.clientHeight;
    const ratio = Math.min(devicePixelRatio, 1.5);
    canvas.width = width * ratio;
    canvas.height = height * ratio;
    context?.setTransform(ratio, 0, 0, ratio, 0, 0);
    particles = Array.from({ length: Math.min(50, Math.round(width / 24)) }, () => ({
      x: Math.random() * width,
      y: Math.random() * height,
      radius: 0.35 + Math.random() * 1.2,
      opacity: 0.12 + Math.random() * 0.38,
      speed: 0.1 + Math.random() * 0.22,
    }));
  }

  function draw(time: number): void {
    frame = 0;
    if (!motion.value || !visible || document.hidden || context === null || art === null) {
      return;
    }
    const delta = Math.min((time - lastTime) / 16.67, 3);
    lastTime = time;
    context.clearRect(0, 0, width, height);
    context.fillStyle = frostColor;
    for (const particle of particles) {
      particle.x += particle.speed * delta;
      particle.y -= particle.speed * 0.45 * delta;
      if (particle.x > width + 3) {
        particle.x = -3;
      }
      if (particle.y < -3) {
        particle.y = height + 3;
      }
      context.globalAlpha = particle.opacity;
      context.beginPath();
      context.arc(particle.x, particle.y, particle.radius, 0, Math.PI * 2);
      context.fill();
    }
    artX += (pointerX - artX) * 0.025;
    artY += (pointerY - artY) * 0.025;
    art.style.transform = `translate3d(${artX}px,${artY}px,0)`;
    frame = requestAnimationFrame(draw);
  }

  function update(): void {
    cancelAnimationFrame(frame);
    frame = 0;
    if (canvas === null || art === null) {
      return;
    }
    canvas.style.opacity = motion.value ? '0.55' : '0';
    if (motion.value && visible && !document.hidden) {
      lastTime = performance.now();
      frame = requestAnimationFrame(draw);
    } else {
      art.style.transform = 'none';
    }
  }

  reduced.value = preference.matches;
  motion.value = !reduced.value && savedMotion();
  preference.addEventListener(
    'change',
    () => {
      reduced.value = preference.matches;
      motion.value = !reduced.value && savedMotion();
    },
    options,
  );
  hero.addEventListener(
    'pointermove',
    (event) => {
      if (event.pointerType !== 'mouse') {
        return;
      }
      const bounds = hero.getBoundingClientRect();
      pointerX = ((event.clientX - bounds.left) / width - 0.5) * -10;
      pointerY = ((event.clientY - bounds.top) / height - 0.5) * -7;
    },
    { ...options, passive: true },
  );
  hero.addEventListener(
    'pointerleave',
    () => {
      pointerX = 0;
      pointerY = 0;
    },
    options,
  );
  document.addEventListener('visibilitychange', update, options);
  const intersection = new IntersectionObserver((entries) => {
    visible = entries.some((entry) => entry.isIntersecting);
    update();
  });
  intersection.observe(hero);
  const resize = new ResizeObserver(sizeCanvas);
  resize.observe(hero);
  sizeCanvas();
  const changes = effect(update);
  return () => {
    changes.dispose();
    lifetime.abort();
    intersection.disconnect();
    resize.disconnect();
    cancelAnimationFrame(frame);
  };
}
