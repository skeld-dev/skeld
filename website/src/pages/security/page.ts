// Does:  Explains core security boundaries and links to the source-backed STRIDE model.
// Holds: Framework controls remain distinct from application identity, authorization and deployment duties.

import { html, unsafeHTML } from '@lightstart/light/html/core';
import { renderToString } from '@lightstart/light/markup';
import { siteFooter } from '../../components/site-footer.ts';
import { siteHeader } from '../../components/site-header.ts';
import { symbols } from '../../components/symbols.ts';

const model = '/docs/concepts/threat-model/';
const threats = [
  [
    'S',
    'Spoofing',
    'Who is making the request?',
    'Forwarded addresses and correlation IDs have explicit trust rules. Your application authenticates the caller.',
  ],
  [
    'T',
    'Tampering',
    'Can input change what the service does?',
    'Framing checks, declared schemas and browser mutation policies cover different paths into the application.',
  ],
  [
    'R',
    'Repudiation',
    'What evidence survives an operation?',
    'Request IDs and loss counters help explain operational records. Durable business audit trails need separate storage and policy.',
  ],
  [
    'I',
    'Information disclosure',
    'Where could sensitive data escape?',
    'Response projection and classified logging restrict what leaves each boundary. Raw replies and explicit exposure need review.',
  ],
  [
    'D',
    'Denial of service',
    'What can exhaust the service?',
    'Per-request limits and bounded log queues constrain resource use. Deployment-wide capacity and downstream deadlines remain your responsibility.',
  ],
  [
    'E',
    'Elevation of privilege',
    'Can a valid request gain unwanted access?',
    'A valid identifier does not grant access to a resource. Check permissions, tenant ownership and writable fields in the application.',
  ],
];

export function securityPage() {
  // Why: Only the shared header is adopted in the browser; the article remains static HTML.
  const header = renderToString(siteHeader('security'));
  return html`
    <a class="skip" href="#main">Skip to content</a>${symbols()}
    <div id="security-site-header">${unsafeHTML(header)}</div>
    <main class="security-page" id="main" tabindex="-1">
      <header class="security-heading section-shell">
        <p class="section-label"><img src="/assets/skeld-icon.png" alt="" width="1254" height="1254" />Security</p>
        <h1>Know where the<br /><span>boundaries are.</span></h1>
        <div class="security-intro"><p>Skeld checks incoming data, constrains declared responses and masks classified log fields. Our threat model follows those boundaries through the code, including the places where your application takes over.</p><a class="button primary" href=${model}>Read the threat model<svg aria-hidden="true"><use href="#arrow"></use></svg></a></div>
      </header>
      <section class="security-boundaries section-shell" aria-labelledby="boundary-heading">
        <div class="security-section-heading"><h2 id="boundary-heading">A request crosses more<br />than one boundary.</h2><p>Validation, authorization and disclosure answer different questions. Each needs an explicit decision.</p></div>
        <ol class="security-flow">
          <li><p class="security-owner">Core · Input</p><h3>Is this data allowed in?</h3><p>Declared schemas check shape and bounds before the normal handler runs.</p><span class="security-flow-note">Early hooks see unvalidated input.</span></li>
          <li><p class="security-owner">Application · Authority</p><h3>May this caller do this?</h3><p>Your code checks identity, resource access and tenant ownership before acting.</p><span class="security-flow-note">A schema cannot grant permission.</span></li>
          <li><p class="security-owner">Core · Output</p><h3>What may leave?</h3><p>Declared responses project fields. Classified log fields follow their own disclosure rules.</p><span class="security-flow-note">Raw replies bypass response projection.</span></li>
        </ol>
        <p><a class="text-link" href="/explore/">See which requests reach the handler →</a></p>
        <p class="security-flow-caption">These are policy boundaries within one process. Application code and plugins share its privileges.</p>
      </section>
      <section class="security-controls section-shell" aria-labelledby="controls-heading">
        <div class="security-section-heading"><h2 id="controls-heading">Controls with<br />a defined scope.</h2><p>Follow each protection to its configuration, behavior and limits.</p></div>
        <div class="security-control-list">
          <article><h3>Declare what can leave.</h3><p>Ordinary object responses include declared fields. A secret response field needs explicit exposure. A personal field still needs an application decision about who may receive it.</p><a class="text-link" href="/docs/guides/classification/">Data classification <svg aria-hidden="true"><use href="#arrow"></use></svg></a></article>
          <article><h3>Carry classification into logs.</h3><p>Classified logger fields mask secret and personal values and omit undeclared object fields. Raw messages and scalar fields are not automatically classified. The standalone redactor has different behavior.</p><a class="text-link" href="/docs/logging/logging/">Logging and disclosure <svg aria-hidden="true"><use href="#arrow"></use></svg></a></article>
          <article><h3>Put limits on work.</h3><p>Body limits, JSON depth checks and bounded log queues constrain specific resources. Request deadlines cover asynchronous waits; they cannot interrupt synchronous JavaScript or undo side effects.</p><a class="text-link" href="/docs/concepts/request-lifecycle/">Request lifetime <svg aria-hidden="true"><use href="#arrow"></use></svg></a></article>
          <article><h3>Make browser policy explicit.</h3><p>Cookie rules, configured CORS grants, cross-site mutation checks and redirect restrictions each cover a different risk. None establishes a caller's identity.</p><a class="text-link" href="/docs/guides/browser-security/">Browser security <svg aria-hidden="true"><use href="#arrow"></use></svg></a></article>
        </div>
      </section>
      <section class="security-stride section-shell" aria-labelledby="stride-heading">
        <div class="security-section-heading"><div><p class="section-label"><img src="/assets/skeld-icon.png" alt="" width="1254" height="1254" />The threat model</p><h2 id="stride-heading">Six questions.<br />Specific attack paths.</h2></div><p>We apply STRIDE to actors, processes, stores and data flows. The model maps 25 threats to assets, trust boundaries, controls, residual risks and source evidence.</p></div>
        <dl class="security-threats">${threats.map(
          ([letter, name, question, detail]) => html`
          <div><dt><span aria-hidden="true">${letter}</span><strong>${name}</strong></dt><dd><h3>${question}</h3><p>${detail}</p></dd></div>
        `,
        )}</dl>
        <a class="text-link" href=${`${model}#threat-register`}>Read the threat register<svg aria-hidden="true"><use href="#arrow"></use></svg></a>
      </section>
      <section class="security-responsibility section-shell" aria-labelledby="responsibility-heading">
        <div class="security-section-heading"><h2 id="responsibility-heading">Your service has<br />its own threat model.</h2><div><p>Core is complete. The authentication module is next. Today, your application supplies authentication, sessions, authorization and tenant isolation.</p><p>Your deployment owns TLS, proxy trust, aggregate traffic limits, dependency access and log retention. Model those choices against the data and operations your service exposes.</p></div></div>
        <div class="security-evidence"><div><p class="security-owner">Review record · November 13, 2026</p><h3>Source review and regression evidence.</h3><p>The core correctness suite passed 49 of 49 scripts. The package check confirmed exclusion of the development recorder. These checks do not establish deployment security or an independent audit.</p></div><a class="text-link" href=${`${model}#implementation-and-verification-evidence`}>Evidence and review limits<svg aria-hidden="true"><use href="#arrow"></use></svg></a></div>
      </section>
    </main>${siteFooter()}
  `;
}
