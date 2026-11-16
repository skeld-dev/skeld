// Does:  Builds the engine runtime at listen: schema checks, validators, serializers, limits and the router.
// Holds: Schemas are compiled here and nowhere else, from the declaration only, and the result is frozen.

import type { BlockList } from 'node:net';
import { declare, end, mark, start } from '#diag';
import { parsePath } from '../contract/path.ts';
import type { RouteDefinition, RouteInfo } from '../contract/types.ts';
import { type CorsRoute, corsRoute } from '../cors/grant.ts';
import { type CsrfRoute, csrfRoute, isUnsafeMethod } from '../csrf/check.ts';
import { createDeadlines, type Deadlines } from '../lifecycle/deadline.ts';
import { expire } from '../lifecycle/error-path.ts';
import type { EngineRuntime, HookChains, RouteGateRuntime, RouteRuntime } from '../lifecycle/types.ts';
import { partSchemasOf } from '../log/classified.ts';
import type { ServerLog } from '../log/shapes.ts';
import { createRouter } from '../router/router.ts';
import type { Router } from '../router/types.ts';
import { derivedBodyCap } from '../compile/body-cap.ts';
import { checkRouteSchemas } from '../compile/boot-checks.ts';
import { SchemaCompileError } from '../compile/compile-error.ts';
import { probeCodegen } from '../compile/generate.ts';
import type { RequestValidators, ResponseSerializers } from '../compile/types.ts';
import { compileResponseSerializers, getErrorBodySerializer } from '../compile/serializers.ts';
import { compileRequestValidators } from '../compile/validators.ts';
import { BootError } from './boot-error.ts';
import { causeMessage } from './cause-message.ts';
import { pluginName, type RouteRecord, type ScopeState } from './scope.ts';
import type { ErrorHandler, ResolvedServerOptions } from './types.ts';

// Does:  Whether the server has a gate, and the route gate each route was bound to at listen.
export interface RouteGates {
  readonly gated: boolean;
  readonly bound: ReadonlyMap<RouteRecord, RouteGateRuntime | null>;
}

// Why: A runtime built without route gates is the runtime of a server without a gate.
const NO_GATE: RouteGates = Object.freeze({ gated: false, bound: new Map() });

const NO_HOOKS: HookChains = { onRequest: [], preHandler: [], onSend: [], onResponse: [], onError: [] };

const CODEGEN_UNAVAILABLE_MESSAGE =
  'Code generation from strings is disabled in this process (node --disallow-code-generation-from-strings or an equivalent policy). @skeld/core/server compiles its validators and serializers at listen and cannot start; the schema, contract and client subpaths run without it.';

function describe(info: RouteInfo): string {
  return `${info.name} (${info.method} ${info.path})`;
}

function refuseSchemaFindings(info: RouteInfo, plugin: string | null, definition: RouteDefinition): void {
  const found = checkRouteSchemas(definition);
  if (found === null) {
    return;
  }
  const { part, finding } = found;
  const message = `Route ${describe(info)}: ${part} schema at "${finding.pointer}": ${finding.message}`;
  throw new BootError(finding.code, message, info, plugin);
}

// Does:  Returns the smaller of the configured limit and the cap derived from the route's body schema.
function effectiveBodyLimit(configured: number, definition: RouteDefinition): number {
  return definition.body === undefined ? configured : Math.min(configured, derivedBodyCap(definition.body));
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

// Why: A parent scope's hooks run before its children's, and a scope never sees a sibling's hooks.
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

// Why: The nearest scope's error handler is tried first, then its ancestors'.
function extendErrorHandlers(parent: readonly ErrorHandler[], state: ScopeState): readonly ErrorHandler[] {
  return Object.freeze(state.errorHandler === null ? parent : [state.errorHandler, ...parent]);
}

function routeCors(route: RouteRecord, options: ResolvedServerOptions): CorsRoute | null {
  const policy = route.cors ?? options.cors;
  return policy === false || policy === null ? null : corsRoute(policy, route.definition);
}

// Does:  Builds the cross-site check of a route; null for a safe method or an exempt route, which are never checked.
function routeCsrf(route: RouteRecord, plugin: string | null, options: ResolvedServerOptions): CsrfRoute | null {
  const { info } = route;
  if (route.csrf?.strict === true && options.publicOrigin.length === 0) {
    throw new BootError(
      'INVALID_OPTION',
      `Invalid route option csrf.mode (route ${info.name}): strict needs the server option publicOrigin`,
      info,
      plugin,
    );
  }
  // Why: A group's policy replaces the server's whole, so an unstated mode would silently weaken a strict server.
  if (options.csrf.strict && route.csrf !== null && !route.csrf.modeStated) {
    throw new BootError(
      'INVALID_OPTION',
      `Invalid route option csrf.mode (route ${info.name}): must be stated, because the server's csrf mode is strict`,
      info,
      plugin,
    );
  }
  if (route.csrfExempt || !isUnsafeMethod(info.method)) {
    return null;
  }
  return csrfRoute(route.csrf ?? options.csrf, options.publicOrigin);
}

function toRouteRuntime(
  route: RouteRecord,
  state: ScopeState,
  hooks: HookChains,
  errorHandlers: readonly ErrorHandler[],
  options: ResolvedServerOptions,
  deadlines: Deadlines,
  gates: RouteGates,
): RouteRuntime {
  const { info, definition } = route;
  const plugin = pluginName(state);
  const schemaChecks = start('boot.schema_checks', info.name);
  mark();
  try {
    refuseSchemaFindings(info, plugin, definition);
  } finally {
    end(schemaChecks);
  }
  const compileValidators = start('boot.compile_validators', info.name);
  mark();
  let validators: RequestValidators;
  try {
    validators = compiled(info, plugin, () => compileRequestValidators(definition));
  } finally {
    end(compileValidators);
  }
  const compileSerializers = start('boot.compile_serializers', info.name);
  mark();
  let serializers: ResponseSerializers;
  try {
    serializers = compiled(info, plugin, () => compileResponseSerializers(definition));
  } finally {
    end(compileSerializers);
  }
  const bodyCap = start('boot.body_cap');
  mark();
  const bodyLimit = effectiveBodyLimit(route.bodyLimit ?? options.bodyLimit, definition);
  end(bodyCap);
  mark();
  const timeoutMs = route.timeoutMs ?? options.handlerTimeoutMs;
  return Object.freeze({
    info: Object.freeze(info),
    definition,
    handler: route.handler,
    gate: gates.bound.get(route) ?? null,
    gated: gates.gated,
    validators,
    serializers,
    bodyLimit,
    readsBody: definition.body !== undefined,
    timeoutMs,
    redirectOrigins: route.redirectOrigins ?? options.redirectOrigins,
    cors: routeCors(route, options),
    csrf: routeCsrf(route, plugin, options),
    waiting: deadlines.queue(timeoutMs),
    hooks,
    errorHandlers,
    scopeName: state.name,
    partSchemas: partSchemasOf(definition),
  });
}

// Does:  Adds the path template of every route of a scope and its plugins to the set.
function addTemplates(state: ScopeState, templates: Set<string>): Set<string> {
  for (const route of state.routes) {
    templates.add(route.info.path);
  }
  for (const child of state.children) {
    addTemplates(child.state, templates);
  }
  return templates;
}

function addScope(
  router: Router<RouteRuntime>,
  state: ScopeState,
  parentHooks: HookChains,
  parentErrorHandlers: readonly ErrorHandler[],
  options: ResolvedServerOptions,
  deadlines: Deadlines,
  gates: RouteGates,
): boolean {
  let anyCors = false;
  const hooks = extendChains(parentHooks, state);
  const errorHandlers = extendErrorHandlers(parentErrorHandlers, state);
  for (const route of state.routes) {
    const runtime = toRouteRuntime(route, state, hooks, errorHandlers, options, deadlines, gates);
    anyCors ||= runtime.cors !== null;
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
    const declared = start('boot.declare');
    mark();
    declare(info, route.definition);
    end(declared);
  }
  for (const child of state.children) {
    anyCors = addScope(router, child.state, hooks, errorHandlers, options, deadlines, gates) || anyCors;
  }
  return anyCors;
}

export function buildRuntime(
  root: ScopeState,
  options: ResolvedServerOptions,
  trustProxy: BlockList | null,
  isClosing: () => boolean,
  log: ServerLog,
  gates: RouteGates = NO_GATE,
): EngineRuntime {
  const span = start('boot.runtime');
  mark();
  try {
    // Why: One probe before any route, so a runtime that forbids code generation fails with one clear boot error.
    const unavailable = probeCodegen();
    if (unavailable !== null) {
      throw new BootError('CODEGEN_UNAVAILABLE', CODEGEN_UNAVAILABLE_MESSAGE, null, null, { cause: unavailable });
    }
    const router = createRouter<RouteRuntime>();
    const deadlines = createDeadlines(expire);
    const preflight = addScope(router, root, NO_HOOKS, [], options, deadlines, gates);
    log.ready([...addTemplates(root, new Set())], process.cwd());
    const errorSerializerSpan = start('boot.error_serializer');
    mark();
    const errorSerializer = getErrorBodySerializer();
    end(errorSerializerSpan);
    mark();
    return Object.freeze({
      router,
      maxParamLength: options.maxParamLength,
      errorSerializer,
      isClosing,
      deadlines,
      trustProxy,
      securityHeaders: options.securityHeaders,
      preflight,
      notices: { publicOrigin: false },
      log,
    });
  } finally {
    end(span);
    mark();
  }
}
