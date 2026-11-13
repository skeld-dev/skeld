// Does:  Renders an illustrative contract walkthrough with Light tabs.
// Holds: Example snippets are displayed as text and never evaluated.

import { html } from '@lightstart/light/html/core';
import { signal } from '@lightstart/light/signals';

const activeStep = signal(0);
const verticalTabs = signal(true);

function selectStep(event: CustomEvent<number>) {
  activeStep.value = event.detail;
}

export function contractWalkthrough() {
  return html`
    <section class="contract-section section-shell" id="contract" aria-labelledby="contract-title">
      <div class="section-intro">
        <div>
          <p class="section-label">
            <span class="mini-mark"></span>
            The framework
          </p>
          <h2 id="contract-title">
            One shape.
            <br />
            All the way through.
          </h2>
        </div>
        <p class="intro-copy">
          Your contract is the common language.
          <br />
          Let the same definition carry meaning from incoming data to the response you send.
        </p>
      </div>

      <div class="contract-lab">
        <div class="lab-top">
          <div class="lab-title">
            <span class="file-icon" aria-hidden="true">{ }</span>
            <span>A request, by contract</span>
          </div>
          <span class="concept-label">Contract walkthrough</span>
        </div>
        <lc-tabs
          id="contract-tabs"
          class="lab-body"
          .fullWidth=${true}
          ?vertical=${() => verticalTabs.value}
          @tab-change=${selectStep}
        >
          <button
            type="button"
            slot="tab"
            class="step"
            id="tab-define"
            aria-controls="panel-define"
            aria-selected="true"
            data-step="define"
          >
            <span class="step-number">01</span>
            <span>
              <strong>Define the boundary</strong>
              <small>Give your data a precise shape.</small>
            </span>
            <svg aria-hidden="true"><use href="#arrow"></use></svg>
          </button>
          <button
            type="button"
            slot="tab"
            class="step"
            id="tab-validate"
            aria-controls="panel-validate"
            aria-selected="false"
            tabindex="-1"
            data-step="validate"
          >
            <span class="step-number">02</span>
            <span>
              <strong>Check what comes in</strong>
              <small>Make invalid input explicit.</small>
            </span>
            <svg aria-hidden="true"><use href="#arrow"></use></svg>
          </button>
          <button
            type="button"
            slot="tab"
            class="step"
            id="tab-serialize"
            aria-controls="panel-serialize"
            aria-selected="false"
            tabindex="-1"
            data-step="serialize"
          >
            <span class="step-number">03</span>
            <span>
              <strong>Shape what goes out</strong>
              <small>Send the fields you intended.</small>
            </span>
            <svg aria-hidden="true"><use href="#arrow"></use></svg>
          </button>
          <div slot="panel" id="panel-define" aria-labelledby="tab-define" class="code-panel" tabindex="0">
            <div class="code-top">
              <span>user.contract.ts</span>
              <span>TypeScript</span>
            </div>
            <pre
              class="code"
            ><code><span class="line"><b aria-hidden="true">01</b><em>const</em> User = t.<span class="fn">object</span>({</span><span class="line"><b aria-hidden="true">02</b>  id: t.<span class="fn">string</span>({ maxLength: <span class="num">36</span> }),</span><span class="line"><b aria-hidden="true">03</b>  name: t.<span class="fn">string</span>({ maxLength: <span class="num">80</span> }),</span><span class="line"><b aria-hidden="true">04</b>  role: t.<span class="fn">literal</span>(<span class="str">'developer'</span>),</span><span class="line"><b aria-hidden="true">05</b>});</span><span class="line"><b aria-hidden="true">06</b></span><span class="line"><b aria-hidden="true">07</b><span class="comment">// The handler's type follows the contract.</span></span><span class="line"><b aria-hidden="true">08</b><em>type</em> User = t.<span class="type">Infer</span>&lt;<em>typeof</em> User&gt;;</span></code></pre>
            <div class="code-result">
              <svg aria-hidden="true"><use href="#check"></use></svg>
              <span>A single definition. A shared understanding.</span>
            </div>
          </div>
          <div slot="panel" id="panel-validate" aria-labelledby="tab-validate" class="code-panel" tabindex="0">
            <div class="code-top">
              <span>Incoming request</span>
              <span>application/json</span>
            </div>
            <pre
              class="code"
            ><code><span class="line"><b aria-hidden="true">01</b>{</span><span class="line"><b aria-hidden="true">02</b>  <span class="str">"id"</span>: <span class="str">"usr_01"</span>,</span><span class="line"><b aria-hidden="true">03</b>  <span class="str">"name"</span>: <span class="str">"Alex"</span>,</span><span class="line"><b aria-hidden="true">04</b>  <span class="str">"role"</span>: <span class="str">"developer"</span></span><span class="line"><b aria-hidden="true">05</b>}</span></code></pre>
            <div class="code-result">
              <svg aria-hidden="true"><use href="#check"></use></svg>
              <span>This example matches the declared schema.</span>
            </div>
          </div>
          <div slot="panel" id="panel-serialize" aria-labelledby="tab-serialize" class="code-panel" tabindex="0">
            <div class="code-top">
              <span>Outgoing response</span>
              <span>application/json</span>
            </div>
            <pre
              class="code"
            ><code><span class="line"><b aria-hidden="true">01</b>{</span><span class="line"><b aria-hidden="true">02</b>  <span class="str">"id"</span>: <span class="str">"usr_01"</span>,</span><span class="line"><b aria-hidden="true">03</b>  <span class="str">"name"</span>: <span class="str">"Alex"</span>,</span><span class="line"><b aria-hidden="true">04</b>  <span class="str">"role"</span>: <span class="str">"developer"</span></span><span class="line"><b aria-hidden="true">05</b>}</span><span class="line"><b aria-hidden="true">06</b></span><span class="line"><b aria-hidden="true">07</b><span class="comment">// The response follows the declared shape.</span></span></code></pre>
            <div class="code-result">
              <svg aria-hidden="true"><use href="#check"></use></svg>
              <span>Explicit output, down to the field.</span>
            </div>
          </div>
        </lc-tabs>
        <p class="lab-footnote">
          An illustrated request lifecycle, from declared schema to response.
        </p>
        <div class="flow-strip" aria-hidden="true">
          <span class=${() => (activeStep.value === 0 ? 'flow-node is-active' : 'flow-node')}>Contract</span>
          <span class="flow-track"></span>
          <span class=${() => (activeStep.value === 1 ? 'flow-node is-active' : 'flow-node')}>Validation</span>
          <span class="flow-track"></span>
          <span class=${() => (activeStep.value === 2 ? 'flow-node is-active' : 'flow-node')}>Serialization</span>
          <span class="flow-end">One foundation.</span>
        </div>
      </div>
      <div class="contract-caption">
        <span>Fewer places for intent to drift.</span>
        <span>From the first byte to the last.</span>
      </div>
    </section>
  `;
}

export function mountContractWalkthrough(): () => void {
  const lifetime = new AbortController();
  const narrow = matchMedia('(max-width: 760px)');
  const orient = () => {
    verticalTabs.value = !narrow.matches;
  };
  orient();
  narrow.addEventListener('change', orient, { signal: lifetime.signal });
  return () => lifetime.abort();
}
