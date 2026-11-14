// Does:  Describes the external entrant: how it starts, the name its ready line announces and its installed version.
// Holds: An external entrant is measured only under a non-empty name other than skeld, announced by its ready line.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { BenchError, errorCode } from './bench-error.ts';
import type { CheckHooks } from './check.ts';
import type { Target } from './diag/builds.ts';
import { childEnvironment } from './environment.ts';
import type { Command } from './pinning.ts';
import { startServer } from './server-process.ts';
import { killedWarning } from './terminal.ts';
import type { BenchExternal } from './types.ts';

const portArguments = ['--port', '0'] as const;

const targetFor = (file: string, name: string, readyLabel: string | null): Target => ({
  launch: {
    name,
    readyLabel,
    args: [file, ...portArguments],
    env: { ...childEnvironment(), NODE_ENV: 'production' },
    cwd: dirname(file),
  },
  recorderFolder: null,
});

export function externalTarget(external: BenchExternal): Target {
  return targetFor(external.file, external.server, external.server);
}

const parsedVersion = (text: string): string | null => {
  let manifest: unknown;
  try {
    manifest = JSON.parse(text);
  } catch (error) {
    if (error instanceof SyntaxError) {
      return null;
    }
    throw error;
  }
  return typeof manifest === 'object' &&
    manifest !== null &&
    'version' in manifest &&
    typeof manifest.version === 'string'
    ? manifest.version
    : null;
};

// Why: The version is a note in the report; a missing or unreadable manifest leaves it out and never stops the run.
const installedVersion = (folder: string, name: string): string | null => {
  try {
    return parsedVersion(readFileSync(join(folder, 'node_modules', name, 'package.json'), 'utf8'));
  } catch (error) {
    if (errorCode(error) !== null) {
      return null;
    }
    throw error;
  }
};

// Does:  Starts the external server once to learn the name its ready line announces, then stops it.
export async function identifyExternal(
  file: string,
  command: Command,
  hooks: Pick<CheckHooks, 'track' | 'warn'>,
): Promise<BenchExternal> {
  const server = await startServer(targetFor(file, file, null).launch, command);
  hooks.track(server);
  if (await server.stop()) {
    hooks.warn(killedWarning(server.name));
  }
  hooks.track(null);
  const name = server.readyLabel;
  if (name === '' || name === 'skeld') {
    throw new BenchError(
      3,
      `${file} announces ${name === '' ? 'an empty server name' : 'itself as skeld'} in its ready line; an external entrant needs a name of its own.`,
    );
  }
  return {
    server: name,
    file,
    version: installedVersion(dirname(file), name),
    commandLine: [...command, file, ...portArguments],
  };
}
