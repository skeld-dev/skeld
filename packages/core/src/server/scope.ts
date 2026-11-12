// Does:  Holds a scope's registrations (routes, hooks, error handler, child plugins) until listen builds the runtime.
// Holds: A sealed scope refuses every registration, and one scope has at most one error handler.

import { checkContract } from '../contract/checks.ts';
import type { ContractRoutes, RouteDefinition, RouteInfo } from '../contract/types.ts';
import type { RuntimeHandler } from '../lifecycle/types.ts';
import { BootError } from './boot-error.ts';
import type { DisposalState } from './disposal.ts';
import { MAX_TIMER_MS } from './options.ts';
import type {
  ErrorHandler,
  HookName,
  OnErrorHook,
  OnRequestHook,
  OnResponseHook,
  OnSendHook,
  Plugin,
  PreHandlerHook,
  Scope,
} from './types.ts';

interface HookTypes {
  readonly onRequest: OnRequestHook;
  readonly preHandler: PreHandlerHook;
  readonly onSend: OnSendHook;
  readonly onResponse: OnResponseHook;
  readonly onError: OnErrorHook;
}

type HookLists = { readonly [K in HookName]: HookTypes[K][] };

export interface RouteRecord {
  readonly info: RouteInfo;
  readonly definition: RouteDefinition;
  readonly handler: RuntimeHandler;
  readonly bodyLimit: number | null;
  readonly timeoutMs: number | null;
}

export interface ChildScope {
  readonly plugin: Plugin;
  readonly state: ScopeState;
}

export interface ScopeState {
  readonly name: string;
  readonly disposal: DisposalState;
  readonly parent: ScopeState | null;
  readonly children: ChildScope[];
  readonly routes: RouteRecord[];
  readonly hooks: HookLists;
  errorHandler: ErrorHandler | null;
  sealed: boolean;
}

interface ErasedHandlers {
  readonly [name: string]: RuntimeHandler;
}

export function createScopeState(name: string, parent: ScopeState | null): ScopeState {
  return {
    name,
    disposal: parent?.disposal ?? { abort: new AbortController(), callbacks: [] },
    parent,
    children: [],
    routes: [],
    hooks: { onRequest: [], preHandler: [], onSend: [], onResponse: [], onError: [] },
    errorHandler: null,
    sealed: false,
  };
}

export function pluginName(state: ScopeState): string | null {
  return state.parent === null ? null : state.name;
}

function assertOpen(state: ScopeState, method: string): void {
  if (!state.sealed && !state.disposal.abort.signal.aborted) {
    return;
  }
  const message =
    state.parent === null
      ? `Cannot call ${method}() after listen() was called`
      : `Cannot call ${method}() on scope ${state.name} after it settled`;
  throw new BootError('REGISTRATION_CLOSED', message, null, pluginName(state));
}

function routeBodyLimit(info: RouteInfo, definition: RouteDefinition, limit: number | undefined): number | null {
  if (limit === undefined) {
    return null;
  }
  if (!Number.isSafeInteger(limit) || limit <= 0) {
    throw new BootError(
      'INVALID_OPTION',
      `Invalid route option bodyLimits.${info.name}: must be a positive integer, got ${limit}`,
      info,
      null,
    );
  }
  if (definition.body === undefined) {
    throw new BootError(
      'INVALID_OPTION',
      `Invalid route option bodyLimits.${info.name}: route declares no body`,
      info,
      null,
    );
  }
  return limit;
}

function routeTimeout(info: RouteInfo, limit: number | undefined): number | null {
  if (limit === undefined) {
    return null;
  }
  if (!Number.isSafeInteger(limit) || limit <= 0 || limit > MAX_TIMER_MS) {
    throw new BootError(
      'INVALID_OPTION',
      `Invalid route option handlerTimeouts.${info.name}: must be a positive integer up to ${MAX_TIMER_MS}, got ${limit}`,
      info,
      null,
    );
  }
  return limit;
}

interface RouteLimits {
  readonly [name: string]: number | undefined;
}

function toRouteRecords(
  contract: ContractRoutes,
  handlers: ErasedHandlers,
  bodyLimits: RouteLimits,
  timeouts: RouteLimits,
): RouteRecord[] {
  for (const name of Object.keys(bodyLimits)) {
    if (!Object.hasOwn(contract, name)) {
      throw new BootError('INVALID_OPTION', `Invalid route option bodyLimits.${name}: no such route`, null, null);
    }
  }
  for (const name of Object.keys(timeouts)) {
    if (!Object.hasOwn(contract, name)) {
      throw new BootError('INVALID_OPTION', `Invalid route option handlerTimeouts.${name}: no such route`, null, null);
    }
  }
  return Object.entries(contract).map(([name, definition]) => {
    const info: RouteInfo = { name, method: definition.method, path: definition.path };
    const handler = Object.hasOwn(handlers, name) ? handlers[name] : undefined;
    if (handler === undefined) {
      throw new TypeError(`Route ${name} (${definition.method} ${definition.path}): has no handler`);
    }
    return {
      info,
      definition,
      handler,
      bodyLimit: routeBodyLimit(info, definition, Object.hasOwn(bodyLimits, name) ? bodyLimits[name] : undefined),
      timeoutMs: routeTimeout(info, Object.hasOwn(timeouts, name) ? timeouts[name] : undefined),
    };
  });
}

export function createScope(state: ScopeState): Scope {
  return {
    signal: state.disposal.abort.signal,
    onClose(callback) {
      assertOpen(state, 'onClose');
      if (typeof callback !== 'function') {
        throw new TypeError('onClose requires a function');
      }
      state.disposal.callbacks.push({ name: state.name, callback });
    },
    routes(contract, handlers, options) {
      assertOpen(state, 'routes');
      // Why: A contract object can reach routes() without having passed defineContract, so it is checked again here.
      checkContract(contract);
      // biome-ignore lint/nursery/noUnsafeTypeAssertion: the one erasure point; Handlers<C> is typed per route, the runtime reads handlers by name
      const erased = handlers as unknown as ErasedHandlers;
      state.routes.push(...toRouteRecords(contract, erased, options?.bodyLimits ?? {}, options?.handlerTimeouts ?? {}));
    },
    addHook<K extends HookName>(name: K, hook: HookTypes[K]): void {
      assertOpen(state, 'addHook');
      state.hooks[name].push(hook);
    },
    setErrorHandler(handler) {
      assertOpen(state, 'setErrorHandler');
      if (state.errorHandler !== null) {
        throw new BootError(
          'ERROR_HANDLER_ALREADY_SET',
          `An error handler is already set in scope ${state.name}`,
          null,
          pluginName(state),
        );
      }
      state.errorHandler = handler;
    },
    register(plugin, options) {
      assertOpen(state, 'register');
      const name = options?.name ?? (plugin.name === '' ? `plugin #${state.children.length + 1}` : plugin.name);
      state.children.push({ plugin, state: createScopeState(name, state) });
    },
  };
}
