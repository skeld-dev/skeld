// Does:  Runs the finite hero illustration and the repeating visible scroll cue.
// Holds: Motion pauses while hidden and follows the system reduced-motion preference.

export function mountHeroMotion(root: HTMLElement): () => void {
  const hero = root.querySelector<HTMLElement>('.hero');
  const cue = root.querySelector<HTMLElement>('.scroll-cue');
  if (hero === null || cue === null) {
    throw new Error('Hero motion requires its hero section and scroll cue');
  }
  const preference = matchMedia('(prefers-reduced-motion: reduce)');
  const lifetime = new AbortController();
  const options = { signal: lifetime.signal };
  let visible = true;
  let cueVisible = false;

  function update(): void {
    if (hero !== null) {
      hero.dataset.motion = preference.matches ? 'off' : 'on';
      hero.dataset.motionPaused = String(!visible || document.hidden);
      hero.dataset.cueMotionPaused = String(!cueVisible || document.hidden);
    }
  }

  preference.addEventListener('change', update, options);
  document.addEventListener('visibilitychange', update, options);
  const intersection = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (entry.target === hero) {
        visible = entry.isIntersecting;
      }
      if (entry.target === cue) {
        cueVisible = entry.isIntersecting;
      }
    }
    update();
  });
  intersection.observe(hero);
  intersection.observe(cue);
  update();
  return () => {
    lifetime.abort();
    intersection.disconnect();
    delete hero.dataset.motion;
    delete hero.dataset.motionPaused;
    delete hero.dataset.cueMotionPaused;
  };
}
