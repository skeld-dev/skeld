// Does:  Type-checks a source text against the Skeld sources, under the engine's lib, and reports tsc's verdict.
// Holds: The scratch folder holds only the probe and is removed whatever tsc answers.

import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const tsc = fileURLToPath(new URL('../../node_modules/typescript/bin/tsc', import.meta.url));
const repoModules = fileURLToPath(new URL('../../node_modules', import.meta.url));

export interface Compiled {
  status: number | null;
  errors: string[];
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
            lib: ['es2025', 'esnext.error'],
            types: ['node'],
            strict: true,
            noEmit: true,
            customConditions: ['skeld-source'],
            allowImportingTsExtensions: true,
          },
          files: ['probe.ts'],
        }),
      );
      const result = spawnSync(process.execPath, [tsc, '-p', folder], { encoding: 'utf8', timeout: 120_000 });
      const errors = `${result.stdout}${result.stderr}`.split('\n').filter((line) => line.includes('probe.ts('));
      return { status: result.status, errors };
    });
  } finally {
    unlinkSync(join(folder, 'node_modules'));
    rmSync(folder, { recursive: true });
  }
}
