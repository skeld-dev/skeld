// Does:  Builds the Standard Schema entry a node exposes as ~standard.
// Holds: validate returns issues for a refused value or the finished value for an accepted one, never both.

import { compileCheck } from './check.ts';
import { explain } from './explain.ts';
import { compileFinish } from './finish.ts';
import { isNotAllowed } from './messages.ts';
import type { Schema, StandardProps } from './types.ts';

const standards = new WeakMap<Schema, StandardProps<unknown, unknown>>();

function buildStandard(schema: Schema): StandardProps<unknown, unknown> {
  const check = compileCheck(schema);
  const finish = compileFinish(schema, 'wrap');
  return Object.freeze({
    version: 1,
    vendor: 'darkstart',
    validate: (value: unknown) => {
      if (!check(value)) {
        const issues = explain(schema, value, 100);
        // Why: A value the check refused always yields at least one issue, even when the explanation finds none.
        return { issues: issues.length > 0 ? issues : [{ message: isNotAllowed, path: [] }] };
      }
      return { value: finish === null ? value : finish(value) };
    },
  });
}

export function standardOf(schema: Schema): StandardProps<unknown, unknown> {
  const cached = standards.get(schema);
  if (cached !== undefined) {
    return cached;
  }
  const standard = buildStandard(schema);
  standards.set(schema, standard);
  return standard;
}
