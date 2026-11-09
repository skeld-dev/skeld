import { end, open, start } from '#diag';
import { handleRequest } from '../lifecycle/handle-request.ts';
import { BootError } from './boot-error.ts';
import { bootPlugins } from './boot.ts';
import { createHttpServer } from './listen.ts';
import { resolveListenOptions, resolveServerOptions } from './options.ts';
import { buildRuntime } from './runtime.ts';
import { createScope, createScopeState } from './scope.ts';
import type { HttpServerHandle, ListeningAddress, ListenOptions, Server, ServerOptions } from './types.ts';

export type { Empty, RouteInfo } from '../contract/types.ts';
export type {
  CompletedContext,
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
  RawHeaders,
  RawReply,
  RegisterOptions,
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

export function createServer(options: ServerOptions = {}): Server {
  const resolved = resolveServerOptions(options);
  const root = createScopeState('root', null);
  let listenCalled = false;
  let closing = false;
  let closed: Promise<void> | null = null;
  let handle: HttpServerHandle | null = null;

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
    open(resolved);
    const plugins = start('boot.plugins');
    try {
      await bootPlugins(root, resolved.pluginTimeoutMs);
    } finally {
      end(plugins);
    }
    const runtime = buildRuntime(root, resolved, () => closing);
    if (closing) {
      throw new BootError('SERVER_CLOSED', 'listen() was called after close()', null, null);
    }
    handle = createHttpServer(resolved, (req, res) => handleRequest(runtime, req, res));
    return handle.listen(target.host, target.port);
  }

  function close(): Promise<void> {
    if (closed === null) {
      closing = true;
      closed = handle === null ? Promise.resolve() : handle.close(resolved.closeTimeoutMs);
    }
    return closed;
  }

  return { ...createScope(root), listen, close };
}
