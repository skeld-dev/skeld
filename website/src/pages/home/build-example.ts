// Does:  Shows a complete contract, server and client with native source downloads and local run instructions.
// Holds: Light owns file-tab behavior; all three files and instructions remain available without JavaScript.

import { html } from '@lightstart/light/html/core';
import { codeExample } from '../../components/code-example.ts';
import { firstRouteFiles } from './first-route-code.ts';

export function buildExample() {
  return html`
    <section class="build-section" id="build" aria-labelledby="build-title">
      <div class="section-shell">
        <div class="build-heading">
          <div>
            <p class="section-label"><img src="/assets/skeld-icon.png" alt="" width="1254" height="1254" />Build with skeld</p>
            <h2 id="build-title">Start with the contract.</h2>
          </div>
          <p>Declare your API, implement its handlers,<br />and call it through a client that checks the response.</p>
        </div>
        <lc-tabs id="first-route-files" class="build-files" data-tab-label="Example files" .fullWidth=${true}>
          ${firstRouteFiles.map(
            (file, index) => html`
            <button type="button" slot="tab" class="build-file-tab"><span aria-hidden="true">0${index + 1}</span>${file.name}</button>
          `,
          )}
          ${firstRouteFiles.map(
            (file) => html`
            <div slot="panel" class="build-file-panel">
              <div class="build-explanation">
                <div><p class="build-file-name">${file.name}</p><h3>${file.title}</h3><p>${file.description}</p></div>
                <p class="build-file-note">${file.note}</p>
              </div>
              <div class="build-editor">
                <div class="build-editor-bar"><span>TypeScript</span><a href=${`data:text/plain;charset=utf-8,${encodeURIComponent(file.source)}`} download=${file.name} aria-label=${`Save ${file.name}`}>Save file<svg aria-hidden="true"><use href="#arrow"></use></svg></a></div>
                <pre tabindex="0" aria-label=${`${file.name} source code`}><code>${codeExample(file.source)}</code></pre>
              </div>
            </div>
          `,
          )}
        </lc-tabs>
        <details class="build-run" id="run-example">
          <summary><span>Run this example locally</span><span class="build-run-context">With npm</span><svg aria-hidden="true"><use href="#arrow"></use></svg></summary>
          <div class="build-run-body">
            <p>Install Node.js 26.12 or later. In a new folder, run <code>npm init -y</code>, <code>npm pkg set type=module</code> and <code>npm install @skeld/core</code>. Save all three files in that folder.</p>
            <div class="build-terminals">
              <div><span>In that folder · terminal one</span><pre tabindex="0" aria-label="Start the example server"><code>node server.ts</code></pre></div>
              <div><span>In that folder · terminal two</span><pre tabindex="0" aria-label="Call the example server"><code>node client.ts</code></pre></div>
            </div>
            <p>The client prints <code>Hello, Ada!</code>. Stop the server with Ctrl-C. To use a port other than 3000, update it in both the server and client.</p>
          </div>
        </details>
      </div>
    </section>
  `;
}
