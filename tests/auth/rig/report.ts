// Does:  Reports each case of an auth test script on stdout, one line per case and a closing count.
// Holds: The exit code is non-zero when any case failed or threw.

export interface Report {
  note: (line: string) => void;
  check: (name: string, ok: boolean, detail?: string) => boolean;
  run: (name: string, body: () => Promise<void>) => Promise<void>;
  finish: () => void;
}

export function createReport(statement: string): Report {
  let cases = 0;
  let failed = 0;
  const emit = (line: string): void => {
    process.stdout.write(`${line}\n`);
  };
  emit(statement);
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
