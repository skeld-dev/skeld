// Does:  Runs the public store conformance kit on in-memory SQLite, file SQLite and PostgreSQL and judges each report.
// Holds: Zero failed cases per target, the same case set on all three, and only the contract's hook-less skips.

import { Client } from 'pg';
import { storeKinds } from '../support/test-profile.ts';
import { createSqliteStore } from '@skeld/auth/sqlite';
import { type ConformanceReport, type ConformanceTarget, runStoreConformance } from '@skeld/auth/store-conformance';
import { cleanAll, createDatabase, makeRig, type PgDatabase, type Table } from './support-store.ts';
import { createReport } from './rig/report.ts';

const statement =
  'SQLite (memory and file) and PostgreSQL pass the same store conformance suite with zero failed cases; a target skips only the cases whose hook it lacks';
const operations = [
  'subjectEnsure',
  'subjectRead',
  'subjectDisable',
  'subjectEnable',
  'subjectInvalidate',
  'sessionIssue',
  'sessionRead',
  'sessionRenew',
  'sessionRotate',
  'sessionRevoke',
  'apiKeyIssue',
  'apiKeyRead',
  'apiKeyList',
  'apiKeyRevoke',
  'limitCharge',
  'attemptCreate',
  'attemptConsume',
  'expiredRemove',
];
// Why: The contract skips a case when its hook is missing; these are the cases needing holdLock or writeVersions.
const needsHooks = [
  'install.mismatch',
  'install.version-empty',
  'install.version-repeated',
  'attach.mismatch',
  'attach.version-empty',
  'attach.version-repeated',
  'sessionRenew.expires-while-locked',
  'sessionRotate.expires-while-locked',
  'attemptConsume.expires-while-locked',
  'limitCharge.expires-while-locked',
  'apiKeyIssue.expires-while-locked',
  'subjectEnsure.waits-for-lock',
  'subjectRead.no-lock-wait',
  'sessionRead.no-lock-wait',
  'apiKeyRead.no-lock-wait',
  'close.outstanding',
];
const rowScope = 'expiredRemove.skips-locked';
const expectedSkips: Record<string, readonly string[]> = {
  'in-memory SQLite (no hooks)': [...needsHooks, rowScope].sort(),
  'file SQLite (holdLock, lockScope database, writeVersions)': [rowScope],
  'PostgreSQL (holdLock, lockScope row, writeVersions)': [],
};

type Maker = () => Promise<ConformanceTarget>;

const memory: Maker = () => {
  const store = createSqliteStore({ path: ':memory:', cleanupIntervalSeconds: 3600 });
  return Promise.resolve({ store, dispose: () => store.close() });
};

const resetter: { client: Client | null } = { client: null };

function withHooks(kind: 'sqlite' | 'postgres', sharedDatabase?: PgDatabase): Maker {
  return async () => {
    if (sharedDatabase !== undefined) {
      // Why: Cases are serial with earlier pools closed, so a fresh schema isolates them without a database per case.
      if (resetter.client === null) {
        resetter.client = new Client({ connectionString: sharedDatabase.url() });
        await resetter.client.connect();
      }
      await resetter.client.query('DROP SCHEMA IF EXISTS skeld_auth CASCADE');
    }
    const rig = await makeRig(kind, {
      install: false,
      attach: false,
      ...(sharedDatabase === undefined ? {} : { database: sharedDatabase }),
    });
    return {
      store: rig.store,
      lockScope: kind === 'sqlite' ? 'database' : 'row',
      holdLock: async (table: Table, key, ms) => {
        if (!(await rig.exists(table, key))) {
          throw new Error('row to lock is absent');
        }
        await rig.hold(table, key, ms);
      },
      writeVersions: async (versions) => {
        await rig.query('DELETE FROM schema_version');
        for (const version of versions) {
          // biome-ignore lint/performance/noAwaitInLoops: the rows are written in the order given
          await rig.query('INSERT INTO schema_version (version) VALUES (?)', [version]);
        }
      },
      dispose: () => rig.dispose(),
    };
  };
}

function operationOf(name: string): string {
  return name.slice(0, name.indexOf('.'));
}

const report = createReport(statement);
const reports = new Map<string, ConformanceReport>();
const database = storeKinds.includes('postgres') ? await createDatabase() : undefined;
const targets: (readonly [string, Maker])[] = [];
if (storeKinds.includes('sqlite')) {
  targets.push(
    ['in-memory SQLite (no hooks)', memory],
    ['file SQLite (holdLock, lockScope database, writeVersions)', withHooks('sqlite')],
  );
}
if (database !== undefined) {
  targets.push(['PostgreSQL (holdLock, lockScope row, writeVersions)', withHooks('postgres', database)]);
}

try {
  // Why: Each target owns its storage (memory, its own file, its own database), so the three runs overlap safely.
  await Promise.all(
    targets.map(([label, make]) =>
      report.run(label, async () => {
        const started = performance.now();
        const outcome = await runStoreConformance(make);
        const seconds = ((performance.now() - started) / 1000).toFixed(1);
        reports.set(label, outcome);
        report.note(
          `${label}: ${outcome.passed.length} passed, ${outcome.failed.length} failed, ${outcome.skipped.length} skipped (${seconds} s)`,
        );
        for (const failure of outcome.failed) {
          report.note(`  failed ${failure.name}: ${failure.detail.slice(0, 300)}`);
        }
        for (const name of outcome.skipped) {
          report.note(`  skipped ${name}`);
        }
        report.check(`${label}: zero failed cases`, outcome.failed.length === 0, `${outcome.failed.length} failed`);
        report.check(`${label}: ran cases at all`, outcome.passed.length > 100, `${outcome.passed.length} passed`);
        const skipped = [...outcome.skipped].sort();
        const expected = expectedSkips[label] ?? [];
        report.check(
          `${label}: skipped exactly the cases whose hook it lacks`,
          JSON.stringify(skipped) === JSON.stringify(expected),
          `${skipped.length} skipped, ${expected.length} expected`,
        );
        const covered = operations.filter(
          (operation) => !outcome.passed.some((name) => operationOf(name) === operation),
        );
        const closing = [
          'attach.after-close',
          'install.after-close',
          'close.twice',
          ...(label.startsWith('in-memory') ? [] : ['close.outstanding']),
        ];
        const missingClose = closing.filter((name) => !outcome.passed.includes(name));
        report.check(
          `${label}: the closed-store cases pass (${closing.join(', ')})`,
          missingClose.length === 0,
          missingClose.join(',') || `${closing.length} passed`,
        );
        report.check(
          `${label}: every one of the 18 operations has a passed case`,
          covered.length === 0,
          covered.join(',') || 'all 18',
        );
      }),
    ),
  );

  const families = [...reports.entries()].map(([label, outcome]) => {
    const names = [...outcome.passed, ...outcome.skipped, ...outcome.failed.map((failure) => failure.name)].sort();
    return [label, names] as const;
  });
  if (families.length === targets.length) {
    const [first] = families;
    const same =
      first !== undefined && families.every(([, names]) => JSON.stringify(names) === JSON.stringify(first[1]));
    report.check('all selected targets ran the same case set', same, `${first?.[1].length ?? 0} cases each`);
  } else {
    report.check(
      'all selected targets ran the same case set',
      false,
      `only ${families.length} of ${targets.length} targets reported`,
    );
  }
  const perOperation = operations.map(
    (operation) =>
      `${operation} ${reports.get('PostgreSQL (holdLock, lockScope row, writeVersions)')?.passed.filter((name) => operationOf(name) === operation).length ?? 0}`,
  );
  if (database !== undefined) {
    report.note(`PostgreSQL passed cases per operation: ${perOperation.join(', ')}`);
  }
} finally {
  await resetter.client?.end();
  await cleanAll();
}
report.finish();
