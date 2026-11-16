// Does:  Reports each case of a V01 to V04 proof script on stdout, named for the script that ran.
// Holds: A failed case fails the exit code.

import { execFileSync } from 'node:child_process';
import { basename } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface Report {
  note: (line: string) => void;
  check: (name: string, ok: boolean, detail?: string) => boolean;
  run: (name: string, body: () => Promise<void>) => Promise<void>;
  finish: () => void;
}

const root = fileURLToPath(new URL('../../..', import.meta.url));

export function createReport(
  _task: 'v01' | 'v02' | 'v03' | 'v04' | 'v09' | 'v10/review-fixes',
  statement: string,
): Report {
  const script = `${basename(process.argv[1] ?? 'script', '.ts')}${process.env.SKELD_REPORT_SUFFIX ?? ''}`;
  let cases = 0;
  let failed = 0;
  const emit = (line: string): void => {
    process.stdout.write(`${line}\n`);
  };
  let commit = 'no git';
  try {
    commit = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  } catch {
    commit = 'no git';
  }
  emit(`${script}: ${statement}`);
  emit(`candidate: working tree on ${commit}; Node ${process.version}; ${new Date().toISOString()}`);
  const check = (name: string, ok: boolean, detail = ''): boolean => {
    cases++;
    if (!ok) {
      failed++;
    }
    emit(`${ok ? 'pass' : 'fail'} ${name}${detail === '' ? '' : `: ${detail}`}`);
    return ok;
  };
  return {
    note: emit,
    check,
    run: async (name, body) => {
      try {
        await body();
      } catch (error) {
        const text = error instanceof Error ? `${error.name}: ${error.message.slice(0, 300)}` : typeof error;
        check(name, false, `threw ${text}`);
      }
    },
    finish: () => {
      emit(`${cases - failed} of ${cases} cases passed`);
      process.exitCode = failed === 0 ? 0 : 1;
    },
  };
}
