// Does:  Holds a scope's registrations (routes, hooks, error handler, child plugins) until listen builds the runtime.
// Holds: A sealed scope refuses every registration, and one scope has at most one error handler.

import { checkContract } from '../contract/checks.ts';
import type { Access, ContractRoutes, RouteDefinition, RouteInfo } from '../contract/types.ts';
import { type ResolvedCors, resolveCors } from '../cors/policy.ts';
import { type ResolvedCsrf, resolveCsrf } from '../csrf/policy.ts';
import type { RuntimeHandler } from '../lifecycle/types.ts';
import type { Logger } from '../log/types.ts';
import { BootError } from './boot-error.ts';
import type { DisposalState } from './disposal.ts';
import { MAX_TIMER_MS, resolveOrigins } from './options.ts';
import type {
  ErrorHandler,
  HookName,
  OnErrorHook,
  OnRequestHook,
  OnResponseHook,
  OnSendHook,
  Plugin,
  PreHandlerHook,
  RoutesOptions,
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
  readonly redirectOrigins: readonly string[] | null;
  readonly cors: ResolvedCors | false | null;
  readonly csrf: ResolvedCsrf | null;
  readonly csrfExempt: boolean;
}

export interface ChildScope {
  readonly plugin: Plugin;
  readonly state: ScopeState;
}

export interface ScopeState {
  readonly name: string;
  readonly disposal: DisposalState;
  readonly log: Logger;
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

export function createScopeState(name: string, parent: ScopeState | null, log: Logger): ScopeState {
  return {
    name,
    disposal: parent?.disposal ?? { abort: new AbortController(), callbacks: [] },
    log,
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

// Does:  The options one routes() call applies to all of its routes, each checked and null when not set.
interface GroupOptions {
  readonly redirectOrigins: readonly string[] | null;
  readonly cors: ResolvedCors | false | null;
  readonly csrf: ResolvedCsrf | null;
  readonly csrfExempt: ReadonlySet<string>;
}

function exemptNames(contract: ContractRoutes, names: unknown, where: string): ReadonlySet<string> {
  if (names === undefined) {
    return new Set();
  }
  if (!Array.isArray(names)) {
    throw new BootError(
      'INVALID_OPTION',
      `Invalid route option csrfExempt${where}: must be an array of route names`,
      null,
      null,
    );
  }
  for (const name of names) {
    if (typeof name !== 'string' || !Object.hasOwn(contract, name)) {
      throw new BootError(
        'INVALID_OPTION',
        `Invalid route option csrfExempt${where}: ${String(name)}: no such route`,
        null,
        null,
      );
    }
  }
  return new Set(names);
}

function groupOptions(
  contract: ContractRoutes,
  options: Pick<RoutesOptions<ContractRoutes>, 'redirectOrigins' | 'cors' | 'csrf'>,
  exempt: unknown,
): GroupOptions {
  const names = Object.keys(contract);
  const where = ` (${names.length === 1 ? 'route' : 'routes'} ${names.join(', ')})`;
  const origins = options.redirectOrigins;
  return {
    redirectOrigins: origins === undefined ? null : resolveOrigins(origins, `route option redirectOrigins${where}`),
    cors: resolveCors(options.cors, 'route option cors', where),
    csrf: resolveCsrf(options.csrf, 'route option csrf', where),
    csrfExempt: exemptNames(contract, exempt, where),
  };
}

function toRouteRecords(
  contract: ContractRoutes,
  handlers: ErasedHandlers,
  bodyLimits: RouteLimits,
  timeouts: RouteLimits,
  group: GroupOptions,
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
      redirectOrigins: group.redirectOrigins,
      cors: group.cors,
      csrf: group.csrf,
      csrfExempt: group.csrfExempt.has(name),
    };
  });
}

// Does:  Copies a policy access into a frozen object of its two names; another value is kept for the checks to refuse.
function snapshotAccess(access: Access): Access {
  if (typeof access !== 'object' || access === null) {
    return access;
  }
  const { policy, action } = access;
  return Object.freeze({ policy, action });
}

// Why: A field is read once, so an accessor cannot show one value to the checks and register another.
function snapshotRoute(definition: RouteDefinition): RouteDefinition {
  const { method, path, params, query, headers, cookies, body, responses, access } = definition;
  return Object.freeze({
    method,
    path,
    responses: Object.freeze({ ...responses }),
    ...(access === undefined ? {} : { access: snapshotAccess(access) }),
    ...(params === undefined ? {} : { params }),
    ...(query === undefined ? {} : { query }),
    ...(headers === undefined ? {} : { headers }),
    ...(cookies === undefined ? {} : { cookies }),
    ...(body === undefined ? {} : { body }),
  });
}

// Does:  Copies a contract's route definitions once; the copies are what routes() checks and registers.
function snapshotContract(contract: ContractRoutes): ContractRoutes {
  return Object.freeze(
    Object.fromEntries(Object.entries(contract).map(([name, definition]) => [name, snapshotRoute(definition)])),
  );
}

export function createScope(state: ScopeState): Scope {
  return {
    signal: state.disposal.abort.signal,
    log: state.log,
    onClose(callback) {
      assertOpen(state, 'onClose');
      if (typeof callback !== 'function') {
        throw new TypeError('onClose requires a function');
      }
      state.disposal.callbacks.push({ name: state.name, callback });
    },
    routes(contract, handlers, options) {
      assertOpen(state, 'routes');
      const routes = snapshotContract(contract);
      // Why: A contract object can reach routes() without having passed defineContract, so it is checked again here.
      checkContract(routes);
      // biome-ignore lint/nursery/noUnsafeTypeAssertion: the one erasure point; Handlers<C> is typed per route, the runtime reads handlers by name
      const erased = handlers as unknown as ErasedHandlers;
      const group = groupOptions(routes, options ?? {}, options?.csrfExempt);
      state.routes.push(
        ...toRouteRecords(routes, erased, options?.bodyLimits ?? {}, options?.handlerTimeouts ?? {}, group),
      );
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
      state.children.push({ plugin, state: createScopeState(name, state, state.log) });
    },
  };
}
