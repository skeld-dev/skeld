// Does:  Scans the real core and auth sources with every rule of .semgrep.
// Holds: The scan runs with --error, so any finding or a missing semgrep fails the script.

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createReport } from './rig/v1-report.ts';

const root = fileURLToPath(new URL('../..', import.meta.url));
const semgrep = join(homedir(), '.local/bin/semgrep');

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

const report = createReport('v09', 'the whole .semgrep set exits clean on packages/core/src and packages/auth/src');

if (!existsSync(semgrep)) {
  report.check('semgrep is installed at ~/.local/bin/semgrep', false, 'missing');
  report.finish();
} else {
  const real = scan(root, ['--config', '.semgrep', '--error', 'packages/core/src', 'packages/auth/src']);
  report.check(
    'the whole .semgrep set on packages/core/src and packages/auth/src exits 0 with no finding',
    real.status === 0 && real.findings.length === 0,
    `exit ${String(real.status)}; ${real.findings.length} finding(s) ${real.text.trim().slice(0, 200)}`,
  );
  report.finish();
}
