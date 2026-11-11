import { declare, end, mark, start } from '#diag';
import { parsePath } from '../contract/path.ts';
import type { RouteDefinition, RouteInfo } from '../contract/types.ts';
import type { EngineRuntime, HookChains, RouteRuntime } from '../lifecycle/types.ts';
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

const NO_HOOKS: HookChains = { onRequest: [], preHandler: [], onSend: [], onResponse: [], onError: [] };

const CODEGEN_UNAVAILABLE_MESSAGE =
  'Code generation from strings is disabled in this process (node --disallow-code-generation-from-strings or an equivalent policy). @darkstart/core/server compiles its validators and serializers at listen and cannot start; the schema, contract and client subpaths run without it.';

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
  return Object.freeze({
    info: Object.freeze(info),
    definition,
    handler: route.handler,
    validators,
    serializers,
    bodyLimit,
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
    const declared = start('boot.declare');
    mark();
    declare(info, route.definition);
    end(declared);
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
  const span = start('boot.runtime');
  mark();
  try {
    const unavailable = probeCodegen();
    if (unavailable !== null) {
      throw new BootError('CODEGEN_UNAVAILABLE', CODEGEN_UNAVAILABLE_MESSAGE, null, null, { cause: unavailable });
    }
    const router = createRouter<RouteRuntime>();
    addScope(router, root, NO_HOOKS, [], options);
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
    });
  } finally {
    end(span);
    mark();
  }
}
