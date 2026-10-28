import { BenchError } from './bench-error.ts';
import { preflight, preflightFailure } from './preflight.ts';
import { type ServerProcess, startServer } from './server-process.ts';
import { killedWarning } from './terminal.ts';
import type { CheckRow, RouteId, ServerId } from './types.ts';

export interface CheckHooks {
  readonly interrupted: () => boolean;
  readonly track: (server: ServerProcess | null) => void;
  readonly warn: (text: string) => void;
  readonly fail: (error: BenchError) => void;
}

export function preflightRoutes(server: ServerProcess, routes: readonly RouteId[]): Promise<readonly CheckRow[]> {
  return Promise.all(routes.map((route) => preflight(server.server, server.port, route)));
}

const notStarted = (server: ServerId, routes: readonly RouteId[]): readonly CheckRow[] =>
  routes.map((route) => ({
    server,
    route,
    started: false,
    status: null,
    mediaType: null,
    bytes: null,
    body: null,
    passed: false,
  }));

const checkOne = async (
  server: ServerId,
  routes: readonly RouteId[],
  hooks: CheckHooks,
): Promise<readonly CheckRow[]> => {
  let running: ServerProcess;
  try {
    running = await startServer(server);
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
  servers: readonly ServerId[],
  routes: readonly RouteId[],
  hooks: CheckHooks,
): Promise<readonly CheckRow[]> {
  const rows: CheckRow[] = [];
  for (const server of servers) {
    if (hooks.interrupted()) {
      break;
    }
    // biome-ignore lint/performance/noAwaitInLoops: servers are checked one at a time so two never compete for the CPU.
    rows.push(...(await checkOne(server, routes, hooks)));
  }
  return rows;
}
