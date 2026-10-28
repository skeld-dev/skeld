import { parsePath } from '../contract/path.ts';
import type { RouteInfo } from '../contract/types.ts';
import type { EngineRuntime, HookChains, RouteRuntime } from '../lifecycle/types.ts';
import { createRouter } from '../router/router.ts';
import type { Router } from '../router/types.ts';
import { SchemaCompileError } from '../schema/compile-error.ts';
import { compileResponseSerializers, getErrorBodySerializer } from '../schema/serializer.ts';
import { compileRequestValidators } from '../schema/validator.ts';
import { BootError } from './boot-error.ts';
import { causeMessage } from './cause-message.ts';
import { pluginName, type RouteRecord, type ScopeState } from './scope.ts';
import type { ErrorHandler, ResolvedServerOptions } from './types.ts';

const NO_HOOKS: HookChains = { onRequest: [], preHandler: [], onSend: [], onResponse: [], onError: [] };

function describe(info: RouteInfo): string {
  return `${info.name} (${info.method} ${info.path})`;
}

function compiled<T>(info: RouteInfo, plugin: string | null, compile: () => T): T {
  try {
    return compile();
  } catch (error) {
    if (!(error instanceof SchemaCompileError)) {
      throw error;
    }
    const message = `Route ${describe(info)}: ${error.message}: ${causeMessage(error.cause)}`;
    throw new BootError('COMPILE_FAILED', message, info, plugin, { cause: error });
  }
}

function extendChains(parent: HookChains, state: ScopeState): HookChains {
  const own = state.hooks;
  return Object.freeze({
    onRequest: Object.freeze([...parent.onRequest, ...own.onRequest]),
    preHandler: Object.freeze([...parent.preHandler, ...own.preHandler]),
    onSend: Object.freeze([...parent.onSend, ...own.onSend]),
    onResponse: Object.freeze([...parent.onResponse, ...own.onResponse]),
    onError: Object.freeze([...parent.onError, ...own.onError]),
  });
}

function extendErrorHandlers(parent: readonly ErrorHandler[], state: ScopeState): readonly ErrorHandler[] {
  return Object.freeze(state.errorHandler === null ? parent : [state.errorHandler, ...parent]);
}

function toRouteRuntime(
  route: RouteRecord,
  state: ScopeState,
  hooks: HookChains,
  errorHandlers: readonly ErrorHandler[],
  options: ResolvedServerOptions,
): RouteRuntime {
  const { info, definition } = route;
  const plugin = pluginName(state);
  return Object.freeze({
    info: Object.freeze(info),
    definition,
    handler: route.handler,
    validators: compiled(info, plugin, () => compileRequestValidators(definition)),
    serializers: compiled(info, plugin, () => compileResponseSerializers(definition)),
    bodyLimit: route.bodyLimit ?? options.bodyLimit,
    readsBody: definition.body !== undefined,
    hooks,
    errorHandlers,
    hasOnError: hooks.onError.length > 0,
    scopeName: state.name,
  });
}

function addScope(
  router: Router<RouteRuntime>,
  state: ScopeState,
  parentHooks: HookChains,
  parentErrorHandlers: readonly ErrorHandler[],
  options: ResolvedServerOptions,
): void {
  const hooks = extendChains(parentHooks, state);
  const errorHandlers = extendErrorHandlers(parentErrorHandlers, state);
  for (const route of state.routes) {
    const runtime = toRouteRuntime(route, state, hooks, errorHandlers, options);
    const { info } = route;
    const added = router.add(info.method, info.path, parsePath(info.path), runtime);
    if (added.kind === 'duplicate') {
      throw new BootError(
        'ROUTE_DUPLICATE',
        `Routes ${describe(added.existing.info)} and ${describe(info)} match the same requests`,
        info,
        pluginName(state),
      );
    }
  }
  for (const child of state.children) {
    addScope(router, child.state, hooks, errorHandlers, options);
  }
}

export function buildRuntime(
  root: ScopeState,
  options: ResolvedServerOptions,
  isClosing: () => boolean,
): EngineRuntime {
  const router = createRouter<RouteRuntime>();
  addScope(router, root, NO_HOOKS, [], options);
  return Object.freeze({
    router,
    maxParamLength: options.maxParamLength,
    errorSerializer: getErrorBodySerializer(),
    isClosing,
  });
}
