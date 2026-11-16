// Does:  Checks the OIDC part's options at boot and resolves each provider's fixed addresses, scope and cookie.
// Holds: Every outbound address of a provider comes from its configured issuer; nothing a request sends chooses one.

import { checkRedirect } from '@skeld/core/redirect';
import { expose, Secret } from '@skeld/core/secret';
import { discoveryAddress } from '../outbound/discovery.ts';
import { type ConfiguredUrl, configuredUrl, isJsonObject, type JsonObject } from '../outbound/outbound.ts';
import { OptionFault } from '../server/option-fault.ts';
import { firstUnknownKey } from '../server/unknown-key.ts';
import type { OidcOptions, OidcResolveUser } from './types.ts';

const OPTION_KEYS = new Set(['providers', 'failurePath', 'returnPath', 'resolveUser']);
const PROVIDER_KEYS = new Set(['issuer', 'clientId', 'clientSecret', 'scopes']);
const PROVIDER_NAME = /^[a-z][a-z0-9]{0,31}$/;
const CLIENT_ID = /^[\x21-\x7e]{1,255}$/;
// Why: RFC 6749 section 3.3 scope-token characters; scopes are sent joined by spaces.
const SCOPE = /^[\x21\x23-\x5b\x5d-\x7e]{1,64}$/;
const MAX_PROVIDERS = 16;
const MAX_SCOPES = 16;
const MAX_ISSUER = 255;
const MAX_SECRET = 512;

export interface ProviderPolicy {
  readonly name: string;
  readonly issuer: string;
  readonly clientId: string;
  readonly clientSecret: Secret<string>;
  readonly scope: string;
  readonly discovery: ConfiguredUrl;
  readonly redirectUri: string;
  readonly cookieName: string;
}

export interface OidcPolicy {
  readonly providers: ReadonlyMap<string, ProviderPolicy>;
  readonly failurePath: string;
  readonly returnPath: string;
  readonly resolveUser: OidcResolveUser;
}

function fault(finding: string): OptionFault {
  return new OptionFault('oidc', finding);
}

function refuseUnknown(value: JsonObject, known: ReadonlySet<string>, path: string, typeName: string): void {
  const unknown = firstUnknownKey(value, known);
  if (unknown !== null) {
    throw fault(`${path}.${unknown}: is not a key of ${typeName}`);
  }
}

function localPath(value: unknown, path: string): string {
  const verdict = checkRedirect(value);
  if (verdict.kind !== 'ok' || !verdict.location.startsWith('/') || /[?#]/.test(verdict.location)) {
    throw fault(`${path}: must be a local path with no query or fragment`);
  }
  return verdict.location;
}

function checkIssuer(value: unknown, path: string): string {
  const url = typeof value === 'string' && value.length <= MAX_ISSUER ? URL.parse(value) : null;
  if (
    typeof value !== 'string' ||
    url === null ||
    url.protocol !== 'https:' ||
    url.username !== '' ||
    url.password !== '' ||
    /[?#]/.test(value)
  ) {
    throw fault(`${path}: must be an https URL of at most 255 characters with no query, fragment or userinfo`);
  }
  return value;
}

function checkScopes(value: unknown, path: string): string {
  if (value === undefined) {
    return 'openid';
  }
  const list: readonly unknown[] = Array.isArray(value) ? value : [{}];
  const scopes = list.filter((scope): scope is string => typeof scope === 'string' && SCOPE.test(scope));
  const repeated = new Set(scopes).size !== scopes.length;
  if (scopes.length !== list.length || scopes.length > MAX_SCOPES || repeated || scopes.includes('openid')) {
    throw fault(`${path}: must be at most 16 scope tokens of 1 to 64 characters, each once, openid not listed`);
  }
  return ['openid', ...scopes].join(' ');
}

function checkProvider(name: string, value: unknown, origin: string, cookieName: string): ProviderPolicy {
  const path = `oidc.providers.${name}`;
  if (!PROVIDER_NAME.test(name)) {
    throw fault('oidc.providers: each name must be 1 to 32 characters of a-z and 0-9, a letter first');
  }
  if (!isJsonObject(value)) {
    throw fault(`${path}: must be an object`);
  }
  refuseUnknown(value, PROVIDER_KEYS, path, 'OidcProvider');
  const issuer = checkIssuer(value.issuer, `${path}.issuer`);
  const { clientId, clientSecret } = value;
  if (typeof clientId !== 'string' || !CLIENT_ID.test(clientId)) {
    throw fault(`${path}.clientId: must be 1 to 255 characters from U+0021 to U+007E`);
  }
  const secret: unknown = clientSecret instanceof Secret ? expose(clientSecret) : null;
  if (!(clientSecret instanceof Secret) || typeof secret !== 'string' || secret === '' || secret.length > MAX_SECRET) {
    throw fault(`${path}.clientSecret: must be a Secret of 1 to 512 characters`);
  }
  const discovery = configuredUrl(discoveryAddress(issuer));
  if (discovery === null) {
    throw fault(`${path}.issuer: must give an https discovery address`);
  }
  return Object.freeze({
    name,
    issuer,
    clientId,
    clientSecret: new Secret(secret),
    scope: checkScopes(value.scopes, `${path}.scopes`),
    discovery,
    redirectUri: `${origin}/auth/oidc/${name}/callback`,
    cookieName: `${cookieName}-oidc-${name}`,
  });
}

export function checkOidcOptions(options: OidcOptions, origin: string, cookieName: string): OidcPolicy {
  const value: unknown = options;
  if (!isJsonObject(value)) {
    throw fault('oidc: must be an object');
  }
  refuseUnknown(value, OPTION_KEYS, 'oidc', 'OidcOptions');
  const { providers } = value;
  const names = isJsonObject(providers) ? Reflect.ownKeys(providers).map(String) : [];
  if (!isJsonObject(providers) || names.length === 0 || names.length > MAX_PROVIDERS) {
    throw fault('oidc.providers: must hold 1 to 16 providers');
  }
  const checked = new Map<string, ProviderPolicy>();
  for (const name of names) {
    const provider = checkProvider(name, providers[name], origin, cookieName);
    if ([...checked.values()].some((other) => other.issuer === provider.issuer)) {
      throw fault(`oidc.providers.${name}.issuer: must be unique among providers`);
    }
    checked.set(name, provider);
  }
  const { resolveUser } = options;
  if (typeof resolveUser !== 'function') {
    throw fault('oidc.resolveUser: must be a function');
  }
  const policy: OidcPolicy = {
    providers: checked,
    failurePath: localPath(value.failurePath, 'oidc.failurePath'),
    returnPath: value.returnPath === undefined ? '/' : localPath(value.returnPath, 'oidc.returnPath'),
    resolveUser,
  };
  return Object.freeze(policy);
}
