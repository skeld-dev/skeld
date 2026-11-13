// Does: Renders a searchable library and one focused, source-backed illustrated scene.
// Holds: All scenario content is static data; native controls also work without dragging.
import { html } from '@lightstart/light/html/core';
import { signal } from '@lightstart/light/signals';
import { siteHeader } from '../../components/site-header.ts';
import { siteFooter } from '../../components/site-footer.ts';
import { symbols } from '../../components/symbols.ts';
import { examples, groups, type Example } from './examples.ts';

export const activeExample = signal<Example>(
  examples[0] ??
    (() => {
      throw Error('Scenario library is empty');
    })(),
);
export const phase = signal(0);
export const ready = signal(false);
const query = signal('');
const finished = () => phase.value === 4;
const matches = (example: Example) =>
  `${example.title} ${example.note} ${example.group}`.toLowerCase().includes(query.value.trim().toLowerCase());
const count = () => examples.filter(matches).length;
const stageState = (index: number) => {
  if (!phase.value || phase.value < index) {
    return 'waiting';
  }
  if (index > activeExample.value.stopAt) {
    return 'skipped';
  }
  if (finished() && index === activeExample.value.stopAt && index < 3) {
    return 'stopped';
  }
  return phase.value === index ? 'active' : 'passed';
};
const announcement = () =>
  !phase.value
    ? 'Ready when you are.'
    : !finished()
      ? `Following “${activeExample.value.title}”…`
      : activeExample.value.outcome;

function library() {
  return html`<aside class="scene-library" aria-label="Scenario library"><details class="scene-library-disclosure" open><summary class="scene-library-toggle">Explore scenarios <span>${examples.length} examples</span></summary><div class="scene-library-content">
    <div class="scene-library-heading"><h2>Scenario library</h2><span>${examples.length}</span></div>
    <p class="scene-library-help" id="scene-instructions">Drag by the grip into the scene.<br />Or click / press Enter to play.</p>
    <div class="scene-search"><label for="scenario-search">Find a scenario</label><div><input id="scenario-search" type="search" placeholder="Try “secret” or “response”" autocomplete="off" ?disabled=${() => !ready.value} @input=${(
      event: Event,
    ) => {
      if (event.target instanceof HTMLInputElement) {
        query.value = event.target.value;
      }
    }} /><button type="button" aria-label="Clear scenario search" ?hidden=${() => !query.value} @click=${() => {
      query.value = '';
      const input = document.getElementById('scenario-search');
      if (input instanceof HTMLInputElement) {
        input.value = '';
        input.focus();
      }
    }}>×</button></div></div>
    <p class="scene-library-count" role="status" aria-live="polite">${() => `${count()} of ${examples.length} scenarios`}</p>
    <div class="scene-library-list">${groups.map((group) => html`<details class="scene-group" ?open=${group === 'Requests'} ?hidden=${() => !examples.some((example) => example.group === group && matches(example))}><summary>${group}<span>${examples.filter((example) => example.group === group).length}</span></summary><div>${examples.filter((example) => example.group === group).map((example) => html`<button type="button" class="scene-card" data-draggable data-example=${example.id} ?hidden=${() => !matches(example)} ?disabled=${() => !ready.value} aria-pressed=${() => String(activeExample.value.id === example.id)} aria-describedby="scene-instructions"><span class="scene-card-title">${example.title}<span aria-hidden="true" data-drag-handle>⠿</span></span><span class="scene-card-note">${example.note}</span></button>`)}</div></details>`)}
    <p class="scene-no-results" ?hidden=${() => count() > 0}>No matching scenarios. Try a shorter phrase or clear the search.</p></div>
  </div></details></aside>`;
}
function scene() {
  return html`<section class="scene" id="scenario-stage" aria-labelledby="scene-title" data-phase=${() => phase.value} data-stop=${() => activeExample.value.stopAt} data-tone=${() => activeExample.value.tone}>
    <div class="scene-toolbar"><span>${() => activeExample.value.group}</span><button type="button" class="scene-replay" data-example=${() => activeExample.value.id} ?disabled=${() => !ready.value}>${() => (phase.value ? 'Replay scenario ↻' : 'Play scenario →')}</button></div>
    <div class="scene-intro"><h2 id="scene-title" tabindex="-1">${() => activeExample.value.question}</h2><p>${() => activeExample.value.note}</p></div>
    <div class="scene-drop" data-drop-target><span aria-hidden="true">↓</span><strong>Drop a scenario here</strong><span>or choose one from the library</span></div>
    <div class="scene-path" aria-label="Illustrated sequence"><div class="scene-track" aria-hidden="true"><span class="scene-packet">{ }</span></div>${[0, 1, 2].map((index) => html`<div class="scene-stage" data-state=${() => stageState(index + 1)}><span class="scene-step">${`0${index + 1}`}<span>${() => (stageState(index + 1) === 'skipped' ? 'Not reached' : stageState(index + 1) === 'stopped' ? 'Stopped here' : stageState(index + 1) === 'passed' ? 'Reached' : stageState(index + 1) === 'active' ? 'Following' : 'Waiting')}</span></span><h3>${() => activeExample.value.stages[index]?.title}</h3><code>${() => activeExample.value.stages[index]?.code}</code><p>${() => activeExample.value.stages[index]?.detail}</p></div>`)}</div>
    <div class="scene-result" data-complete=${finished}>
      <div><p class="scene-eyebrow">${() => (finished() ? 'What happened' : 'The scenario')}</p><h3 id="scene-outcome" role="status" aria-live="polite" aria-atomic="true">${announcement}</h3><p>${() => (finished() ? activeExample.value.reason : activeExample.value.context)}</p></div>
      <div class="scene-result-code"><span>${() => (finished() ? activeExample.value.outputLabel : activeExample.value.inputLabel)}</span><pre><code>${() => (finished() ? activeExample.value.output : activeExample.value.input)}</code></pre><small>${() => (finished() ? activeExample.value.outputNote : 'Prepared example · play to follow the outcome')}</small></div>
    </div>
    <div class="scene-detail"><details><summary>Why this happens · code & limits</summary>${() => html`<div class="scene-detail-grid"><div><h3>Why this happens</h3><p>${activeExample.value.why}</p><h3>What this does not guarantee</h3><p>${activeExample.value.limit}</p><a class="text-link" href=${activeExample.value.docs}>Read the documentation →</a></div><div class="scene-contract"><span>Relevant code excerpt</span><pre><code>${activeExample.value.code}</code></pre></div></div>`}</details></div>
    <div class="scene-compare"><span>Explore the difference</span><button type="button" data-example=${() => activeExample.value.compare} ?disabled=${() => !ready.value}>${() => examples.find((example) => example.id === activeExample.value.compare)?.title} →</button></div>
    <button type="button" class="scene-browse" data-browse>Choose another scenario ↑</button>
    <p class="scene-footnote">Illustrated examples, checked against Skeld’s documented behavior. Nothing is sent to a server. Motion shows sequence, not execution time.</p>
  </section>`;
}
export function explorePage() {
  return html`<a class="skip" href="#main">Skip to content</a>${symbols()}${siteHeader('explore')}
  <main id="main" class="scenario-page section-shell" tabindex="-1"><header class="scene-heading"><div><p class="section-label"><img src="/assets/skeld-icon.png" alt="" width="1254" height="1254" />Skeld in practice</p><h1>See what happens<br /><span>at the boundary.</span></h1></div><p>Choose a scenario. Follow the data.<br />See what Skeld allows, rejects or leaves to you.</p></header>
  <noscript><p class="scene-nojs">Enable JavaScript to play the scenes, or open “Read every scenario” below for their outcomes and limits.</p></noscript>
  <div class="scenario-workspace">${library()}${scene()}</div>
  <details class="scene-reference"><summary>Read every scenario · ${examples.length} examples</summary><div>${groups.map((group) => html`<section><h2>${group}</h2>${examples.filter((example) => example.group === group).map((example) => html`<article><h3>${example.title}</h3><p><strong>${example.outcome}</strong> ${example.reason}</p><p>${example.limit}</p><a class="text-link" href=${example.docs}>Documentation →</a></article>`)}</section>`)}</div></details>
  </main>${siteFooter()}`;
}
