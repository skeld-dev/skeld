// Does:  Renders the terms page with its own content and the shared policy layout.
// Holds: Policy wording describes the website and identifies its maintainer.

import { html } from '@lightstart/light/html/core';
import { policyPage } from '../../components/policy-page.ts';

export function termsPage() {
  return policyPage(
    'terms',
    'Website terms',
    html`
    <p>These terms cover the skeld website, maintained by <a href="https://github.com/ul0gic">ul0gic</a>. The website provides information, documentation and examples for the skeld framework.</p>
    <section><h2>The software license</h2><p>skeld software is provided under the <a href="/license.txt">MIT license</a>. That license governs use, modification and distribution of the software, including its warranty and liability provisions. These website terms do not replace it.</p></section>
    <section><h2>Documentation and examples</h2><p>Documentation describes the version or source checkout it accompanies. APIs and installation instructions can change between releases. Review examples and configure your application for its own requirements before using them.</p></section>
    <section><h2>Using this website</h2><p>Do not interfere with the website's operation, attempt to gain unauthorized access to its hosting systems, or use it to distribute harmful content.</p></section>
    <section><h2>Third-party materials and links</h2><p>Third-party fonts and software retain their own license notices. External websites, including GitHub and Lightstart, have their own terms. Linking to a service does not make it part of skeld.</p></section>
    <section><h2>Updates</h2><p>The website and these terms may change as the project develops. The date above identifies the current version of this page.</p></section>
  `,
  );
}
