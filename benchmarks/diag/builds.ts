import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { BenchError } from '../bench-error.ts';
import { childEnvironment } from '../environment.ts';
import type { Command } from '../pinning.ts';
import { type Launch, type ServerProcess, serversFolder, startServer } from '../server-process.ts';
import { displayPath } from '../terminal.ts';
import type { RunOptions, ServerId } from '../types.ts';
import { startProofMs, startProofPollMs } from '../values.ts';

type Sampling = Pick<RunOptions, 'stepN' | 'cpuN'>;

export interface Target {
  readonly launch: Launch;
  readonly recorderFolder: string | null;
}

const diagCondition = '--conditions=darkstart-diag';
const recorderFiles = ['run.json', 'snapshot.jsonl', 'journal.jsonl'] as const;
const scenarioScript = join(import.meta.dirname, 'scenario-server.ts');
const darkstartScript = join(serversFolder, 'darkstart.ts');

const portArguments = ['--port', '0'] as const;

const normalEnvironment = (): NodeJS.ProcessEnv => ({ ...childEnvironment(), NODE_ENV: 'production' });

const diagEnvironment = (folder: string, sampling: Sampling): NodeJS.ProcessEnv => ({
  ...normalEnvironment(),
  DARKSTART_DIAG_DIR: folder,
  DARKSTART_DIAG_STEP_N: String(sampling.stepN),
  DARKSTART_DIAG_CPU_N: String(sampling.cpuN),
});

export function serverTarget(server: ServerId): Target {
  return {
    launch: {
      name: server,
      readyLabel: server,
      args: [join(serversFolder, `${server}.ts`), ...portArguments],
      env: normalEnvironment(),
    },
    recorderFolder: null,
  };
}

export function diagTarget(folder: string, sampling: Sampling): Target {
  return {
    launch: {
      name: 'darkstart-diag',
      readyLabel: 'darkstart',
      args: [diagCondition, darkstartScript, ...portArguments],
      env: diagEnvironment(folder, sampling),
    },
    recorderFolder: folder,
  };
}

export function scenarioTarget(folder: string, sampling: Sampling, token: string, plant: boolean): Target {
  return {
    launch: {
      name: 'scenario',
      readyLabel: 'scenario',
      args: [diagCondition, scenarioScript, ...portArguments, ...(plant ? ['--plant'] : [])],
      env: { ...diagEnvironment(folder, sampling), DARKSTART_DIAG_CANARY: token },
    },
    recorderFolder: folder,
  };
}

export function diagCommandLine(command: Command): readonly string[] {
  return [...command, diagCondition, displayPath(darkstartScript), ...portArguments];
}

export function requireRecorderBuild(): void {
  const manifest = fileURLToPath(import.meta.resolve('@darkstart/core/package.json'));
  const recorder = join(dirname(manifest), 'dist', 'diag', 'recorder', 'recorder.js');
  if (!existsSync(recorder)) {
    throw new BenchError(3, `${displayPath(recorder)} is missing. Run npm run bench, which builds the package first.`);
  }
}

const hasRecorderFiles = (folder: string): boolean => recorderFiles.every((file) => existsSync(join(folder, file)));

async function proveStart(name: string, folder: string, exitCode: 3 | 4): Promise<void> {
  const deadline = performance.now() + startProofMs;
  while (!hasRecorderFiles(folder)) {
    if (performance.now() >= deadline) {
      throw new BenchError(
        exitCode,
        `${name} reported ready but wrote no run.json, snapshot.jsonl and journal.jsonl to ${displayPath(folder)} within ${startProofMs / 1000} s: the recorder did not start.`,
      );
    }
    // biome-ignore lint/performance/noAwaitInLoops: the proof polls one folder until its files appear or the deadline passes.
    await delay(startProofPollMs);
  }
}

export async function startTarget(target: Target, command: Command, proofExitCode: 3 | 4): Promise<ServerProcess> {
  const server = await startServer(target.launch, command);
  if (target.recorderFolder === null) {
    return server;
  }
  try {
    await proveStart(target.launch.name, target.recorderFolder, proofExitCode);
  } catch (error) {
    server.kill();
    await server.exited;
    throw error;
  }
  return server;
}
