// Does:  Proves each auth Semgrep rule fires on a planted line, not on its allowed path, and the real tree is clean.
// Holds: The plants live in a scratch tree outside the repository; the real tree is scanned with all of .semgrep.

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createReport } from './rig/v1-report.ts';

const root = fileURLToPath(new URL('../..', import.meta.url));
const semgrep = join(homedir(), '.local/bin/semgrep');
const rules = join(root, '.semgrep/auth-invariants.yml');

interface Plant {
  readonly rule: string;
  readonly fires: readonly (readonly [string, string])[];
  readonly allowed: readonly (readonly [string, string])[];
}

const base = 'packages/auth/src';
const plants: readonly Plant[] = [
  {
    rule: 'auth-sqlite-outside-adapter',
    fires: [
      [`${base}/store/plant1-a.ts`, "import { DatabaseSync } from 'node:sqlite';\nexport const a = DatabaseSync;\n"],
      [`${base}/store/plant1-b.ts`, "export const b = await import('node:sqlite');\n"],
      [`${base}/store/plant1-c.ts`, "export const c = process.getBuiltinModule('node:sqlite');\n"],
    ],
    allowed: [
      [`${base}/sqlite/plant1-ok.ts`, "import { DatabaseSync } from 'node:sqlite';\nexport const ok = DatabaseSync;\n"],
    ],
  },
  {
    rule: 'auth-imports-beyond-core-and-node',
    fires: [
      [`${base}/server/plant2-a.ts`, "import pg from 'pg';\nexport const a = pg;\n"],
      [`${base}/server/plant2-b.ts`, "export const b = await import('left-pad');\n"],
    ],
    allowed: [
      [
        `${base}/server/plant2-ok.ts`,
        "import { createServer } from '@skeld/core/server';\nimport { join } from 'node:path';\nimport { local } from './local.ts';\nexport const ok = [createServer, join, local];\n",
      ],
    ],
  },
  {
    rule: 'auth-fs-outside-sqlite-and-recorder',
    fires: [
      [`${base}/server/plant3-a.ts`, "import { readFileSync } from 'node:fs';\nexport const a = readFileSync;\n"],
      [`${base}/server/plant3-b.ts`, "import { readFile } from 'node:fs/promises';\nexport const b = readFile;\n"],
    ],
    allowed: [
      [`${base}/sqlite/plant3-ok.ts`, "import { chmodSync } from 'node:fs';\nexport const ok = chmodSync;\n"],
      [
        `${base}/diag/recorder/plant3-ok.ts`,
        "import { appendFileSync } from 'node:fs';\nexport const ok = appendFileSync;\n",
      ],
    ],
  },
  {
    rule: 'auth-process-io-outside-recorder',
    fires: [
      [`${base}/server/plant4-a.ts`, 'export const a = process.env.HOME;\n'],
      [`${base}/server/plant4-b.ts`, "export const b = (): void => console.log('x');\n"],
      [`${base}/server/plant4-c.ts`, 'export const c = process.stdout;\n'],
    ],
    allowed: [[`${base}/diag/recorder/plant4-ok.ts`, 'export const ok = process.env.SKELD_DIAG_DIR;\n']],
  },
  {
    rule: 'auth-clock-outside-allowed-files',
    fires: [
      [`${base}/server/plant5-a.ts`, 'export const a = Date.now();\n'],
      [`${base}/session/plant5-b.ts`, 'export const b = new Date();\n'],
    ],
    allowed: [
      [`${base}/jwt/plant5-ok.ts`, 'export const ok = Date.now();\n'],
      [`${base}/outbound/plant5-ok.ts`, 'export const ok = Date.now();\n'],
      [`${base}/diag/recorder/plant5-ok.ts`, 'export const ok = new Date();\n'],
    ],
  },
  {
    rule: 'auth-node-import-in-routes-or-policy',
    fires: [
      [`${base}/routes/plant6-a.ts`, "import { randomBytes } from 'node:crypto';\nexport const a = randomBytes;\n"],
      [`${base}/policy/plant6-b.ts`, "export const b = await import('node:path');\n"],
    ],
    allowed: [
      [`${base}/server/plant6-ok.ts`, "import { randomBytes } from 'node:crypto';\nexport const ok = randomBytes;\n"],
    ],
  },
];

interface Finding {
  readonly path: string;
  readonly rule: string;
}

function scan(cwd: string, args: readonly string[]): { status: number | null; findings: Finding[]; text: string } {
  const run = spawnSync(semgrep, ['--metrics=off', '--quiet', '--json', ...args], {
    cwd,
    encoding: 'utf8',
    timeout: 180_000,
  });
  const findings: Finding[] = [];
  try {
    const parsed: unknown = JSON.parse(run.stdout);
    const results: unknown = typeof parsed === 'object' && parsed !== null ? Reflect.get(parsed, 'results') : undefined;
    for (const result of Array.isArray(results) ? results : []) {
      const path: unknown = Reflect.get(Object(result), 'path');
      const checkId: unknown = Reflect.get(Object(result), 'check_id');
      if (typeof path === 'string' && typeof checkId === 'string') {
        findings.push({ path, rule: checkId.split('.').pop() ?? checkId });
      }
    }
  } catch {
    // Why: an unparsable answer is reported through the exit status and the text below
  }
  return { status: run.status, findings, text: `${run.stdout.slice(0, 200)} ${run.stderr.slice(0, 300)}` };
}

const report = createReport(
  'v09',
  'each of the six rules of .semgrep/auth-invariants.yml fires on a planted violating line and on no allowed path, and the whole .semgrep set exits clean on packages/core/src and packages/auth/src',
);

if (!existsSync(semgrep)) {
  report.check('semgrep is installed at ~/.local/bin/semgrep', false, 'missing');
  report.finish();
} else {
  const scratch = mkdtempSync(join(tmpdir(), 'skeld-v09-static-'));
  try {
    for (const plant of plants) {
      for (const [path, content] of [...plant.fires, ...plant.allowed]) {
        mkdirSync(dirname(join(scratch, path)), { recursive: true });
        writeFileSync(join(scratch, path), content);
      }
    }
    const planted = scan(scratch, ['--config', rules, '--error', '.']);
    report.check(
      'the scratch scan runs and exits non-zero (findings under --error)',
      planted.status === 1,
      `exit ${String(planted.status)} ${planted.status === 1 ? '' : planted.text}`,
    );
    for (const plant of plants) {
      for (const [path] of plant.fires) {
        const hits = planted.findings.filter((finding) => finding.path === path);
        report.check(
          `${plant.rule} fires on ${path}`,
          hits.length >= 1 && hits.every((hit) => hit.rule === plant.rule),
          hits.map((hit) => hit.rule).join(',') || 'no finding',
        );
      }
      for (const [path] of plant.allowed) {
        const hits = planted.findings.filter((finding) => finding.path === path && finding.rule === plant.rule);
        report.check(
          `${plant.rule} does not fire on its allowed path ${path}`,
          hits.length === 0,
          `${hits.length} finding(s)`,
        );
      }
    }
    const strays = planted.findings.filter(
      (finding) =>
        !plants.some((plant) => plant.fires.some(([path]) => path === finding.path) && plant.rule === finding.rule),
    );
    report.check(
      'no finding anywhere else in the scratch tree (allowed files and every other rule stay silent)',
      strays.length === 0,
      strays.map((finding) => `${finding.rule}@${finding.path}`).join(' ') || 'none',
    );
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
  const real = scan(root, ['--config', '.semgrep', '--error', 'packages/core/src', 'packages/auth/src']);
  report.check(
    'the whole .semgrep set on packages/core/src and packages/auth/src exits 0 with no finding',
    real.status === 0 && real.findings.length === 0,
    `exit ${String(real.status)}; ${real.findings.length} finding(s) ${real.text.trim().slice(0, 200)}`,
  );
  report.finish();
}
