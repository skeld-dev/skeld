// Does:  Exports @skeld/auth/oidc: the OIDC part, its start and callback handlers and the identity it hands over.
// Holds: A handler serves only after attach checked the options; before it every request rejects NOT_READY.

import type { RouteRequest } from '@skeld/core/server';
import { AuthError } from '../auth-error/auth-error.ts';
import type { OidcRoutes } from '../routes/routes.ts';
import type { PartDeps } from '../server/internal-types.ts';
import { OptionFault } from '../server/option-fault.ts';
import { callback } from './callback.ts';
import { checkOidcOptions } from './options.ts';
import { type Attached, start } from './start.ts';
import type { Oidc, OidcOptions } from './types.ts';

export type {
  Oidc,
  OidcClaims,
  OidcIdentity,
  OidcOptions,
  OidcProvider,
  OidcResolution,
  OidcResolveUser,
} from './types.ts';

/**
 * Creates the OIDC part given to `createAuth`, with the handlers of `oidcRoutes`; it signs in through configured providers.
 * Its options are checked at boot (BootError `GATE_FAILED`, component `oidc`); a handler before boot rejects `NOT_READY`.
 * @example oidc({ providers: { acme: { issuer: 'https://id.example', clientId: 'app', clientSecret: new Secret('s3cret') } }, failurePath: '/login', resolveUser: () => ({ kind: 'deny' }) })
 */
export function oidc(options: OidcOptions): Oidc {
  let attached: Attached | null = null;
  const use = (): Attached => {
    if (attached === null) {
      throw new AuthError('NOT_READY');
    }
    return attached;
  };
  return Object.freeze({
    kind: 'oidc',
    attach(deps: PartDeps): void {
      if (attached !== null) {
        throw new OptionFault('oidc', 'already attached');
      }
      attached = Object.freeze({ deps, policy: checkOidcOptions(options, deps.origin, deps.cookieName) });
    },
    handlers: Object.freeze({
      authOidcStart: (request: RouteRequest<OidcRoutes['authOidcStart']>) => start(use(), request),
      authOidcCallback: (request: RouteRequest<OidcRoutes['authOidcCallback']>) => callback(use(), request),
    }),
  });
}
