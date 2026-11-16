// Does:  Registers auth's ten security events at boot, each under its contracted name and severity.
// Holds: The ten names are registered once, in one boot, through the server's own event registry.

import type { GateBoot } from '@skeld/core/gate';
import type { AuthEvents } from './internal-types.ts';

export function registerEvents(boot: GateBoot): AuthEvents {
  return Object.freeze({
    signinSucceeded: boot.event('auth.signin.succeeded', 'info'),
    signinFailed: boot.event('auth.signin.failed', 'warn'),
    limitRefused: boot.event('auth.limit.refused', 'warn'),
    sessionRevoked: boot.event('auth.session.revoked', 'info'),
    credentialChanged: boot.event('auth.credential.changed', 'info'),
    subjectChanged: boot.event('auth.subject.changed', 'warn'),
    callbackFailed: boot.event('auth.callback.failed', 'error'),
    oidcProviderRefused: boot.event('auth.oidc.provider_refused', 'error'),
    keysUnavailable: boot.event('auth.keys.unavailable', 'error'),
    storeFailed: boot.event('auth.store.failed', 'error'),
  });
}
