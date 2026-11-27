// Does:  Defines createServer: the root scope, its log, the boot of listen and the drain of its HTTP server.
// Holds: listen boots plugins, gate, route callbacks, runtime, then binds; the HTTP server drains before disposers run.

import { bindRoutes, bootGate, resolveGate } from '../gate/boot.ts';
import { handleRequest } from '../lifecycle/handle-request.ts';
import type { EngineRuntime } from '../lifecycle/types.ts';
import { resolveLog } from '../log/options.ts';
import { createServerLog } from '../log/server-log.ts';
import { BootError } from './boot-error.ts';
import { bootRootPlugins } from './boot.ts';
import { createScopeEvents } from './events.ts';
import { createHttpServer } from './listen.ts';
import { resolveListenOptions, resolveServerOptions, resolveTrustProxy } from './options.ts';
import { createRootRun } from './root-run.ts';
import { callRoutesCallbacks } from './routes-callbacks.ts';
import { buildRuntime } from './runtime.ts';
import { createRootState, createScope } from './scope.ts';
import type { AccessTypes, NoAccess } from '../gate/types.ts';
import type { LogStats } from '../log/types.ts';
import type { HttpServerHandle, ListeningAddress, ListenOptions, Server, ServerOptions } from './types.ts';

export type { Empty, OutgoingCookie, RouteInfo } from '../contract/types.ts';
export type { AccessTypes, NoAccess } from '../gate/types.ts';
export type { RequestPart } from '../log/types.ts';
export type {
  AuthorHeaderName,
  CompletedContext,
  CorsHeaderName,
  CorsPolicy,
  CsrfPolicy,
  ErrorContext,
  ErrorHandler,
  GatedHandler,
  GatedHandlers,
  GatedRequest,
  Handler,
  Handlers,
  HookName,
  ListeningAddress,
  ListenOptions,
  OnErrorHook,
  OnRequestHook,
  OnResponseHook,
  OnSendHook,
  OutgoingHeaders,
  PartKey,
  Plugin,
  PreHandlerHook,
  RawCookies,
  RawHeaders,
  RawReply,
  RegisterOptions,
  ReservedHeaderName,
  RequestContext,
  ResponseContext,
  RouteReply,
  RouteRequest,
  RoutesOptions,
  Scope,
  Server,
  ServerOptions,
  ValidatedContext,
} from './types.ts';

/**
 * Creates a server, the root scope of a service; nothing listens until `listen`.
 * Throws BootError `INVALID_OPTION` for an option out of range or malformed, or `csrf.mode: 'strict'` without `publicOrigin`.
 * @example const server = createServer({ bodyLimit: 65_536 }); await server.listen({ port: 0 }); await server.close();
 */
export function createServer<A extends AccessTypes = NoAccess>(options?: ServerOptions<A>): Server<A>;
// Why: A last overload without a gate keeps ReturnType<typeof createServer> the gate-less Server it was before gates.
export function createServer(options?: ServerOptions): Server;
export function createServer(options: ServerOptions = {}): Server {
  const resolved = resolveServerOptions(options);
  const gate = resolveGate(options.gate);
  const trustProxy = resolveTrustProxy(options.trustProxy);
  const log = createServerLog(resolveLog(options.log));
  const root = createRootState(log.logger(null), createScopeEvents(log), resolved.pluginCloseTimeoutMs, 'listen');
  let handle: HttpServerHandle | null = null;
  let runtime: EngineRuntime | null = null;
  const run = createRootRun({ root, log, options: resolved, drain });

  function listen(listenOptions: ListenOptions): Promise<ListeningAddress> {
    return run.start(
      () => {
        const target = resolveListenOptions(listenOptions);
        return () => startListening(target.host, target.port);
      },
      (address) => log.listening(address.host, address.port),
    );
  }

  async function startListening(host: string, port: number): Promise<ListeningAddress> {
    await bootRootPlugins(root, resolved.pluginTimeoutMs);
    if (gate !== null) {
      await bootGate(gate, root, resolved, log);
    }
    if (run.closing()) {
      throw new BootError('SERVER_CLOSED', 'Server closed during startup', null, null);
    }
    callRoutesCallbacks(root);
    const gates = { gated: gate !== null, bound: bindRoutes(gate, root, resolved) };
    const built = buildRuntime(root, resolved, trustProxy, run.closing, log, gates);
    runtime = built;
    handle = createHttpServer(resolved, (req, res) => handleRequest(built, req, res));
    return handle.listen(host, port, root.disposal.abort.signal);
  }

  async function drain(): Promise<void> {
    try {
      await handle?.close(resolved.closeTimeoutMs);
    } finally {
      runtime?.deadlines.stop();
    }
  }

  function logStats(): LogStats {
    return log.stats();
  }

  return { ...createScope(root), listen, close: run.close, logStats };
}
