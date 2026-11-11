// Does:  Starts each server in turn and checks that it answers every route exactly as expected.
// Holds: Servers are checked one at a time, and a wrong answer from any of them means nothing is measured.

import { BenchError } from './bench-error.ts';
import { startTarget, type Target } from './diag/builds.ts';
import type { Command } from './pinning.ts';
import { preflight, preflightFailure } from './preflight.ts';
import type { ServerProcess } from './server-process.ts';
import { killedWarning } from './terminal.ts';
import type { CheckRow, RouteId } from './types.ts';

export interface CheckHooks {
  readonly interrupted: () => boolean;
  readonly track: (server: ServerProcess | null) => void;
  readonly warn: (text: string) => void;
  readonly fail: (error: BenchError) => void;
}

export function preflightRoutes(server: ServerProcess, routes: readonly RouteId[]): Promise<readonly CheckRow[]> {
  return Promise.all(routes.map((route) => preflight(server.name, server.port, route)));
}

const notStarted = (name: string, routes: readonly RouteId[]): readonly CheckRow[] =>
  routes.map((route) => ({
    server: name,
    route,
    started: false,
    status: null,
    mediaType: null,
    bytes: null,
    body: null,
    passed: false,
  }));

const checkOne = async (
  target: Target,
  routes: readonly RouteId[],
  command: Command,
  hooks: CheckHooks,
): Promise<readonly CheckRow[]> => {
  const server = target.launch.name;
  let running: ServerProcess;
  try {
    running = await startTarget(target, command, 3);
  } catch (error) {
    if (error instanceof BenchError) {
      hooks.fail(error);
      return notStarted(server, routes);
    }
    throw error;
  }
  hooks.track(running);
  const rows = hooks.interrupted() ? [] : await preflightRoutes(running, routes);
  const failed = rows.find((row) => !row.passed);
  if (failed !== undefined) {
    hooks.fail(new BenchError(3, `${preflightFailure(failed)}. Nothing was measured.`));
  }
  if (await running.stop()) {
    hooks.warn(killedWarning(server));
  }
  hooks.track(null);
  return rows;
};

export async function checkServers(
  targets: readonly Target[],
  routes: readonly RouteId[],
  command: Command,
  hooks: CheckHooks,
): Promise<readonly CheckRow[]> {
  const rows: CheckRow[] = [];
  for (const target of targets) {
    if (hooks.interrupted()) {
      break;
    }
    // biome-ignore lint/performance/noAwaitInLoops: servers are checked one at a time so two never compete for the CPU.
    rows.push(...(await checkOne(target, routes, command, hooks)));
  }
  return rows;
}
