// Does:  Serves the OIDC start route: checks limit, provider and return path, saves the attempt and returns the URL.
// Holds: The attempt is saved before its cookie is set; the URL is the provider's configured endpoint and nothing else.

import { HttpError } from '@skeld/core/http-error';
import { checkRedirect } from '@skeld/core/redirect';
import type { RouteReply, RouteRequest } from '@skeld/core/server';
import { readProviderConfig } from '../outbound/cache.ts';
import type { OidcRoutes } from '../routes/routes.ts';
import type { PartDeps } from '../server/internal-types.ts';
import { storeUnavailable } from '../store/unavailable.ts';
import { addressLimit, attemptCookie, notFound, unavailable } from './http.ts';
import type { OidcPolicy, ProviderPolicy } from './options.ts';
import { challengeOf, mint } from './tokens.ts';

const ATTEMPT_TTL_MS = 600_000;

type StartRoute = OidcRoutes['authOidcStart'];

export interface Attached {
  readonly deps: PartDeps;
  readonly policy: OidcPolicy;
}

// Does:  Finds a configured provider by the route's name; an inherited or unknown name is not one.
export function providerOf(policy: OidcPolicy, name: string): ProviderPolicy {
  const provider = policy.providers.get(name);
  if (provider === undefined) {
    throw notFound();
  }
  return provider;
}

function returnPathOf(policy: OidcPolicy, returnTo: string | undefined): string {
  const verdict = checkRedirect(returnTo ?? policy.returnPath);
  if (verdict.kind !== 'ok' || !verdict.location.startsWith('/')) {
    throw new HttpError(400, 'RETURN_PATH_REFUSED', 'Return path not accepted');
  }
  return verdict.location;
}

export async function start(attached: Attached, request: RouteRequest<StartRoute>): Promise<RouteReply<StartRoute>> {
  const { deps, policy } = attached;
  const limited = await addressLimit(deps, 'authOidcStart', request);
  if (limited !== null) {
    return limited;
  }
  const provider = providerOf(policy, request.params.provider);
  const returnPath = returnPathOf(policy, request.body.returnTo);
  const config = await readProviderConfig(provider.discovery, provider.issuer, (reason) => {
    deps.events.oidcProviderRefused(request.log, { 'auth.provider': provider.name, 'auth.reason': reason });
  });
  if (config.kind === 'unavailable') {
    throw new HttpError(503, 'PROVIDER_UNAVAILABLE', 'Sign-in provider unavailable');
  }
  const binding = mint();
  const state = mint();
  const nonce = mint().text;
  const verifier = mint().text;
  try {
    await deps.store.attemptCreate(
      {
        state: state.digest,
        binding: binding.digest,
        provider: provider.name,
        nonce,
        verifier,
        returnPath,
        ttlMs: ATTEMPT_TTL_MS,
      },
      request.signal,
    );
  } catch (error) {
    storeUnavailable(deps.events, request.log, error);
    throw unavailable();
  }
  const url = new URL(config.value.authorizationEndpoint.href);
  url.searchParams.append('response_type', 'code');
  url.searchParams.append('client_id', provider.clientId);
  url.searchParams.append('redirect_uri', provider.redirectUri);
  url.searchParams.append('scope', provider.scope);
  url.searchParams.append('state', state.text);
  url.searchParams.append('nonce', nonce);
  url.searchParams.append('code_challenge', challengeOf(verifier));
  url.searchParams.append('code_challenge_method', 'S256');
  return {
    status: 200,
    body: { url: url.href },
    cookies: [attemptCookie(provider.cookieName, binding.text)],
  };
}
