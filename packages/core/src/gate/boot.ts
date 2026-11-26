// Does:  Boots a server's gate at listen and checks every route's access declaration, binding each route to the gate.
// Holds: A boot message is built from a route, a cut finding or a GateFault's judged fields; no thrown text enters it.

import { end, start } from '#diag';
import { isAccessName } from '../contract/checks.ts';
import type { RouteInfo } from '../contract/types.ts';
import { isInstance } from '../lifecycle/error-path.ts';
import type { RouteGateRuntime } from '../lifecycle/types.ts';
import type { ServerLog } from '../log/shapes.ts';
import type { Severity } from '../log/types.ts';
import { BootError } from '../server/boot-error.ts';
import { pluginName, type RouteRecord, type ScopeState } from '../server/scope.ts';
import type { ResolvedServerOptions } from '../server/types.ts';
import { GateFault } from './gate.ts';
import type { Gate, GateBoot, GateRoute, NoAccess, SecurityEvent } from './types.ts';

const FINDING_UNITS = 200;
export const MAX_EVENTS = 64;
const EVENT_UNITS = 64;
const EVENT_NAME = /^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)+$/;
const SEVERITIES: ReadonlySet<unknown> = new Set(['debug', 'info', 'warn', 'error', 'fatal'] satisfies Severity[]);
const UNPRINTABLE = /[^\x20-\x7e]/g;
const GATE_FAILED = 'gate failed';

function describe(info: RouteInfo): string {
  return `${info.name} (${info.method} ${info.path})`;
}

// Does:  Cuts a gate's text to 200 code units and replaces each code unit outside 0x20 to 0x7E with ?.
function printable(text: string): string {
  return text.slice(0, FINDING_UNITS).replace(UNPRINTABLE, '?');
}

function failed(cause: unknown, info: RouteInfo | null, plugin: string | null): BootError {
  return new BootError('GATE_FAILED', GATE_FAILED, info, plugin, { cause });
}

// Does:  Reads a thrown GateFault's two fields as own data, so no getter or proxy of the thrown value runs.
// Holds: The message is the fixed text unless the component is an access name and the finding a string.
function bootFailed(cause: unknown): BootError {
  if (!isInstance(cause, GateFault)) {
    return failed(cause, null, null);
  }
  const component: unknown = Object.getOwnPropertyDescriptor(cause, 'component')?.value;
  const finding: unknown = Object.getOwnPropertyDescriptor(cause, 'finding')?.value;
  if (!isAccessName(component) || typeof finding !== 'string') {
    return failed(cause, null, null);
  }
  return new BootError('GATE_FAILED', `${GATE_FAILED}: ${component}: ${printable(finding)}`, null, null, { cause });
}

// Does:  Checks a security event's name grammar and severity, for the gate's registry and the scopes' alike.
export function isEventRegistration(name: unknown, severity: unknown): name is string {
  return (
    typeof name === 'string' &&
    name.length <= EVENT_UNITS &&
    !name.startsWith('skeld.') &&
    EVENT_NAME.test(name) &&
    SEVERITIES.has(severity)
  );
}

// Does:  Checks the gate option at creation: absent, or an object with boot and bind functions.
export function resolveGate(gate: Gate<NoAccess> | undefined): Gate<NoAccess> | null {
  if (gate === undefined) {
    return null;
  }
  const value: unknown = gate;
  if (
    typeof value !== 'object' ||
    value === null ||
    typeof gate.boot !== 'function' ||
    typeof gate.bind !== 'function'
  ) {
    throw new BootError(
      'INVALID_OPTION',
      'Invalid server option gate: must be an object with boot and bind functions',
      null,
      null,
    );
  }
  return gate;
}

// Does:  Runs Gate.boot once under the plugin time limit with the root scope's log, signal and disposer stack.
// Holds: Events register only while boot runs; a refused registration fails the boot even when the gate catches it.
export async function bootGate(
  gate: Gate<NoAccess>,
  root: ScopeState,
  options: ResolvedServerOptions,
  log: ServerLog,
): Promise<void> {
  const names = new Set<string>();
  let booting = true;
  let refused = false;
  const context: GateBoot = Object.freeze({
    log: root.log,
    signal: root.disposal.abort.signal,
    closeTimeoutMs: options.pluginCloseTimeoutMs,
    publicOrigin: options.publicOrigin,
    onClose(callback: () => void | Promise<void>): void {
      if (typeof callback !== 'function') {
        throw new TypeError('onClose requires a function');
      }
      root.disposal.callbacks.push({ name: 'gate', callback });
    },
    event(name: string, severity: Severity): SecurityEvent {
      if (!booting) {
        throw new TypeError('GateBoot.event is callable only inside boot');
      }
      if (!isEventRegistration(name, severity) || names.has(name) || names.size >= MAX_EVENTS) {
        refused = true;
        throw new TypeError('GateBoot.event refused the name or the severity');
      }
      names.add(name);
      return Object.freeze((logger: unknown, fields?: Parameters<SecurityEvent>[1]) => {
        log.security(name, severity, logger, fields);
      });
    },
  });
  const span = start('boot.gate');
  const expiry = Promise.withResolvers<'timed-out'>();
  const timer = setTimeout(() => expiry.resolve('timed-out'), options.pluginTimeoutMs);
  let outcome: 'settled' | 'timed-out';
  try {
    const settled = Promise.try(() => gate.boot(context)).then(() => 'settled' as const);
    outcome = await Promise.race([settled, expiry.promise]);
  } catch (cause) {
    throw bootFailed(cause);
  } finally {
    clearTimeout(timer);
    booting = false;
    end(span);
  }
  if (outcome === 'timed-out' || refused) {
    throw new BootError('GATE_FAILED', GATE_FAILED, null, null);
  }
}

// Does:  Reads what Gate.bind returned for a route: null, a route gate, or the finding that refuses the route.
function bindRoute(gate: Gate<NoAccess>, gateRoute: GateRoute, plugin: string | null): RouteGateRuntime | null {
  const { info, access } = gateRoute;
  let returned: unknown;
  let finding: string | null = null;
  let gateRuntime: RouteGateRuntime | null = null;
  try {
    returned = gate.bind(gateRoute);
    if (typeof returned === 'object' && returned !== null) {
      if (Object.hasOwn(returned, 'finding')) {
        finding = findingOf(returned);
      } else {
        gateRuntime = routeGateOf(returned);
      }
    }
  } catch (cause) {
    throw failed(cause, info, plugin);
  }
  if (finding !== null) {
    throw accessRefused(info, plugin, finding);
  }
  if (gateRuntime === null) {
    // Why: Only a public route may go without a route gate; any other unlisted answer fails closed.
    if (returned === null && access === 'public') {
      return null;
    }
    throw new BootError('GATE_FAILED', GATE_FAILED, info, plugin);
  }
  if (access === 'public' || (typeof access === 'object' && gateRuntime.authorize === null)) {
    throw new BootError('GATE_FAILED', GATE_FAILED, info, plugin);
  }
  if (gateRuntime.cookie && gateRoute.csrf.exempt) {
    throw accessRefused(info, plugin, 'cookie route listed in csrfExempt');
  }
  if (gateRuntime.cookie && !gateRoute.csrf.strict) {
    throw accessRefused(info, plugin, 'cookie route outside a strict csrf group');
  }
  return gateRuntime;
}

function accessRefused(info: RouteInfo, plugin: string | null, finding: string): BootError {
  return new BootError('ACCESS_REFUSED', `Route ${describe(info)}: access refused: ${finding}`, info, plugin);
}

// Does:  The finding's printable text, or null when its finding is not a string of data.
function findingOf(returned: object): string | null {
  const finding: unknown = Object.getOwnPropertyDescriptor(returned, 'finding')?.value;
  return typeof finding === 'string' ? printable(finding) : null;
}

// Does:  Copies a route gate's four members once, each method called on the object that returned it; null if malformed.
function routeGateOf(returned: object): RouteGateRuntime | null {
  const cookie: unknown = Reflect.get(returned, 'cookie');
  const identify: unknown = Reflect.get(returned, 'identify');
  const authorize: unknown = Reflect.get(returned, 'authorize');
  const release: unknown = Reflect.get(returned, 'release');
  if (
    typeof cookie !== 'boolean' ||
    typeof identify !== 'function' ||
    (authorize !== null && typeof authorize !== 'function') ||
    (release !== null && typeof release !== 'function')
  ) {
    return null;
  }
  const runtime: RouteGateRuntime = {
    cookie,
    identify: (request) => Reflect.apply(identify, returned, [request]),
    authorize:
      authorize === null
        ? null
        : (principal, input, request) => Reflect.apply(authorize, returned, [principal, input, request]),
    release: release === null ? null : (grant) => Reflect.apply(release, returned, [grant]),
  };
  return Object.freeze(runtime);
}

function bindScope(
  gate: Gate<NoAccess> | null,
  state: ScopeState,
  options: ResolvedServerOptions,
  bound: Map<RouteRecord, RouteGateRuntime | null>,
): void {
  const plugin = pluginName(state);
  for (const route of state.routes) {
    const { info, definition } = route;
    const { access } = definition;
    if (gate === null) {
      if (access !== undefined) {
        const message = `Route ${describe(info)}: declares access on a server without a gate`;
        throw new BootError('ACCESS_WITHOUT_GATE', message, info, plugin);
      }
      continue;
    }
    if (access === undefined) {
      const message = `Route ${describe(info)}: declares no access on a server with a gate`;
      throw new BootError('ACCESS_UNDECLARED', message, info, plugin);
    }
    const csrf = Object.freeze({ strict: (route.csrf ?? options.csrf).strict, exempt: route.csrfExempt });
    const gateRoute: GateRoute = Object.freeze({ info: Object.freeze(info), definition, access, csrf });
    bound.set(route, bindRoute(gate, gateRoute, plugin));
  }
  for (const child of state.children) {
    bindScope(gate, child.state, options, bound);
  }
}

// Does:  Checks every route's access in registration order and binds each to the gate; empty without a gate.
// Holds: Every registered route is checked before any is compiled, and the first failure refuses the boot.
export function bindRoutes(
  gate: Gate<NoAccess> | null,
  root: ScopeState,
  options: ResolvedServerOptions,
): ReadonlyMap<RouteRecord, RouteGateRuntime | null> {
  const bound = new Map<RouteRecord, RouteGateRuntime | null>();
  bindScope(gate, root, options, bound);
  return bound;
}
