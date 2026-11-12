// Does:  Describes the entrants of a logging session: the baseline commit twice and the three logging variants.
// Holds: before-a and before-b start the same baseline server from the baseline folder; no entrant runs the diag build.

import { join } from 'node:path';
import type { Target } from '../diag/builds.ts';
import { childEnvironment } from '../environment.ts';
import { serversFolder } from '../server-process.ts';
import { displayPath } from '../terminal.ts';
import type { LoggingBuildId, LoggingSession } from '../types.ts';

const portArguments = ['--port', '0'] as const;
const variantScript = join(serversFolder, 'skeld-logging.ts');
const variantLabel = 'skeld-logging';

const environment = (): NodeJS.ProcessEnv => ({ ...childEnvironment(), NODE_ENV: 'production' });

const baselineScript = (session: LoggingSession): string => join(session.baseline, 'benchmarks', 'servers', 'skeld.ts');

export function loggingTarget(session: LoggingSession, build: LoggingBuildId): Target {
  if (build === 'before-a' || build === 'before-b') {
    return {
      launch: {
        name: build,
        readyLabel: 'skeld',
        args: [baselineScript(session), ...portArguments],
        env: environment(),
        cwd: session.baseline,
      },
      recorderFolder: null,
    };
  }
  return {
    launch: {
      name: build,
      readyLabel: variantLabel,
      args: [variantScript, '--log', build, ...portArguments],
      env: environment(),
    },
    recorderFolder: null,
  };
}

export function loggingCommandLines(session: LoggingSession): readonly string[] {
  return [
    `before-a, before-b: ${displayPath(baselineScript(session))} --port 0, from ${displayPath(session.baseline)}/`,
    ...(session.controlOnly ? [] : [`off, default, access: ${displayPath(variantScript)} --log <variant> --port 0`]),
  ];
}
