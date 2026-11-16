// Does:  Type-checks a source text against the skeld sources, under the engine's lib, and reports tsc's verdict.
// Holds: The scratch folder holds only the probe and is removed whatever tsc answers.

import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const tsc = fileURLToPath(new URL('bin/tsc', import.meta.resolve('typescript/package.json')));
const repoModules = fileURLToPath(new URL('../node_modules', import.meta.url));

export interface Compiled {
  status: number | null;
  errors: string[];
  diagnostics: { file: string; line: number; code: number }[];
}

export function compileProbes(sources: readonly string[]): Compiled[] {
  const folder = mkdtempSync(join(tmpdir(), 'skeld-probe-'));
  try {
    symlinkSync(repoModules, join(folder, 'node_modules'));
    writeFileSync(join(folder, 'package.json'), '{"type":"module"}');
    return sources.map((source) => {
      writeFileSync(join(folder, 'probe.ts'), source);
      writeFileSync(
        join(folder, 'tsconfig.json'),
        JSON.stringify({
          compilerOptions: {
            target: 'es2025',
            module: 'nodenext',
            lib: JSON.parse(readFileSync(new URL('../../packages/core/tsconfig.json', import.meta.url), 'utf8'))
              .compilerOptions.lib,
            types: ['node'],
            strict: true,
            noEmit: true,
            customConditions: ['skeld-source'],
            allowImportingTsExtensions: true,
          },
          files: ['probe.ts'],
        }),
      );
      const result = spawnSync(process.execPath, [tsc, '-p', folder, '--pretty', 'false'], {
        encoding: 'utf8',
        timeout: 120_000,
      });
      const errors = `${result.stdout}${result.stderr}`.split('\n').filter((line) => /error TS\d+:/.test(line));
      const diagnostics = [...`${result.stdout}${result.stderr}`.matchAll(/^(.+?)\((\d+),\d+\): error TS(\d+):/gm)].map(
        (match) => ({
          file: resolve(match[1] ?? '') === join(folder, 'probe.ts') ? 'probe.ts' : (match[1] ?? ''),
          line: Number(match[2]),
          code: Number(match[3]),
        }),
      );
      return { status: result.status, errors, diagnostics };
    });
  } finally {
    unlinkSync(join(folder, 'node_modules'));
    rmSync(folder, { recursive: true });
  }
}
