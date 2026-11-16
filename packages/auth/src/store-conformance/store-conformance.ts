// Does:  Exports @skeld/auth/store-conformance: runStoreConformance and the conformance kit's target and report.
// Holds: Each case runs on its own fresh target; a case is passed only after its run returns, and never throws out.

import type { StoreEvent, StoreOperations } from '../store/types.ts';
import { cases } from './cases.ts';
import { deepFrozen, describe } from './check.ts';
import type { ConformanceReport, ConformanceTarget } from './types.ts';

export type { ConformanceReport, ConformanceTarget } from './types.ts';

/**
 * Runs the store contract's cases against fresh stores from `make`, each uninstalled, and reports every case.
 * Never throws for a failed case; a case needing a hook the target lacks is skipped, never passed.
 * @example await runStoreConformance(async () => { const store = createSqliteStore({ path: ':memory:' }); return { store, dispose: () => store.close() }; })
 */
export async function runStoreConformance(make: () => Promise<ConformanceTarget>): Promise<ConformanceReport> {
  const passed: string[] = [];
  const failed: { readonly name: string; readonly detail: string }[] = [];
  const skipped: string[] = [];
  for (const conformanceCase of cases) {
    // Why: Cases run one at a time so a lock wait or a race in one case never meets another case's work.
    // biome-ignore lint/performance/noAwaitInLoops: each case needs the previous one's target disposed first.
    const outcome = await runCase(make, conformanceCase);
    if (outcome === 'skipped') {
      skipped.push(conformanceCase.name);
    } else if (outcome === null) {
      passed.push(conformanceCase.name);
    } else {
      failed.push(Object.freeze({ name: conformanceCase.name, detail: outcome }));
    }
  }
  return Object.freeze({
    passed: Object.freeze(passed),
    failed: Object.freeze(failed),
    skipped: Object.freeze(skipped),
  });
}

// Does:  Runs one case on a new target: null when it passed, 'skipped', or the detail of its failure.
async function runCase(
  make: () => Promise<ConformanceTarget>,
  conformanceCase: (typeof cases)[number],
): Promise<string | 'skipped' | null> {
  let target: ConformanceTarget;
  try {
    target = await make();
  } catch (error) {
    return `make failed: ${describe(error)}`;
  }
  let outcome: string | 'skipped' | null = null;
  try {
    if (
      (conformanceCase.needs === 'lock' && target.holdLock === undefined) ||
      (conformanceCase.needs === 'row-lock' && (target.holdLock === undefined || target.lockScope !== 'row')) ||
      (conformanceCase.needs === 'versions' && target.writeVersions === undefined)
    ) {
      outcome = 'skipped';
    } else {
      const events: StoreEvent[] = [];
      const attach = Object.freeze({ onFailure: (event: StoreEvent) => void events.push(event) });
      if (conformanceCase.setup === 'attached') {
        const installed = await target.store.install();
        const attached = await target.store.attach(attach);
        if (installed.kind !== 'installed' || attached.kind !== 'attached') {
          return `setup: install answered ${installed.kind}, attach answered ${attached.kind}`;
        }
        deepFrozen(installed, 'install result');
        deepFrozen(attached, 'attach result');
      }
      await conformanceCase.run({
        store: target.store,
        ops: checkedFrozen(target.store.ops),
        attach,
        events,
        hold: target.holdLock,
        writeVersions: target.writeVersions,
      });
    }
  } catch (error) {
    outcome = describe(error);
  } finally {
    try {
      await target.dispose();
    } catch (error) {
      outcome ??= `dispose failed: ${describe(error)}`;
    }
  }
  return outcome;
}

// Does:  Wraps the operations so every result a case receives is checked frozen before the case sees it.
function checkedFrozen(ops: StoreOperations): StoreOperations {
  // Why: A frozen target forbids a proxy from answering its members with other functions, so the target is a copy.
  return new Proxy(
    { ...ops },
    {
      get(_, property) {
        const member: unknown = Reflect.get(ops, property);
        if (typeof member !== 'function') {
          return member;
        }
        return async (...args: unknown[]) => {
          const result: unknown = await Reflect.apply(member, ops, args);
          deepFrozen(result, `${String(property)} result`);
          return result;
        };
      },
    },
  );
}
