// Does:  Reports each case of a V01 to V04 proof script on stdout and in the task's evidence file.
// Holds: The file is written once, at finish, named for the script that ran; a failed case fails the exit code.

import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
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
  task: 'v01' | 'v02' | 'v03' | 'v04' | 'v09' | 'v10/review-fixes',
  statement: string,
): Report {
  const script = `${basename(process.argv[1] ?? 'script', '.ts')}${process.env.SKELD_REPORT_SUFFIX ?? ''}`;
  const lines: string[] = [];
  let cases = 0;
  let failed = 0;
  const emit = (line: string): void => {
    lines.push(line);
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
      const dir = `${root}.project/features/0.2.0-auth/evidence/${task}`;
      mkdirSync(dir, { recursive: true });
      writeFileSync(`${dir}/${script}.txt`, `${lines.join('\n')}\n`);
      process.exitCode = failed === 0 ? 0 : 1;
    },
  };
}
