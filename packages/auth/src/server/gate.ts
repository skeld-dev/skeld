// Does:  Builds the gate auth gives one server: its boot, which assembles the runtime, its disposer, and route binding.
// Holds: Auth closes the store only once it attached it, and never boots twice or for a second server.

import { GateFault } from '@skeld/core/gate';
import type { Gate, GateBoot, GateFinding, GateRoute, RouteGate } from '@skeld/core/gate';
import { createLimits } from '../limit/limits.ts';
import { bindPolicies } from '../policy/bind.ts';
import type { AnyPolicy, Principal } from '../policy/types.ts';
import { oidcRoutes, sessionRoutes } from '../routes/routes.ts';
import { StoreFailure } from '../store/store.ts';
import type { AttachResult, StoreEvent } from '../store/types.ts';
import { AuthError } from '../auth-error/auth-error.ts';
import type { Centre, Runtime } from './centre.ts';
import { createRouteBinder, type RouteBinder } from './identify.ts';
import { storeUnavailable } from '../store/unavailable.ts';
import { registerEvents } from './events.ts';
import type { PartDeps, PartSessions } from './internal-types.ts';
import { OptionFault } from './option-fault.ts';
import { checkOptions } from './options.ts';
import type { AuthAccessOf, AuthOptions } from './types.ts';

// Why: Auth's public routes that read the session cookie; core cannot see that they do, so the gate checks their group.
const COOKIE_ROUTES: readonly GateRoute['info'][] = [
  { name: 'authSessionClear', ...sessionRoutes.authSessionClear },
  { name: 'authOidcStart', ...oidcRoutes.authOidcStart },
  { name: 'authOidcCallback', ...oidcRoutes.authOidcCallback },
];

const ATTACH_FINDINGS: { readonly [K in Exclude<AttachResult['kind'], 'attached'>]: string } = Object.freeze({
  in_use: 'in use',
  not_installed: 'not installed',
  mismatch: 'version mismatch',
});

// Does:  Runs one boot step and turns the OptionFault it throws into the GateFault core reads.
function step<T>(run: () => T): T {
  try {
    return run();
  } catch (error) {
    if (error instanceof OptionFault) {
      throw new GateFault(error.component, error.finding);
    }
    throw error;
  }
}

function isCookieRoute(info: GateRoute['info']): boolean {
  return COOKIE_ROUTES.some(
    (route) => route.name === info.name && route.method === info.method && route.path === info.path,
  );
}

// Does:  Runs every callback concurrently and rejects with all of their failures once each has settled.
async function settleAll(callbacks: readonly (() => void | Promise<void>)[]): Promise<void> {
  const results = await Promise.allSettled(callbacks.map((callback) => Promise.try(callback)));
  const failures = results.flatMap((result) => (result.status === 'rejected' ? [result.reason] : []));
  if (failures.length !== 0) {
    throw new AggregateError(failures, 'auth disposal failed');
  }
}

export function createGate<G extends AuthAccessOf<never>>(
  options: AuthOptions<readonly AnyPolicy[], string>,
  centre: Centre,
  sessions: PartSessions,
): Gate<G> {
  let routes: RouteBinder | null = null;
  return Object.freeze({
    async boot(context: GateBoot): Promise<void> {
      if (!centre.claim()) {
        throw new GateFault('auth', 'already booted');
      }
      const partDisposers: (() => void | Promise<void>)[] = [];
      let release: (() => Promise<void>) | null = null;
      let opened = false;
      try {
        const checked = step(() => checkOptions(options, context.publicOrigin));
        const { store, session } = checked;
        const events = registerEvents(context);
        const onFailure = (event: StoreEvent): void => {
          events.storeFailed(context.log, {
            'auth.operation': event.operation,
            'auth.cause': event.cause,
            'auth.code': event.code ?? undefined,
          });
        };
        let attached: AttachResult;
        try {
          attached = await store.attach({ onFailure });
        } catch (error) {
          storeUnavailable(events, context.log, error);
          const unreadable = error instanceof StoreFailure && error.reason === 'record';
          throw new GateFault('store', unreadable ? 'version unreadable' : 'unavailable');
        }
        if (attached.kind !== 'attached') {
          throw new GateFault('store', ATTACH_FINDINGS[attached.kind]);
        }
        release = () => settleAll([...partDisposers, () => store.close()]);
        // Why: A server that began closing while attach ran rolls back; it finds the store released, not left open.
        if (context.signal.aborted) {
          return;
        }
        const binder = step(() => bindPolicies(checked.policies, { events }));
        const limits = createLimits({
          store: store.ops,
          events,
          log: context.log,
          rules: checked.rules,
          addressLimit: checked.addressLimit,
        });
        const deps: PartDeps = Object.freeze({
          store: store.ops,
          sessions,
          limits,
          events,
          log: context.log,
          signal: context.signal,
          origin: checked.origin,
          cookieName: session.cookieName,
          onClose(callback: () => void | Promise<void>): void {
            partDisposers.push(callback);
          },
        });
        const apiKeys = step(() => checked.apiKeys?.attach(deps) ?? null);
        const jwt = step(() => checked.jwt?.attach(deps) ?? null);
        step(() => checked.oidc?.attach(deps));
        const dispose = release;
        context.onClose(() => {
          centre.close();
          return dispose();
        });
        release = null;
        opened = true;
        const runtime: Runtime = Object.freeze({
          store: store.ops,
          events,
          log: context.log,
          shutdown: context.signal,
          session,
          limits,
          binder,
          apiKeys,
          jwt,
        });
        routes = createRouteBinder(runtime);
        centre.open(runtime);
      } finally {
        if (!opened) {
          centre.close();
        }
        if (release !== null) {
          await release();
        }
      }
    },

    bind(route: GateRoute): RouteGate<Principal> | GateFinding | null {
      const { access, csrf, info } = route;
      if (access === 'public' && isCookieRoute(info) && csrf.exempt) {
        return { finding: 'cookie route listed in csrfExempt' };
      }
      if (access === 'public' && isCookieRoute(info) && !csrf.strict) {
        return { finding: 'cookie route outside a strict csrf group' };
      }
      if (routes === null) {
        throw new AuthError('NOT_READY');
      }
      return routes(route);
    },
  });
}
