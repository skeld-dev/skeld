// Does:  Illustrates one contract governing input, handler values, response fields and logging.
// Holds: Every stage is readable without JavaScript; examples describe core behavior without executing it.

import { html } from '@lightstart/light/html/core';
import {
  journeyInvalid,
  journeyPlaying,
  journeyStep,
  longProjectName,
  projectName,
  projectNameLimit,
} from './request-journey.ts';

const stages = ['Request', 'Validation', 'Handler', 'Response'];
const name = () => (journeyInvalid.value ? longProjectName : projectName);

function requestPanel() {
  return html`
    <div class="journey-panel" slot="panel" tabindex="0">
      <div class="journey-panel-heading"><span>01 / Incoming JSON</span><span>POST /projects</span></div>
      <h3>Start with the data.</h3>
      <p>A project name and an API key arrive together. The contract declares a limit for each field.</p>
      <div class="journey-payload">
        <div class=${() => (journeyInvalid.value ? 'payload-field is-over-limit' : 'payload-field')}>
          <span class="payload-key">name</span><code>${name}</code>
          <span class="payload-note">${() => name().length} characters</span>
        </div>
        <div class="payload-field"><span class="payload-key">apiKey</span><code>sk_demo_7x2</code><span class="payload-note">example value</span></div>
      </div>
      <div class="journey-stage-note"><span class="journey-note-mark">→</span><span>The request has arrived. The handler has not run.</span></div>
    </div>
  `;
}

function validationPanel() {
  return html`
    <div class="journey-panel" slot="panel" tabindex="0">
      <div class="journey-panel-heading"><span>02 / Input validation</span><span>${() => (journeyInvalid.value ? '400 · VALIDATION' : 'Checks passed')}</span></div>
      <h3>${() => (journeyInvalid.value ? 'The limit holds.' : 'Check before the handler.')}</h3>
      <p>${() =>
        journeyInvalid.value
          ? 'The name exceeds its declared limit. Skeld returns a validation error without calling the route handler.'
          : 'Skeld checks field types and bounds. A valid secret field becomes a Secret<string> before the handler receives it.'}</p>
      <div class=${() => (journeyInvalid.value ? 'journey-limit is-over-limit' : 'journey-limit')}>
        <div class="limit-label"><code>name.length</code><span><strong>${() => name().length}</strong> / ${projectNameLimit} max</span></div>
        <div class="limit-meter" aria-hidden="true"><span></span><i></i></div>
        <div class="limit-scale"><span>0</span><span>maxLength: 24</span></div>
      </div>
      <div class="journey-stage-note"><span class="journey-note-mark">${() => (journeyInvalid.value ? '×' : '✓')}</span><span>${() => (journeyInvalid.value ? 'Handler not called. No project created.' : 'name: string · apiKey: Secret<string>')}</span></div>
    </div>
  `;
}

function handlerPanel() {
  return html`
    <div class="journey-panel" slot="panel" tabindex="0">
      <div class="journey-panel-heading"><span>03 / Your handler</span><span>${() => (journeyInvalid.value ? 'Not reached' : 'Typed input')}</span></div>
      <h3>${() => (journeyInvalid.value ? 'Stopped before your code.' : 'Your code gets typed data.')}</h3>
      <p>${() => (journeyInvalid.value ? 'This request failed input validation. The handler and its log call do not run.' : 'The name is a string. The API key is wrapped as a secret. Your handler constructs a project and logs the classified input.')}</p>
      <pre class="journey-handler-code" ?hidden=${() => journeyInvalid.value}><code><span class="syntax-keyword">const</span> project = {
  <span class="syntax-property">name</span>: request.body.name, <span class="syntax-property">internalId</span>: <span class="syntax-string">'prj_01'</span>
};
request.log.<span class="syntax-function">info</span>(<span class="syntax-string">'project created'</span>, {
  <span class="syntax-property">input</span>: request.<span class="syntax-function">classified</span>(<span class="syntax-string">'body'</span>)
});
<span class="syntax-keyword">return</span> { <span class="syntax-property">status</span>: <span class="syntax-number">201</span>, <span class="syntax-property">body</span>: project };</code></pre>
      <div class="journey-stopped" ?hidden=${() => !journeyInvalid.value}><span>×</span><code>name.length &gt; 24</code><p>The request ends at validation.</p></div>
    </div>
  `;
}

function responsePanel() {
  return html`
    <div class="journey-panel" slot="panel" tabindex="0">
      <div class="journey-panel-heading"><span>04 / Response serialization</span><span>${() => (journeyInvalid.value ? 'Not reached' : '201 · Created')}</span></div>
      <h3>${() => (journeyInvalid.value ? 'No success response.' : 'Only declared fields leave.')}</h3>
      <p>${() => (journeyInvalid.value ? 'Skeld returns a 400 validation error instead. This handler never reaches response serialization.' : 'Skeld checks the declared response values while serializing. The internal ID is absent from this response schema, so it is omitted.')}</p>
      <div class="journey-projection" ?hidden=${() => journeyInvalid.value}>
        <div class="projection-source"><span class="payload-key">Handler result</span><code>name: <span class="syntax-string">'polar'</span></code><code class="projection-omitted">internalId: 'prj_01'</code><span class="projection-caption">Not in the response schema</span></div>
        <span class="projection-arrow" aria-hidden="true">→</span>
        <div class="projection-output"><span class="payload-key">On the wire</span><code>{ "name": "polar" }</code><span class="projection-caption">application/json</span></div>
      </div>
      <div class="journey-stopped" ?hidden=${() => !journeyInvalid.value}><span>×</span><code>400 · VALIDATION</code><p>No project created.</p></div>
    </div>
  `;
}

export function contractWalkthrough() {
  return html`
    <section class="request-journey" id="contract" aria-labelledby="contract-title">
      <div class="section-shell journey-shell">
        <div class="journey-intro">
          <div><p class="section-label"><img src="/assets/skeld-icon.png" alt="" width="1254" height="1254" />From input to output</p><h2 id="contract-title">Follow a request.</h2></div>
          <p>See what reaches your handler.<br />And what leaves it.</p>
        </div>
        <div class="journey-canvas" data-step=${() => journeyStep.value} data-invalid=${() => String(journeyInvalid.value)} data-playing=${() => String(journeyPlaying.value)}>
          <div class="journey-toolbar">
            <div class="journey-endpoint"><span>POST</span><code>/projects</code><span class="journey-example-label">Illustrated example</span></div>
            <div class="journey-scenarios" role="group" aria-label="Request example">
              <button type="button" data-scenario="valid" aria-pressed=${() => String(!journeyInvalid.value)}>Valid request</button>
              <button type="button" data-scenario="invalid" aria-pressed=${() => String(journeyInvalid.value)}>Exceed a limit <span aria-hidden="true">↗</span></button>
            </div>
          </div>
          <div class="journey-workspace">
            <aside class="journey-contract" aria-label="Contract excerpt">
              <div class="journey-file"><span class="journey-file-icon" aria-hidden="true">{ }</span><span>projects.contract.ts</span></div>
              <div class="journey-contract-intro"><strong>The contract stays here.</strong><p>Its rules follow the data.</p></div>
              <pre class="journey-schema" tabindex="0" aria-label="Request and response schema excerpt"><code><span class="syntax-comment">// Request body</span>
<span class="syntax-property">body</span>: t.<span class="syntax-function">object</span>({
  <span class="syntax-property">name</span>: t.<span class="syntax-function">string</span>({ <span class="schema-bound"><span class="syntax-property">maxLength</span>: <span class="syntax-number">24</span></span> }),
  <span class="syntax-property">apiKey</span>: t.<span class="syntax-function">string</span>({
    <span class="syntax-property">maxLength</span>: <span class="syntax-number">128</span>,
<span class="schema-secret">    <span class="syntax-property">sensitivity</span>: <span class="syntax-string">'secret'</span></span>
  })
}),

<span class="syntax-comment">// Successful response</span>
<span class="syntax-property">responses</span>: {
  <span class="syntax-number">201</span>: t.<span class="syntax-function">object</span>({
<span class="schema-response">    <span class="syntax-property">name</span>: t.<span class="syntax-function">string</span>({ <span class="syntax-property">maxLength</span>: <span class="syntax-number">24</span> })</span>
  })
}</code></pre>
              <p class="journey-contract-foot">One route declaration. Input, output and classification.</p>
            </aside>
            <div class="journey-runtime">
              <lc-tabs id="request-stages" class="journey-tabs" .fullWidth=${true} active-tab=${() => journeyStep.value}>
                ${stages.map(
                  (stage, index) => html`
                  <button type="button" slot="tab" class="journey-stage" data-index=${index}>
                    <span class="journey-stage-dot" aria-hidden="true">${index + 1}</span>
                    <span>${stage}</span>
                    <small>${() => (journeyInvalid.value && index > 1 ? 'Not reached' : index === 0 ? 'JSON arrives' : index === 1 ? 'Check bounds' : index === 2 ? 'Run your code' : 'Shape output')}</small>
                  </button>
                `,
                )}
                ${requestPanel()} ${validationPanel()} ${handlerPanel()} ${responsePanel()}
              </lc-tabs>
              <div class="journey-log" data-reached=${() => String(!journeyInvalid.value && journeyStep.value >= 2)}>
                <div class="journey-log-heading"><span class="journey-log-dot" aria-hidden="true"></span><strong>Schema-aware logging</strong><span>${() => (journeyInvalid.value ? 'Handler not reached' : journeyStep.value >= 2 ? 'From the handler' : 'Waiting for the handler')}</span></div>
                <div class="journey-log-output">
                  <div class="journey-log-record"><code>input: { name: <span>'polar'</span>, apiKey: <b>'[secret]'</b> }</code><span class="journey-log-seal" aria-hidden="true">✓</span></div>
                  <p class="journey-log-pending">${() => (journeyInvalid.value ? 'No handler log was written.' : 'The log call has not run yet.')}</p>
                </div>
                <p>The handler passes <code>request.classified('body')</code>. The logger masks the secret field.</p>
              </div>
            </div>
          </div>
          <div class="journey-footer">
            <p class="journey-outcome" role="status" aria-live="polite">${() => (journeyInvalid.value && journeyStep.value >= 1 ? '400 · Rejected before the handler' : journeyStep.value === 3 ? '201 · Declared fields sent. Secret masked in the log.' : journeyPlaying.value ? 'Following the request…' : 'Select a stage to inspect the data.')}</p>
            <button type="button" class="journey-run" data-journey-run><span aria-hidden="true">${() => (journeyPlaying.value ? 'Ⅱ' : '→')}</span>${() => (journeyPlaying.value ? 'Pause' : 'Run request')}</button>
          </div>
        </div>
        <div class="journey-caption"><span>Input limits. Typed handlers. Declared responses.</span><span>Explore each boundary above.</span></div>
      </div>
    </section>
  `;
}
