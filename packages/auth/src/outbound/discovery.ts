// Does:  Checks an OpenID provider's configuration document against the configured issuer and the supported profile.
// Holds: A document passes only with the exact issuer, three valid https endpoints, RS256, S256 and basic auth.

import { type ConfiguredUrl, configuredUrl, type JsonObject } from './outbound.ts';

// Why: The authorization endpoint's own query is kept, so it must not already carry a parameter the start sends.
const SENT_PARAMETERS = [
  'response_type',
  'client_id',
  'redirect_uri',
  'scope',
  'state',
  'nonce',
  'code_challenge',
  'code_challenge_method',
];

export interface ProviderConfig {
  readonly authorizationEndpoint: ConfiguredUrl;
  readonly tokenEndpoint: ConfiguredUrl;
  readonly jwksUri: ConfiguredUrl;
  readonly issParameter: boolean;
}

export type ProviderRefusal = 'issuer' | 'endpoint' | 'signing_alg' | 'pkce' | 'client_auth';

export type DiscoveryVerdict =
  | { readonly kind: 'config'; readonly config: ProviderConfig }
  | { readonly kind: 'refused'; readonly reason: ProviderRefusal };

// Why: OpenID Connect Discovery 1.0 section 4 appends the well-known path to the issuer without its trailing slash.
export function discoveryAddress(issuer: string): string {
  return `${issuer.endsWith('/') ? issuer.slice(0, -1) : issuer}/.well-known/openid-configuration`;
}

export function parseDiscovery(body: JsonObject, issuer: string): DiscoveryVerdict {
  if (body.issuer !== issuer) {
    return refused('issuer');
  }
  const authorizationEndpoint = endpoint(body.authorization_endpoint);
  const tokenEndpoint = endpoint(body.token_endpoint);
  const jwksUri = endpoint(body.jwks_uri);
  if (authorizationEndpoint === null || tokenEndpoint === null || jwksUri === null) {
    return refused('endpoint');
  }
  const query = new URL(authorizationEndpoint.href).searchParams;
  if (SENT_PARAMETERS.some((name) => query.has(name))) {
    return refused('endpoint');
  }
  if (!lists(body.id_token_signing_alg_values_supported, 'RS256')) {
    return refused('signing_alg');
  }
  if (!lists(body.code_challenge_methods_supported, 'S256')) {
    return refused('pkce');
  }
  const authMethods = body.token_endpoint_auth_methods_supported;
  if (authMethods !== undefined && !lists(authMethods, 'client_secret_basic')) {
    return refused('client_auth');
  }
  // Why: RFC 9207 section 3: only a provider that advertises the parameter must send iss in its response.
  const issParameter = body.authorization_response_iss_parameter_supported === true;
  return { kind: 'config', config: { authorizationEndpoint, tokenEndpoint, jwksUri, issParameter } };
}

function endpoint(value: unknown): ConfiguredUrl | null {
  return typeof value === 'string' ? configuredUrl(value) : null;
}

function lists(value: unknown, member: string): boolean {
  return Array.isArray(value) && value.includes(member);
}

function refused(reason: ProviderRefusal): DiscoveryVerdict {
  return { kind: 'refused', reason };
}
