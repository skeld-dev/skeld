// Does:  Calls every scope's onRoutes callbacks once, at listen or a worker's start, with the routes its hooks reach.
// Holds: Each callback is called once, synchronously, with a frozen list; a throw or a returned value refuses the boot.

import type { RouteInfo } from '../contract/types.ts';
import { BootError } from './boot-error.ts';
import { causeMessage } from './cause-message.ts';
import { pluginName, type RoutesCallback, type ScopeState } from './scope.ts';

// Why: Own routes first, then each plugin's, the order runtime.ts flattens them in.
function reachedRoutes(state: ScopeState, into: RouteInfo[]): RouteInfo[] {
  for (const route of state.routes) {
    into.push(Object.freeze(route.info));
  }
  for (const child of state.children) {
    reachedRoutes(child.state, into);
  }
  return into;
}

function refused(state: ScopeState, reason: string, options?: ErrorOptions): BootError {
  const plugin = pluginName(state);
  const owner = plugin === null ? 'Server' : `Plugin ${plugin}`;
  return new BootError('PLUGIN_FAILED', `${owner} failed in onRoutes: ${reason}`, null, plugin, options);
}

function call(state: ScopeState, callback: RoutesCallback, routes: readonly RouteInfo[]): void {
  let returned: unknown;
  try {
    returned = callback(routes);
  } catch (cause) {
    throw refused(state, causeMessage(cause), { cause });
  }
  if (returned !== undefined) {
    throw refused(state, 'the callback returned a value');
  }
}

export function callRoutesCallbacks(state: ScopeState): void {
  if (state.routesCallbacks.length !== 0) {
    const routes = Object.freeze(reachedRoutes(state, []));
    for (const callback of state.routesCallbacks) {
      call(state, callback, routes);
    }
  }
  for (const child of state.children) {
    callRoutesCallbacks(child.state);
  }
}
