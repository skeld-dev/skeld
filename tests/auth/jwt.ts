// Does:  Proves JWT verification through real gated requests: boot-fixed policy, refused tokens, no fall-through.
// Holds: A token is admitted only if issuer, audience, algorithm, key and claims match; no key URL comes from a token.
// biome-ignore-all lint/performance/noAwaitInLoops: each case is a request that must finish before the next
// biome-ignore-all lint/nursery/noUnsafeTypeAssertion: hostile fixtures deliberately break the option types

import { readFileSync } from 'node:fs';
import * as jwtEntry from '@skeld/auth/jwt';
import { apiKeys } from '@skeld/auth/api-key';
import { expose } from '@skeld/core/secret';
import { type GatedApp, bootGated } from './rig/app.ts';
import { childPki } from './rig/pki.ts';
import { type Json, ecKey, nowSeconds, providerHost, rsaKey, sign, type SigningKey } from './rig/provider.ts';
import { createReport } from './rig/report.ts';
import { type Kind, makeStoreRig } from './rig/stores.ts';
import { behaviorKinds as kinds } from '../support/test-profile.ts';
import { sleep } from './rig/util.ts';

const ISSUER = 'https://issuer.example.test';
const AUDIENCE = 'api://skeld';
const pki = await childPki(import.meta.url);
const report = createReport(
  'JWT verification fixes issuer, audience, algorithms and keys at boot, refuses wrong signatures, claims and key types, takes no header key URL, never falls through to another kind, and has no signing surface',
);
const host = await providerHost(pki.good);
const attacker = host.add('attacker', 'x', 'x');
const keys = host.add('keys', 'x', 'x');
const k1 = rsaKey('k1');
const k2 = rsaKey('k2');
const e1 = ecKey('e1');

let mapCalls = 0;
let mapAnswer: (verified: { subject: string }) => unknown = (verified) => ({
  kind: 'accept',
  userId: `u-${verified.subject}`,
});

function claims(over: Json = {}): Json {
  return { iss: ISSUER, aud: AUDIENCE, sub: 'alice', exp: nowSeconds() + 300, ...over };
}
function rs(over: Json = {}, header: Json = {}, key: SigningKey = k1): string {
  return sign({ alg: 'RS256', kid: key.kid, typ: 'JWT', ...header }, claims(over), key);
}
function es(over: Json = {}): string {
  return sign({ alg: 'ES256', kid: 'e1' }, claims(over), e1);
}
const bearer = (token: string): Record<string, string> => ({ authorization: `Bearer ${token}` });

type JwtConfig = Parameters<typeof jwtEntry.jwt>[0];

async function start(kind: Kind, extra: Record<string, unknown> = {}) {
  const rig = await makeStoreRig(kind);
  const keyPart = apiKeys();
  const config: JwtConfig = {
    issuer: ISSUER,
    audience: AUDIENCE,
    algorithms: ['RS256', 'ES256'],
    keys: [k1.jwk, e1.jwk],
    map: (verified) => {
      mapCalls++;
      return mapAnswer(verified) as ReturnType<JwtConfig['map']>;
    },
    ...extra,
  };
  for (const [name, value] of Object.entries(extra)) {
    if (value === undefined) {
      Reflect.deleteProperty(config, name);
    }
  }
  try {
    const app = await bootGated(rig.open(), { apiKeys: keyPart, jwt: jwtEntry.jwt(config) });
    return { rig, app, keyPart };
  } catch (error) {
    await rig.dispose();
    throw error;
  }
}

async function stop(running: { rig: { dispose: () => Promise<void> }; app: GatedApp }): Promise<void> {
  await running.app.close();
  await running.rig.dispose();
}

function code(seen: { body: Record<string, unknown> | null }): string {
  return String(seen.body?.code);
}

for (const kind of kinds) {
  await report.run(`${kind} gated requests`, async () => {
    const running = await start(kind, {});
    const { app, keyPart } = running;
    const tag = `[${kind}]`;
    const ok = await app.get('/jwt-only', bearer(rs()));
    report.check(
      `${tag} valid RS256 token is admitted; map's user is the principal`,
      ok.status === 200 && ok.body?.kind === 'jwt' && ok.body?.who === 'u-alice',
      `${ok.status} ${ok.text}`,
    );
    const okEs = await app.get('/jwt-only', bearer(es()));
    report.check(
      `${tag} valid ES256 token is admitted`,
      okEs.status === 200 && okEs.body?.kind === 'jwt',
      `${okEs.status}`,
    );
    const listAud = await app.get('/jwt-only', bearer(rs({ aud: ['other', AUDIENCE] })));
    report.check(`${tag} aud as a list holding the audience is admitted`, listAud.status === 200, `${listAud.status}`);
    const skew = await app.get('/jwt-only', bearer(rs({ exp: nowSeconds() - 30 })));
    report.check(`${tag} exp 30 s past is inside the 60 s allowance`, skew.status === 200, `${skew.status}`);
    const okCalls = mapCalls;

    const refused: [string, string, string?][] = [
      ['wrong signature (another key under the same kid)', rs({}, {}, { ...rsaKey('k1') })],
      ['iss of another issuer', rs({ iss: 'https://other.example.test' })],
      ['aud of another audience', rs({ aud: 'api://other' })],
      ['aud as a list without the audience', rs({ aud: ['a', 'b'] })],
      ['exp 120 s past', rs({ exp: nowSeconds() - 120 })],
      ['exp absent', rs({ exp: undefined })],
      ['exp not a number', rs({ exp: 'soon' })],
      ['nbf 120 s ahead', rs({ nbf: nowSeconds() + 120 })],
      ['nbf not a number', rs({ nbf: 'later' })],
      ['sub absent', rs({ sub: undefined })],
      ['sub of 257 characters', rs({ sub: 's'.repeat(257) })],
      ['alg none with an empty signature', sign({ alg: 'none', kid: 'k1' }, claims(), null)],
      ['alg HS256 (symbolic confusion)', rs({}, { alg: 'HS256' })],
      ['alg ES256 on the RSA key kid', sign({ alg: 'ES256', kid: 'k1' }, claims(), e1)],
      ['alg RS256 on the EC key kid', sign({ alg: 'RS256', kid: 'e1' }, claims(), k1)],
      ['header jku naming an attacker URL', rs({}, { jku: `${attacker.issuer}/jwks` })],
      ['header x5u naming an attacker URL', rs({}, { x5u: `${attacker.issuer}/cert` })],
      ['header jwk embedding the key', rs({}, { jwk: k1.jwk })],
      ['header x5c', rs({}, { x5c: ['MIIB'] })],
      ['header crit', rs({}, { crit: ['exp'] })],
      ['kid absent', rs({}, { kid: undefined })],
      ['kid not a string', rs({}, { kid: 7 })],
      ['kid no key has', rs({}, { kid: 'nope' })],
      ['two segments', rs().split('.').slice(0, 2).join('.')],
      ['four segments', `${rs()}.x`],
      [
        'header not an object',
        `${Buffer.from('[1]').toString('base64url')}.${rs().split('.')[1]}.${rs().split('.')[2]}`,
      ],
      ['empty token', ''],
    ];
    for (const [name, token] of refused) {
      const seen = await app.get('/jwt-only', bearer(token));
      const unauthenticated = seen.status === 401 && code(seen) === 'CREDENTIAL_INVALID';
      report.check(`${tag} refused: ${name}`, unauthenticated, `${seen.status} ${code(seen)}`);
    }
    report.check(
      `${tag} no refused token reached map`,
      mapCalls === okCalls,
      `map calls ${mapCalls}, admitted ${okCalls}`,
    );
    report.check(
      `${tag} header jku/x5u/jwk named URLs received no request`,
      attacker.hits.all === 0,
      `requests to the named host: ${attacker.hits.all}`,
    );

    mapAnswer = () => ({ kind: 'deny' });
    const denied = await app.get('/jwt-only', bearer(rs()));
    mapAnswer = (verified) => ({ kind: 'accept', userId: `u-${verified.subject}` });
    report.check(
      `${tag} map deny is a refusal`,
      denied.status === 401 && code(denied) === 'CREDENTIAL_INVALID',
      `${denied.status} ${code(denied)}`,
    );
    mapAnswer = () => ({ kind: 'accept', userId: null });
    const anonymous = await app.get('/jwt-only', bearer(rs()));
    mapAnswer = (verified) => ({ kind: 'accept', userId: `u-${verified.subject}` });
    report.check(
      `${tag} map accept with userId null admits a principal without a user`,
      anonymous.status === 200 && anonymous.body?.who === 'null',
      `${anonymous.status} ${anonymous.text}`,
    );

    // Does:  credential kinds never fall through to another verifier, in either direction.
    const before = mapCalls;
    const optional = await app.get('/optional', bearer(rs({}, {}, { ...rsaKey('k1') })));
    report.check(
      `${tag} an invalid JWT on an optional route is 401, never anonymous`,
      optional.status === 401,
      `${optional.status} ${code(optional)}`,
    );
    const onKey = await app.get('/key-only', bearer(rs()));
    report.check(
      `${tag} a valid JWT on an api_key-only policy is refused and never verified`,
      onKey.status === 401 && code(onKey) === 'CREDENTIAL_INVALID' && mapCalls === before,
      `${onKey.status} ${code(onKey)}; map calls +${mapCalls - before}`,
    );
    const onSession = await app.get('/sess-only', bearer(rs()));
    report.check(
      `${tag} a valid JWT on a session-only policy is refused`,
      onSession.status === 401 && code(onSession) === 'CREDENTIAL_INVALID',
      `${onSession.status}`,
    );
    const asCookie = await app.get('/sess-only', { cookie: `__Host-skeld=${rs()}` });
    report.check(`${tag} a JWT sent as the session cookie is refused`, asCookie.status === 401, `${asCookie.status}`);

    const issued = await keyPart.issue({ userId: 'key-owner', name: 'k', scopes: ['jwtonly:read', 'keyonly:read'] });
    if (issued.kind === 'issued') {
      const secret = expose(issued.key);
      const mapBefore = mapCalls;
      const keyOnJwt = await app.get('/jwt-only', bearer(secret));
      report.check(
        `${tag} a real API key on a jwt-only policy is refused and is not tried as a JWT`,
        keyOnJwt.status === 401 && code(keyOnJwt) === 'CREDENTIAL_INVALID' && mapCalls === mapBefore,
        `${keyOnJwt.status} ${code(keyOnJwt)}; map calls +${mapCalls - mapBefore}`,
      );
      const keyOk = await app.get('/key-only', bearer(secret));
      report.check(
        `${tag} the same key is admitted where the policy lists api_key`,
        keyOk.status === 200 && keyOk.body?.kind === 'api_key',
        `${keyOk.status} ${keyOk.text}`,
      );
      const both = await app.get('/any-kind', {
        ...bearer(rs()),
        cookie: '__Host-skeld=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
      });
      report.check(
        `${tag} a bearer token beside a cookie is a conflict, neither wins`,
        both.status === 400 && code(both) === 'CREDENTIAL_CONFLICT',
        `${both.status} ${code(both)}`,
      );
    } else {
      report.check(`${tag} an API key was issued for the fall-through cases`, false, issued.kind);
    }
    const none = await app.get('/jwt-only');
    report.check(
      `${tag} no credential on a policy route is 401 CREDENTIAL_MISSING with a Bearer challenge`,
      none.status === 401 && code(none) === 'CREDENTIAL_MISSING' && none.headers.get('www-authenticate') === 'Bearer',
      `${none.status} ${code(none)} ${none.headers.get('www-authenticate')}`,
    );
    report.check(
      `${tag} the refusals wrote skeld.refuse records and no raw token text`,
      !app.lines.some((line) => line.includes(rs().split('.')[2] ?? 'x')),
      `records ${app.lines.length}`,
    );
    await stop(running);
  });
}

await report.run('algorithms fixed at boot', async () => {
  const running = await start('sqlite', { algorithms: ['ES256'] });
  const refusedRs = await running.app.get('/jwt-only', bearer(rs()));
  const admittedEs = await running.app.get('/jwt-only', bearer(es()));
  report.check(
    'with ES256 configured an RS256 token is refused and an ES256 token admitted',
    refusedRs.status === 401 && admittedEs.status === 200,
    `${refusedRs.status}, ${admittedEs.status}`,
  );
  await stop(running);
});

await report.run('boot faults for key and option policy', async () => {
  const cases: [string, Record<string, unknown>, string][] = [
    ['a JWK whose alg disagrees with its type', { keys: [{ ...k1.jwk, alg: 'ES256' }] }, 'alg'],
    ['an RSA key of 1,024 bits', { keys: [rsaKey('small', 1024).jwk] }, 'RSA'],
    ['a key for encryption', { keys: [{ ...k1.jwk, use: 'enc' }] }, 'RSA'],
    ['an HMAC key', { keys: [{ kty: 'oct', kid: 'h', k: 'c2VjcmV0' }] }, 'RSA'],
    ['a repeated kid', { keys: [k1.jwk, { ...e1.jwk, kid: 'k1' }] }, 'kid'],
    ['both keys and jwksUrl', { keys: [k1.jwk], jwksUrl: `${keys.issuer}/jwks` }, 'one'],
    ['neither keys nor jwksUrl', { keys: undefined }, 'one'],
    ['an http jwksUrl', { keys: undefined, jwksUrl: 'http://localhost/jwks' }, 'https'],
    ['no algorithms', { algorithms: [] }, 'algorithms'],
    ['an empty audience', { audience: '' }, 'audience'],
    ['an issuer of 256 characters', { issuer: `https://${'i'.repeat(248)}` }, 'issuer'],
    ['an unknown option', { leeway: 120 }, 'leeway'],
  ];
  for (const [name, options, finding] of cases) {
    let outcome = 'listened';
    try {
      const running = await start('sqlite', options);
      await stop(running);
    } catch (error) {
      outcome =
        error instanceof Error ? `${(error as { code?: string }).code ?? error.name}: ${error.message}` : 'threw';
    }
    report.check(
      `boot refuses ${name}`,
      outcome.startsWith('GATE_FAILED') && outcome.includes('jwt') && outcome.includes(finding),
      outcome,
    );
  }
});

await report.run('key set URL: first use, rotation, unknown kid', async () => {
  const running = await start('sqlite', { keys: undefined, jwksUrl: `${keys.issuer}/jwks` });
  keys.jwks = ({ json }) => json(200, { keys: [k1.jwk] });
  const rotate = keys.hits.jwks;
  const first = await running.app.get('/jwt-only', bearer(rs()));
  report.check(
    'the key set is fetched at first use and the token admitted',
    first.status === 200 && keys.hits.jwks === rotate + 1,
    `${first.status}; fetches ${keys.hits.jwks - rotate}`,
  );
  const again = await running.app.get('/jwt-only', bearer(rs()));
  report.check(
    'a second token is verified from the fresh cache with no fetch',
    again.status === 200 && keys.hits.jwks === rotate + 1,
    `fetches ${keys.hits.jwks - rotate}`,
  );
  keys.jwks = ({ json }) => json(200, { keys: [k1.jwk, k2.jwk] });
  const rotated = await running.app.get('/jwt-only', bearer(rs({}, {}, k2)));
  report.check(
    'a key added to the set under a new kid verifies after one refresh',
    rotated.status === 200 && keys.hits.jwks === rotate + 2,
    `${rotated.status}; fetches ${keys.hits.jwks - rotate}`,
  );
  const unknown = await running.app.get('/jwt-only', bearer(rs({}, { kid: 'never' })));
  report.check(
    'an unknown kid inside the 60 s limit is refused with no further fetch',
    unknown.status === 401 && keys.hits.jwks === rotate + 2,
    `${unknown.status}; fetches ${keys.hits.jwks - rotate}`,
  );
  await stop(running);
  await sleep(1);
});

report.check(
  'the ./jwt subpath exports the verifier and nothing else',
  JSON.stringify(Object.keys(jwtEntry)) === '["jwt"]',
  JSON.stringify(Object.keys(jwtEntry)),
);
const part = jwtEntry.jwt({
  issuer: ISSUER,
  audience: AUDIENCE,
  algorithms: ['RS256'],
  keys: [k1.jwk],
  map: () => ({ kind: 'deny' }),
});
const own = Object.getOwnPropertyNames(part);
report.check(
  'the jwt() value has no signing, issuing or refresh member',
  !own.some((name) => /sign|issu|mint|refresh|token/i.test(name)),
  `members: ${own.join(', ')}`,
);

const names: string[] = [];
const surface = JSON.parse(readFileSync(new URL('../../packages/auth/package.json', import.meta.url), 'utf8'));
for (const subpath of Object.keys(surface.exports)) {
  if (subpath !== './package.json' && subpath !== './diag') {
    const entry = await import(`@skeld/auth/${subpath.slice(2)}`);
    names.push(...Object.keys(entry));
  }
}
const signing = names.filter((name) => /^(sign|issue|mint|refresh)|^create(Token|Jwt|Issuer)/i.test(name));
report.check(
  'no export of any @skeld/auth subpath signs, issues a JWT or refreshes a token',
  signing.length === 0 && names.includes('jwt'),
  `${names.length} exported values: ${names.join(', ')}`,
);

await host.close();
pki.dispose();
report.finish();
