// Does:  Runs local TLS OpenID providers and signs the tokens they and the JWT proofs use, with answers overridable.
// Holds: Servers bind 127.0.0.1 port 0 under a throwaway certificate; every key is generated at run time.

import { createHash, createSign, generateKeyPairSync, type KeyObject, randomBytes } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createServer, type Server } from 'node:https';
import type { Leaf } from './pki.ts';

export type Json = Record<string, unknown>;

export interface PublicJwk {
  readonly kty: string;
  readonly kid: string;
  readonly alg?: string;
  readonly [member: string]: unknown;
}

export interface SigningKey {
  readonly kid: string;
  readonly privateKey: KeyObject;
  readonly jwk: PublicJwk;
}

export function rsaKey(kid: string, bits = 2048): SigningKey {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: bits });
  const jwk = publicKey.export({ format: 'jwk' });
  return { kid, privateKey, jwk: { ...jwk, kty: jwk.kty ?? 'RSA', kid, alg: 'RS256', use: 'sig' } };
}

export function ecKey(kid: string): SigningKey {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const jwk = publicKey.export({ format: 'jwk' });
  return { kid, privateKey, jwk: { ...jwk, kty: jwk.kty ?? 'EC', kid, alg: 'ES256', use: 'sig' } };
}

const b64 = (value: unknown): string =>
  Buffer.from(typeof value === 'string' ? value : JSON.stringify(value)).toString('base64url');

export function sign(header: Json, payload: Json, key: SigningKey | null): string {
  const input = `${b64(header)}.${b64(payload)}`;
  if (key === null) {
    return `${input}.`;
  }
  const signer = createSign('sha256').update(input);
  const signature =
    header.alg === 'ES256'
      ? signer.sign({ key: key.privateKey, dsaEncoding: 'ieee-p1363' })
      : signer.sign(key.privateKey);
  return `${input}.${signature.toString('base64url')}`;
}

export const nowSeconds = (): number => Math.floor(Date.now() / 1000);

export interface Reply {
  readonly req: IncomingMessage;
  readonly res: ServerResponse;
  readonly form: Record<string, string>;
  readonly json: (status: number, value: unknown, headers?: Record<string, string>) => void;
}

export interface Provider {
  readonly issuer: string;
  readonly clientId: string;
  readonly clientSecret: string;
  key: SigningKey;
  signWith: SigningKey | null;
  cacheControl: string;
  jwksCacheControl: string | null;
  subject: string;
  issParameter: boolean;
  extraToken: Json;
  readonly issued: { idTokens: string[]; accessTokens: string[]; codes: string[] };
  readonly hits: { all: number; discovery: number; jwks: number; token: number; authorize: number };
  readonly tokenRequests: {
    form: Record<string, string>;
    authorization: string | undefined;
    cookie: string | undefined;
  }[];
  readonly authorizeCookies: (string | undefined)[];
  readonly codes: Map<string, Record<string, string>>;
  docOverride: Json;
  discovery: ((reply: Reply) => void) | null;
  jwks: ((reply: Reply) => void) | null;
  token: ((reply: Reply) => void) | null;
  claims: (claims: Json) => Json;
  header: (header: Json) => Json;
  doc: () => Json;
  authorize: (startUrl: string, subject?: string) => { code: string; state: string; query: Record<string, string> };
}

export interface ProviderHost {
  readonly base: string;
  readonly server: Server;
  add: (name: string, clientId: string, clientSecret: string) => Provider;
  close: () => Promise<void>;
}

export async function providerHost(leaf: Leaf, host = 'localhost'): Promise<ProviderHost> {
  const providers = new Map<string, Provider>();
  const replies = new Map<string, Provider>();
  const server = createServer({ key: leaf.key, cert: leaf.cert }, (req, res) => {
    const url = new URL(req.url ?? '/', 'https://x');
    const [, name = '', ...rest] = url.pathname.split('/');
    const provider = providers.get(name);
    if (provider === undefined) {
      res.writeHead(404).end();
      return;
    }
    provider.hits.all += 1;
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      const path = `/${rest.join('/')}`;
      const form = Object.fromEntries(new URLSearchParams(Buffer.concat(chunks).toString('utf8')));
      const json = (status: number, value: unknown, headers: Record<string, string> = {}): void => {
        res.writeHead(status, {
          'content-type': 'application/json',
          'cache-control': provider.cacheControl,
          ...headers,
        });
        res.end(typeof value === 'string' ? value : JSON.stringify(value));
      };
      const reply: Reply = { req, res, form, json };
      serve(provider, path, url, reply);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const port = typeof address === 'object' && address !== null ? address.port : 0;
  const base = `https://${host}:${port}`;
  return {
    base,
    server,
    close: () => {
      server.closeAllConnections();
      return new Promise<void>((resolve) => server.close(() => resolve()));
    },
    add(name, clientId, clientSecret) {
      const issuer = `${base}/${name}`;
      const provider = makeProvider(issuer, clientId, clientSecret);
      providers.set(name, provider);
      replies.set(issuer, provider);
      return provider;
    },
  };
}

function makeProvider(issuer: string, clientId: string, clientSecret: string): Provider {
  const provider: Provider = {
    issuer,
    clientId,
    clientSecret,
    key: rsaKey(`${clientId}-k1`),
    signWith: null,
    cacheControl: 'max-age=300',
    jwksCacheControl: null,
    subject: 'subject-1',
    issParameter: false,
    extraToken: {},
    issued: { idTokens: [], accessTokens: [], codes: [] },
    hits: { all: 0, discovery: 0, jwks: 0, token: 0, authorize: 0 },
    tokenRequests: [],
    authorizeCookies: [],
    codes: new Map(),
    docOverride: {},
    discovery: null,
    jwks: null,
    token: null,
    claims: (claims) => claims,
    header: (header) => header,
    doc: () => ({
      issuer,
      authorization_endpoint: `${issuer}/authorize?prompt=login`,
      token_endpoint: `${issuer}/token`,
      jwks_uri: `${issuer}/jwks`,
      id_token_signing_alg_values_supported: ['RS256'],
      code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: ['client_secret_basic'],
      ...(provider.issParameter ? { authorization_response_iss_parameter_supported: true } : {}),
      ...provider.docOverride,
    }),
    authorize: (startUrl, subject = provider.subject) => {
      const query = Object.fromEntries(new URL(startUrl).searchParams);
      const code = randomBytes(16).toString('base64url');
      provider.issued.codes.push(code);
      provider.codes.set(code, { ...query, subject });
      return { code, state: query.state ?? '', query };
    },
  };
  return provider;
}

function serve(provider: Provider, path: string, url: URL, reply: Reply): void {
  const { req, res, json } = reply;
  if (path === '/.well-known/openid-configuration') {
    provider.hits.discovery += 1;
    if (provider.discovery === null) {
      json(200, provider.doc());
    } else {
      provider.discovery(reply);
    }
  } else if (path === '/jwks') {
    provider.hits.jwks += 1;
    if (provider.jwks === null) {
      json(
        200,
        { keys: [provider.key.jwk] },
        provider.jwksCacheControl === null ? {} : { 'cache-control': provider.jwksCacheControl },
      );
    } else {
      provider.jwks(reply);
    }
  } else if (path === '/authorize') {
    serveAuthorize(provider, url, reply);
  } else if (path === '/token' && req.method === 'POST') {
    serveToken(provider, reply);
  } else {
    res.writeHead(404).end();
  }
}

function serveAuthorize(provider: Provider, url: URL, { req, res }: Reply): void {
  provider.hits.authorize += 1;
  provider.authorizeCookies.push(req.headers.cookie);
  const query = Object.fromEntries(url.searchParams);
  const code = randomBytes(16).toString('base64url');
  provider.issued.codes.push(code);
  provider.codes.set(code, { ...query, subject: provider.subject });
  const back = new URL(query.redirect_uri ?? 'http://invalid.test/');
  back.searchParams.set('code', code);
  back.searchParams.set('state', query.state ?? '');
  if (provider.issParameter) {
    back.searchParams.set('iss', provider.issuer);
  }
  res.writeHead(302, { location: back.href, 'cache-control': 'no-store' }).end();
}

function serveToken(provider: Provider, reply: Reply): void {
  const { req, form, json } = reply;
  provider.hits.token += 1;
  provider.tokenRequests.push({ form, authorization: req.headers.authorization, cookie: req.headers.cookie });
  if (provider.token !== null) {
    provider.token(reply);
    return;
  }
  const expected = `Basic ${Buffer.from(`${provider.clientId}:${provider.clientSecret}`).toString('base64')}`;
  const grant = provider.codes.get(form.code ?? '');
  provider.codes.delete(form.code ?? '');
  if (req.headers.authorization !== expected) {
    json(401, { error: 'invalid_client' });
    return;
  }
  if (grant === undefined || form.grant_type !== 'authorization_code') {
    json(400, { error: 'invalid_grant' });
    return;
  }
  const challenge = createHash('sha256')
    .update(form.code_verifier ?? '')
    .digest('base64url');
  if (challenge !== grant.code_challenge || form.redirect_uri !== grant.redirect_uri) {
    json(400, { error: 'invalid_grant' });
    return;
  }
  const now = nowSeconds();
  const claims = provider.claims({
    iss: provider.issuer,
    aud: provider.clientId,
    sub: grant.subject,
    nonce: grant.nonce,
    iat: now,
    exp: now + 300,
    email: 'person@example.test',
    email_verified: true,
    name: 'A Person',
  });
  const header = provider.header({ alg: 'RS256', kid: provider.key.kid, typ: 'JWT' });
  const idToken = sign(header, claims, provider.signWith ?? provider.key);
  provider.issued.idTokens.push(idToken);
  provider.issued.accessTokens.push('AT-CANARY');
  json(200, { access_token: 'AT-CANARY', token_type: 'Bearer', id_token: idToken, ...provider.extraToken });
}
