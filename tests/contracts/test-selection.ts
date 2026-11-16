// Does:  Checks that routine selection excludes service and tooling groups and full selection loses no script.
// Holds: Unknown selections and duplicate membership cannot quietly reduce coverage.

import assert from 'node:assert/strict';
import { allScripts, selectScripts, suites } from '../support/suites.ts';

assert.equal(new Set(allScripts).size, allScripts.length);
assert.deepEqual(selectScripts('quick'), selectScripts('runtime'));
assert.deepEqual(selectScripts('full'), allScripts);
assert.deepEqual(selectScripts('exhaustive'), allScripts);
for (const group of ['database', 'protocol', 'tooling'] as const) {
  for (const script of suites[group]) {
    assert.equal(selectScripts('quick').includes(script), false, script);
  }
}
assert.ok(selectScripts('database').includes('auth/store-conformance.ts'));
assert.ok(selectScripts('protocol').includes('auth/oidc-browser.ts'));
assert.ok(selectScripts('extended').includes('auth/password-load.ts'));
assert.ok(selectScripts('tooling').includes('auth/pack-contents.ts'));
assert.ok(selectScripts('quick').includes('auth/session-csrf.ts'));
assert.ok(selectScripts('quick').includes('auth/grants.ts'));
assert.throws(() => selectScripts('quik'), /Unknown test selection/);
process.stdout.write('test selection: full inventory and routine boundaries passed\n');
