// Does:  Defines createServer: the root scope, listen and close.
// Holds: listen runs at most once, and a server that was closed never starts listening.

import { closed as closeDiagnostics, end, open, start } from '#diag';
import { handleRequest } from '../lifecycle/handle-request.ts';
import type { EngineRuntime } from '../lifecycle/types.ts';
import { BootError } from './boot-error.ts';
import { bootPlugins } from './boot.ts';
import { dispose } from './disposal.ts';
import { createHttpServer } from './listen.ts';
import { resolveListenOptions, resolveServerOptions, resolveTrustProxy } from './options.ts';
import { buildRuntime } from './runtime.ts';
import { createScope, createScopeState } from './scope.ts';
import type { HttpServerHandle, ListeningAddress, ListenOptions, Server, ServerOptions } from './types.ts';

export type { Empty, OutgoingCookie, RouteInfo } from '../contract/types.ts';
export type {
  AuthorHeaderName,
  CompletedContext,
  CorsHeaderName,
  CorsPolicy,
  CsrfPolicy,
  ErrorContext,
  ErrorHandler,
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
export function createServer(options: ServerOptions = {}): Server {
  const resolved = resolveServerOptions(options);
  const trustProxy = resolveTrustProxy(options.trustProxy);
  const root = createScopeState('root', null);
  let listenCalled = false;
  let closing = false;
  let closed: Promise<void> | null = null;
  let handle: HttpServerHandle | null = null;
  let runtime: EngineRuntime | null = null;
  let startup: Promise<ListeningAddress> | null = null;

  async function listen(listenOptions: ListenOptions): Promise<ListeningAddress> {
    if (closing) {
      throw new BootError('SERVER_CLOSED', 'listen() was called after close()', null, null);
    }
    if (listenCalled) {
      throw new BootError('ALREADY_LISTENING', 'listen() was already called', null, null);
    }
    const target = resolveListenOptions(listenOptions);
    listenCalled = true;
    root.sealed = true;
    startup = startListening(target.host, target.port);
    try {
      return await startup;
    } catch (cause) {
      try {
        await close();
      } catch (cleanup) {
        if (cause instanceof BootError) {
          throw new BootError(cause.code, cause.message, cause.route, cause.plugin, {
            cause: new AggregateError([cause, cleanup], 'Startup and rollback failed'),
          });
        }
        throw new AggregateError([cause, cleanup], 'Startup and rollback failed', { cause });
      }
      throw cause;
    }
  }

  async function startListening(host: string, port: number): Promise<ListeningAddress> {
    open(resolved);
    const plugins = start('boot.plugins');
    try {
      await bootPlugins(root, resolved.pluginTimeoutMs);
    } finally {
      end(plugins);
    }
    if (closing) {
      throw new BootError('SERVER_CLOSED', 'Server closed during startup', null, null);
    }
    const built = buildRuntime(root, resolved, trustProxy, () => closing);
    runtime = built;
    handle = createHttpServer(resolved, (req, res) => handleRequest(built, req, res));
    return handle.listen(host, port, root.disposal.abort.signal);
  }

  async function shutdown(): Promise<void> {
    // Why: Startup failures belong to listen; shutdown must still release everything acquired before the failure.
    await startup?.then(
      () => undefined,
      () => undefined,
    );
    const failures: unknown[] = [];
    try {
      await handle?.close(resolved.closeTimeoutMs);
    } catch (error) {
      failures.push(error);
    } finally {
      runtime?.deadlines.stop();
    }
    failures.push(...(await dispose(root.disposal, resolved.pluginCloseTimeoutMs)));
    closeDiagnostics();
    if (failures.length !== 0) {
      throw new AggregateError(failures, 'Server shutdown failed');
    }
  }

  function close(): Promise<void> {
    if (closed === null) {
      closing = true;
      root.sealed = true;
      // Why: Assign the shared promise before abort dispatch can reenter close through an author's listener.
      closed = Promise.resolve().then(shutdown);
      root.disposal.abort.abort();
    }
    return closed;
  }

  return { ...createScope(root), listen, close };
}
