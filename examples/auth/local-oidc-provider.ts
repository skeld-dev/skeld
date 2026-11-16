import { execFileSync } from 'node:child_process';
import { createHash, generateKeyPairSync, randomBytes, timingSafeEqual } from 'node:crypto';
import { once } from 'node:events';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createServer } from 'node:https';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { signRs256 } from './local-issuer.ts';

// NOT A REAL IDENTITY PROVIDER. A minimal OpenID Connect authorization-code provider for this example only:
// discovery, a key set, an authorization endpoint that signs in whichever local account `login_hint` names
// without asking for any credential, and a token endpoint. It exists so the sign-in flow runs on one machine.

export interface LocalProvider {
  readonly issuer: string;
  readonly clientId: string;
  readonly clientSecret: string;
  // The throwaway certificate the provider serves; with-local-provider.ts hands it to the service as its CA file.
  readonly certificate: string;
  close(): Promise<void>;
}

const HOST = '127.0.0.1';

interface PendingCode {
  readonly subject: string;
  readonly nonce: string;
  readonly challenge: string;
  readonly expiresAt: number;
}

export async function startLocalProvider(options: {
  readonly redirectUri: string;
  readonly accounts: readonly string[];
}): Promise<LocalProvider> {
  const { key, certificate } = makeCertificate();
  const signing = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const kid = randomBytes(8).toString('base64url');
  const clientId = 'skeld-auth-example';
  const clientSecret = randomBytes(32).toString('base64url');
  const codes = new Map<string, PendingCode>();
  let issuer = '';

  const server = createServer({ key, cert: certificate }, (request, response) => {
    handle(request, response).catch(() => reply(response, 500, { error: 'server_error' }));
  });

  async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const url = new URL(request.url ?? '/', issuer);
    const route = `${request.method} ${url.pathname}`;
    if (route === 'GET /.well-known/openid-configuration') {
      reply(response, 200, {
        issuer,
        authorization_endpoint: `${issuer}/authorize`,
        token_endpoint: `${issuer}/token`,
        jwks_uri: `${issuer}/jwks`,
        response_types_supported: ['code'],
        subject_types_supported: ['public'],
        id_token_signing_alg_values_supported: ['RS256'],
        code_challenge_methods_supported: ['S256'],
        token_endpoint_auth_methods_supported: ['client_secret_basic'],
        authorization_response_iss_parameter_supported: true,
      });
    } else if (route === 'GET /jwks') {
      const jwk = signing.publicKey.export({ format: 'jwk' });
      reply(response, 200, { keys: [{ ...jwk, kid, alg: 'RS256', use: 'sig' }] });
    } else if (route === 'GET /authorize') {
      authorize(url.searchParams, response);
    } else if (route === 'POST /token') {
      await token(request, response);
    } else {
      reply(response, 404, { error: 'not_found' });
    }
  }

  function authorize(query: URLSearchParams, response: ServerResponse): void {
    const subject = query.get('login_hint') ?? '';
    const state = query.get('state');
    const nonce = query.get('nonce');
    const challenge = query.get('code_challenge');
    if (
      query.get('client_id') !== clientId ||
      query.get('redirect_uri') !== options.redirectUri ||
      query.get('response_type') !== 'code' ||
      query.get('code_challenge_method') !== 'S256' ||
      !query.get('scope')?.split(' ').includes('openid') ||
      state === null ||
      nonce === null ||
      challenge === null
    ) {
      reply(response, 400, { error: 'invalid_request' });
      return;
    }
    if (!options.accounts.includes(subject)) {
      reply(response, 400, { error: 'login_required', accounts: options.accounts });
      return;
    }
    const code = randomBytes(32).toString('base64url');
    codes.set(code, { subject, nonce, challenge, expiresAt: Date.now() + 60_000 });
    const back = new URL(options.redirectUri);
    back.searchParams.set('code', code);
    back.searchParams.set('state', state);
    back.searchParams.set('iss', issuer);
    response.writeHead(302, { location: back.href, 'cache-control': 'no-store' }).end();
  }

  async function token(request: IncomingMessage, response: ServerResponse): Promise<void> {
    if (!clientAuthenticated(request.headers.authorization)) {
      reply(response, 401, { error: 'invalid_client' });
      return;
    }
    const form = new URLSearchParams(await readBody(request, 8_192));
    const code = form.get('code') ?? '';
    const pending = codes.get(code);
    // A code is spent by its first use, whatever follows.
    codes.delete(code);
    const verifier = form.get('code_verifier') ?? '';
    if (
      pending === undefined ||
      pending.expiresAt < Date.now() ||
      form.get('grant_type') !== 'authorization_code' ||
      form.get('redirect_uri') !== options.redirectUri ||
      createHash('sha256').update(verifier).digest('base64url') !== pending.challenge
    ) {
      reply(response, 400, { error: 'invalid_grant' });
      return;
    }
    const now = Math.floor(Date.now() / 1000);
    const idToken = signRs256(signing.privateKey, kid, {
      iss: issuer,
      sub: pending.subject,
      aud: clientId,
      nonce: pending.nonce,
      iat: now,
      exp: now + 300,
    });
    reply(response, 200, { token_type: 'Bearer', id_token: idToken, expires_in: 300 });
  }

  // client_secret_basic: Basic base64(form-encoded id ":" form-encoded secret), RFC 6749 section 2.3.1.
  function clientAuthenticated(header: string | undefined): boolean {
    if (header === undefined || !header.startsWith('Basic ')) {
      return false;
    }
    const decoded = Buffer.from(header.slice(6), 'base64').toString('utf8');
    const colon = decoded.indexOf(':');
    const id = decodeURIComponent(decoded.slice(0, colon).replaceAll('+', ' '));
    const secret = Buffer.from(decodeURIComponent(decoded.slice(colon + 1).replaceAll('+', ' ')));
    const expected = Buffer.from(clientSecret);
    return colon > 0 && id === clientId && secret.length === expected.length && timingSafeEqual(secret, expected);
  }

  server.listen(0, HOST);
  await once(server, 'listening');
  const address = server.address();
  if (address === null || typeof address === 'string') {
    throw new TypeError('local provider: not listening on a TCP port');
  }
  issuer = `https://${HOST}:${address.port}`;

  return {
    issuer,
    clientId,
    clientSecret,
    certificate,
    close: async () => {
      server.closeAllConnections();
      server.close();
      await once(server, 'close');
    },
  };
}

// A self-signed certificate for 127.0.0.1, made with openssl in a temporary folder that is removed at once.
// The private key stays in memory for this run; nothing is written into the repository.
function makeCertificate(): { readonly key: string; readonly certificate: string } {
  const dir = mkdtempSync(join(tmpdir(), 'skeld-auth-example-tls-'));
  try {
    const keyPath = join(dir, 'key.pem');
    const certPath = join(dir, 'cert.pem');
    execFileSync(
      'openssl',
      [
        'req',
        '-x509',
        '-newkey',
        'ec',
        '-pkeyopt',
        'ec_paramgen_curve:prime256v1',
        '-nodes',
        '-keyout',
        keyPath,
        '-out',
        certPath,
        '-days',
        '1',
        '-subj',
        `/CN=${HOST}`,
        '-addext',
        `subjectAltName=IP:${HOST}`,
      ],
      { stdio: 'ignore' },
    );
    return { key: readFileSync(keyPath, 'utf8'), certificate: readFileSync(certPath, 'utf8') };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

async function readBody(request: IncomingMessage, limit: number): Promise<string> {
  let body = '';
  for await (const chunk of request) {
    body += String(chunk);
    if (body.length > limit) {
      throw new RangeError('local provider: request body too large');
    }
  }
  return body;
}

function reply(response: ServerResponse, status: number, body: object): void {
  response.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  response.end(JSON.stringify(body));
}
