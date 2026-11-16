// Does:  Proves the OIDC callback judges the ID Token and the provider's configuration against the contracted refusals.
// Holds: A forged, mismatched or stale ID Token never yields a session; each answers its closed callback code.
// biome-ignore-all lint/performance/noAwaitInLoops: each case is a request that must finish before the next
// biome-ignore-all lint/security/noSecrets: claim names and canary text are fixtures, not secrets

import { createHash } from 'node:crypto';
import { type OidcApp, begin, bootOidc, COOKIE, location } from './rig/oidc-app.ts';
import { childPki } from './rig/pki.ts';
import { ecKey, type Json, nowSeconds, providerHost, rsaKey } from './rig/provider.ts';
import { createReport } from './rig/report.ts';
import { makeStoreRig } from './rig/stores.ts';
import { behaviorKinds as kinds } from '../support/test-profile.ts';
import type { SigningKey } from './rig/provider.ts';

const pki = await childPki(import.meta.url);
const report = createReport(
  'v05',
  'oidc-tokens',
  'the callback accepts only an ID Token signed by the fixed issuer for the fixed client with the attempt nonce and sane times, and refuses a provider configuration that does not match; each refusal is its contracted closed code',
);
const host = await providerHost(pki.good);
const pa = host.add('a', 'client-a', 'secret-a');
const pb = host.add('b', 'client-b', 'secret-b');
const a = { provider: pa, name: 'a' };
const rogue = rsaKey('client-a-k1');
const now = nowSeconds();
const providerResponse = '/login?provider=a&error=provider_response';
const unavailable = '/login?provider=a&error=provider_unavailable';

interface Variant {
  readonly name: string;
  readonly claims?: Json;
  readonly header?: Json;
  readonly signWith?: SigningKey | null;
  readonly want: string;
}

const variants: Variant[] = [
  { name: 'signed by another key under the published kid', signWith: rogue, want: providerResponse },
  { name: 'alg none', header: { alg: 'none' }, signWith: null, want: providerResponse },
  { name: 'alg HS256', header: { alg: 'HS256' }, want: providerResponse },
  { name: 'alg ES256 (RS256 only)', header: { alg: 'ES256' }, signWith: ecKey('client-a-k1'), want: providerResponse },
  { name: 'kid absent', header: { kid: undefined }, want: providerResponse },
  { name: 'kid no key has', header: { kid: 'unpublished' }, want: providerResponse },
  { name: 'header jku', header: { jku: 'https://127.0.0.1:1/jwks' }, want: providerResponse },
  { name: 'header crit', header: { crit: ['exp'] }, want: providerResponse },
  { name: 'iss of another issuer', claims: { iss: pb.issuer }, want: providerResponse },
  { name: 'iss absent', claims: { iss: undefined }, want: providerResponse },
  { name: 'aud of another client', claims: { aud: 'client-b' }, want: providerResponse },
  { name: 'aud as a list with another party', claims: { aud: ['client-a', 'client-b'] }, want: providerResponse },
  { name: 'azp naming another client', claims: { azp: 'client-b' }, want: providerResponse },
  { name: 'exp 120 s past', claims: { exp: now - 120 }, want: providerResponse },
  { name: 'exp absent', claims: { exp: undefined }, want: providerResponse },
  { name: 'nbf 120 s ahead', claims: { nbf: now + 120 }, want: providerResponse },
  { name: 'iat absent', claims: { iat: undefined }, want: providerResponse },
  { name: 'iat not a number', claims: { iat: 'now' }, want: providerResponse },
  { name: 'iat 120 s ahead', claims: { iat: now + 120 }, want: providerResponse },
  { name: 'nonce of another attempt', claims: { nonce: 'not-this-attempts-nonce' }, want: providerResponse },
  { name: 'nonce absent', claims: { nonce: undefined }, want: providerResponse },
  { name: 'sub absent', claims: { sub: undefined }, want: providerResponse },
  { name: 'sub empty', claims: { sub: '' }, want: providerResponse },
  { name: 'sub of 256 characters', claims: { sub: 's'.repeat(256) }, want: providerResponse },
  { name: 'sub with a control character', claims: { sub: 'bad\u0007sub' }, want: providerResponse },
  { name: 'sub not a string', claims: { sub: 12345 }, want: providerResponse },
];
const accepted: Variant[] = [
  { name: 'the unmodified token', want: '/home' },
  { name: 'aud as a list holding only the client', claims: { aud: ['client-a'] }, want: '/home' },
  { name: 'azp equal to the client', claims: { azp: 'client-a' }, want: '/home' },
  { name: 'exp 30 s past (inside the 60 s allowance)', claims: { exp: now - 30 }, want: '/home' },
  { name: 'nbf 30 s ahead (inside the 60 s allowance)', claims: { nbf: now + 30 }, want: '/home' },
  { name: 'sub of 255 characters', claims: { sub: 's'.repeat(255) }, want: '/home' },
];

async function run(app: OidcApp, variant: Variant): Promise<string> {
  const browser = app.browser();
  const trip = await begin(browser, a);
  pa.claims = (claims) => ({ ...claims, ...variant.claims });
  pa.header = (header) => {
    const merged: Json = { ...header, ...variant.header };
    return merged;
  };
  pa.signWith = variant.signWith === undefined ? null : variant.signWith;
  const hop = await browser.callback('a', { code: trip.code, state: trip.state });
  pa.claims = (claims) => claims;
  pa.header = (header) => header;
  pa.signWith = null;
  const session = browser.jar.has(COOKIE);
  return `${location(hop)}${session ? ' +session' : ''}`;
}

for (const kind of kinds) {
  await report.run(`${kind} tokens`, async () => {
    const rig = await makeStoreRig(kind);
    const app = await bootOidc({
      store: rig.open(),
      entries: [a],
      resolveUser: (identity) => ({
        kind: 'user',
        userId: `u-${createHash('sha1').update(identity.subject).digest('hex')}`,
      }),
      addressLimit: { max: 100_000, windowSeconds: 60 },
    });
    const tag = `[${kind}]`;
    try {
      for (const variant of accepted) {
        const seen = await run(app, variant);
        report.check(`${tag} accepted: ${variant.name}`, seen === `${variant.want} +session`, seen);
      }
      const failedBefore = app.events('auth.signin.failed').length;
      const sessionsBefore = await rig.count('sessions');
      for (const variant of variants) {
        const seen = await run(app, variant);
        report.check(`${tag} refused: ${variant.name}`, seen === variant.want, seen);
      }
      await app.settle();
      const written = app.events('auth.signin.failed').slice(failedBefore);
      const reasons = written.map((record) => record.fields?.['auth.reason']);
      report.check(
        `${tag} none of the ${variants.length} refused tokens made a session`,
        (await rig.count('sessions')) === sessionsBefore,
        `sessions ${sessionsBefore} before, ${await rig.count('sessions')} after`,
      );
      report.check(
        `${tag} the refusals wrote auth.signin.failed with reason provider_response only, up to the 20 per 10 s the log window passes`,
        reasons.length === Math.min(variants.length, 20) && reasons.every((reason) => reason === 'provider_response'),
        `${variants.length} refusals, ${reasons.length} records`,
      );

      const mixedBrowser = app.browser();
      const trip = await begin(mixedBrowser, a);
      pa.token = ({ json }) => {
        const issued = pb.authorize(trip.url);
        const idToken = Buffer.from(JSON.stringify({ alg: 'RS256', kid: pb.key.kid })).toString('base64url');
        json(200, {
          id_token: `${idToken}.${Buffer.from(JSON.stringify({ iss: pb.issuer, aud: 'client-a', sub: issued.code })).toString('base64url')}.sig`,
        });
      };
      const mixed = await mixedBrowser.callback('a', { code: trip.code, state: trip.state });
      pa.token = null;
      report.check(
        `${tag} a token from another provider's issuer at this provider's token endpoint is provider_response`,
        location(mixed) === providerResponse,
        location(mixed),
      );

      const shapes: [
        string,
        (reply: { json: (status: number, value: unknown) => void; res: { destroy: () => void } }) => void,
        string,
      ][] = [
        ['a token response with no id_token', ({ json }) => json(200, { access_token: 'AT-CANARY' }), providerResponse],
        ['an id_token that is not a string', ({ json }) => json(200, { id_token: 7 }), providerResponse],
        ['a 400 invalid_grant answer', ({ json }) => json(400, { error: 'invalid_grant' }), providerResponse],
        ['a 500 answer', ({ json }) => json(500, { error: 'server_error' }), providerResponse],
        ['a body that is not a JSON object', ({ json }) => json(200, '[1,2,3]'), providerResponse],
        ['a connection closed before any answer', ({ res }) => res.destroy(), unavailable],
      ];
      for (const [name, answer, want] of shapes) {
        const browser = app.browser();
        const attempt = await begin(browser, a);
        pa.token = answer;
        const hop = await browser.callback('a', { code: attempt.code, state: attempt.state });
        pa.token = null;
        report.check(
          `${tag} token endpoint answers ${name}: ${want.split('=')[2]}`,
          location(hop) === want && !browser.jar.has(COOKIE),
          location(hop),
        );
      }
      report.check(
        `${tag} no client secret, code or token text reached any log record`,
        !app.lines.some((line) => /secret-a|AT-CANARY/.test(line)),
        `${app.lines.length} records`,
      );
    } finally {
      await app.close();
      await rig.dispose();
    }
  });
}

interface DocCase {
  readonly name: string;
  readonly doc: Json;
  readonly reason: string;
}
const docCases: DocCase[] = [
  { name: 'issuer different from the configured string', doc: { issuer: `${pa.issuer}/` }, reason: 'issuer' },
  { name: 'token_endpoint over http', doc: { token_endpoint: 'http://localhost/token' }, reason: 'endpoint' },
  { name: 'jwks_uri absent', doc: { jwks_uri: undefined }, reason: 'endpoint' },
  {
    name: 'authorization_endpoint with userinfo',
    doc: { authorization_endpoint: 'https://u:p@localhost/authorize' },
    reason: 'endpoint',
  },
  {
    name: 'authorization_endpoint query already naming a parameter auth sends',
    doc: { authorization_endpoint: `${pa.issuer}/authorize?state=x` },
    reason: 'endpoint',
  },
  {
    name: 'id_token_signing_alg_values_supported without RS256',
    doc: { id_token_signing_alg_values_supported: ['ES256'] },
    reason: 'signing_alg',
  },
  {
    name: 'code_challenge_methods_supported without S256',
    doc: { code_challenge_methods_supported: ['plain'] },
    reason: 'pkce',
  },
  {
    name: 'code_challenge_methods_supported absent',
    doc: { code_challenge_methods_supported: undefined },
    reason: 'pkce',
  },
  {
    name: 'token_endpoint_auth_methods_supported without client_secret_basic',
    doc: { token_endpoint_auth_methods_supported: ['private_key_jwt'] },
    reason: 'client_auth',
  },
];

await report.run('configuration refusals', async () => {
  const rig = await makeStoreRig('sqlite');
  const entries = docCases.map((_, index) => {
    const provider = host.add(`d${index}`, 'client-d', 'secret-d');
    return { provider, name: `d${index}` };
  });
  const control = { provider: host.add('dc', 'client-d', 'secret-d'), name: 'dc' };
  const app = await bootOidc({
    store: rig.open(),
    entries: [control, ...entries],
    resolveUser: (identity) => ({ kind: 'user', userId: `u-${identity.subject}` }),
    addressLimit: { max: 100_000, windowSeconds: 60 },
  });
  try {
    const first = await app.browser().start('dc');
    report.check('control: the unmodified document starts a sign-in', first.status === 200, `${first.status}`);
    for (const [index, { name, doc, reason }] of docCases.entries()) {
      const entry = entries[index];
      if (entry === undefined) {
        continue;
      }
      entry.provider.docOverride = doc;
      const before = app.events('auth.oidc.provider_refused').length;
      const hop = await app.browser().start(entry.name);
      await app.settle();
      const refused = app.events('auth.oidc.provider_refused').slice(before);
      const field = refused[0]?.fields?.['auth.reason'];
      const ok = hop.status === 503 && hop.body?.code === 'PROVIDER_UNAVAILABLE' && hop.setCookie.length === 0;
      report.check(
        `a document with ${name} is refused: 503 PROVIDER_UNAVAILABLE, no cookie, one record, reason ${reason}`,
        ok && refused.length === 1 && field === reason,
        `${hop.status} ${String(hop.body?.code)}; records ${refused.length} reason ${String(field)}`,
      );
    }
  } finally {
    await app.close();
    await rig.dispose();
  }
});

await host.close();
pki.dispose();
report.finish();
