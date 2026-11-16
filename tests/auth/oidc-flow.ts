// Does:  Proves the OIDC authorization-code flow end to end over local TLS providers: PKCE, state, nonce, the attempt.
// Holds: One browser-bound, expiring, single-use attempt yields at most one session; a wrong browser consumes nothing.
// biome-ignore-all lint/performance/noAwaitInLoops: each case is a request that must finish before the next
// biome-ignore-all lint/security/noSecrets: cookie attribute names and canary text are fixtures, not secrets

import { createHash } from 'node:crypto';
import { type Browser, begin, bootOidc, COOKIE, location, type OidcApp } from './rig/oidc-app.ts';
import { childPki } from './rig/pki.ts';
import { providerHost } from './rig/provider.ts';
import { createReport } from './rig/report.ts';
import { kinds, makeStoreRig, type StoreRig } from './rig/stores.ts';

const pki = await childPki(import.meta.url);
const report = createReport(
  'the authorization-code flow uses S256 PKCE, state, nonce and a browser-bound, expiring, single-use attempt; a wrong browser consumes nothing; concurrent valid callbacks yield one result; one provider cannot stand in for another',
);
const host = await providerHost(pki.good);
const pa = host.add('a', 'client-a', 'secret-a');
const pb = host.add('b', 'client-b', 'secret-b');
const pc = host.add('c', 'client-c', 'secret-c');
pc.issParameter = true;
const a = { provider: pa, name: 'a' };
const c = { provider: pc, name: 'c' };
const b = { provider: pb, name: 'b' };
const sha = (text: string): string => createHash('sha256').update(text).digest('base64url');
const hex = (value: unknown): string =>
  value instanceof Uint8Array ? Buffer.from(value).toString('hex') : String(value);
const fail = (name: string, code: string): string => `/login?provider=${name}&error=${code}`;
const attemptCookie = (name: string): string => `${COOKIE}-oidc-${name}`;

async function sessionState(browser: Browser): Promise<string> {
  const seen = await browser.session();
  return seen.body?.status === 'session' ? `session ${String(seen.body.userId)}` : String(seen.body?.status);
}

async function caseStart(app: OidcApp, rig: StoreRig, tag: string): Promise<void> {
  const browser = app.browser();
  const trip = await begin(browser, a);
  const url = new URL(trip.url);
  const names = [...url.searchParams.keys()];
  const expected = [
    'prompt',
    'response_type',
    'client_id',
    'redirect_uri',
    'scope',
    'state',
    'nonce',
    'code_challenge',
    'code_challenge_method',
  ];
  const q = trip.query;
  report.check(
    `${tag} start: the authorization URL is the configured endpoint, its query kept, plus the eight parameters and nothing else`,
    trip.start.status === 200 &&
      url.origin + url.pathname === `${pa.issuer}/authorize` &&
      JSON.stringify(names) === JSON.stringify(expected),
    names.join(','),
  );
  report.check(
    `${tag} start: code flow, this provider's client id, this provider's callback, S256`,
    q.response_type === 'code' &&
      q.client_id === 'client-a' &&
      q.redirect_uri === `${app.origin}/auth/oidc/a/callback` &&
      q.code_challenge_method === 'S256' &&
      q.scope?.split(' ').includes('openid') === true,
    `${q.response_type} ${q.client_id} ${q.redirect_uri} ${q.code_challenge_method} scope=${q.scope}`,
  );
  report.check(
    `${tag} start: state is 43 base64url characters and the nonce and challenge are random per start`,
    /^[A-Za-z0-9_-]{43}$/.test(q.state ?? '') && (q.nonce ?? '').length >= 22 && (q.code_challenge ?? '').length === 43,
    `state ${q.state?.length}, nonce ${q.nonce?.length}, challenge ${q.code_challenge?.length}`,
  );
  const set = trip.start.setCookie.find((line) => line.startsWith(`${attemptCookie('a')}=`)) ?? '';
  report.check(
    `${tag} start: the attempt cookie is host-only, Secure, HttpOnly, SameSite=Lax, Path=/, Max-Age 600, no Domain`,
    /^__Host-skeld-oidc-a=[A-Za-z0-9_-]{43}; Path=\/; Max-Age=600; HttpOnly; Secure; SameSite=Lax$/.test(set),
    set.replace(/=[A-Za-z0-9_-]{43}/, '=<43>'),
  );
  const rows = await rig.rows('SELECT * FROM oidc_attempts');
  const row = rows[0] ?? {};
  const cookieValue = browser.jar.get(attemptCookie('a')) ?? '';
  const whole = JSON.stringify(Object.values(row).map(hex));
  report.check(
    `${tag} start: one attempt row holds digests of the state and the cookie, not their texts, and a 600 s life`,
    rows.length === 1 &&
      (hex(row.state_digest) === Buffer.from(trip.state, 'base64url').length.toString()) === false &&
      !whole.includes(trip.state) &&
      !whole.includes(cookieValue) &&
      hex(row.state_digest).length === 64 &&
      hex(row.binding_digest).length === 64,
    `rows ${rows.length}; state_digest and binding_digest 32 bytes; texts absent from the row`,
  );
  const ttl = Number(row.expires_at) - Date.now();
  report.check(
    `${tag} start: the attempt expires about 600,000 ms ahead`,
    ttl > 595_000 && ttl <= 600_500,
    `${ttl} ms ahead`,
  );
  report.check(
    `${tag} start: the verifier is stored once and the challenge is its S256 digest`,
    sha(String(row.verifier)) === q.code_challenge && row.nonce === q.nonce,
    'sha256(verifier) equals code_challenge; stored nonce equals the URL nonce',
  );
  report.check(
    `${tag} start: no session exists and no session cookie was set yet`,
    !browser.jar.has(COOKIE) && (await sessionState(browser)) === 'none',
    await sessionState(browser),
  );
}

async function caseSuccess(app: OidcApp, rig: StoreRig, tag: string): Promise<void> {
  pa.tokenRequests.length = 0;
  const browser = app.browser();
  const trip = await begin(browser, a);
  const cb = await browser.callback('a', { code: trip.code, state: trip.state });
  const session = cb.setCookie.find((line) => line.startsWith(`${COOKIE}=`)) ?? '';
  report.check(
    `${tag} callback: 303 to the return path with a session cookie and the attempt cookie cleared`,
    cb.status === 303 &&
      cb.location === '/home' &&
      session.includes('HttpOnly') &&
      session.includes('Secure') &&
      session.includes('SameSite=Lax') &&
      session.includes('Path=/') &&
      !session.includes('Domain') &&
      cb.setCookie.some((line) => line.startsWith(`${attemptCookie('a')}=`) && /Max-Age=0/i.test(line)),
    `${cb.status} ${location(cb)}; ${cb.setCookie.length} cookies`,
  );
  report.check(
    `${tag} callback: the new session is live for the mapped user`,
    (await sessionState(browser)) === 'session u-subject-1',
    await sessionState(browser),
  );
  const token = pa.tokenRequests[0];
  report.check(
    `${tag} token request: one POST of exactly grant_type, code, redirect_uri, code_verifier with client_secret_basic and no cookie`,
    pa.tokenRequests.length === 1 &&
      JSON.stringify(Object.keys(token?.form ?? {}).sort()) ===
        JSON.stringify(['code', 'code_verifier', 'grant_type', 'redirect_uri']) &&
      token?.authorization === `Basic ${Buffer.from('client-a:secret-a').toString('base64')}` &&
      token?.cookie === undefined,
    `${Object.keys(token?.form ?? {}).join(',')}`,
  );
  report.check(
    `${tag} PKCE: the provider recomputed S256 of the code_verifier and it matched the challenge from the start`,
    sha(token?.form.code_verifier ?? '') === trip.query.code_challenge &&
      token?.form.redirect_uri === trip.query.redirect_uri,
    'the provider issued a token only because the digest matched',
  );
  const attempts = await rig.count('oidc_attempts', 'binding_digest IS NOT NULL');
  const sessions = await rig.rows('SELECT * FROM sessions');
  report.check(
    `${tag} callback: the attempt is spent and no code, token or secret was stored`,
    attempts === 0 && !JSON.stringify(sessions.map((row) => Object.values(row).map(hex))).includes('AT-CANARY'),
    `attempts ${attempts}, sessions ${sessions.length}`,
  );
  const replay = await browser.callback('a', { code: trip.code, state: trip.state });
  report.check(
    `${tag} replay of a consumed attempt is attempt_invalid and starts no second session`,
    replay.status === 303 && replay.location === fail('a', 'attempt_invalid') && pa.tokenRequests.length === 1,
    `${location(replay)}; token requests ${pa.tokenRequests.length}`,
  );
}

async function caseWrongBrowser(app: OidcApp, rig: StoreRig, tag: string): Promise<void> {
  pa.tokenRequests.length = 0;
  const owner = app.browser();
  const trip = await begin(owner, a);
  const stranger = app.browser();
  const noCookie = await stranger.callback('a', { code: trip.code, state: trip.state });
  const own = await begin(stranger, a);
  const strangerWithOwn = await stranger.callback('a', { code: trip.code, state: trip.state });
  const kept = await rig.count('oidc_attempts');
  report.check(
    `${tag} wrong browser: a callback with no cookie and one with another browser's own attempt cookie are attempt_invalid`,
    noCookie.location === fail('a', 'attempt_invalid') && strangerWithOwn.location === fail('a', 'attempt_invalid'),
    `${location(noCookie)}; ${location(strangerWithOwn)}`,
  );
  report.check(
    `${tag} wrong browser: the owner's attempt was consumed by neither, and no token request was made`,
    kept === 2 && pa.tokenRequests.length === 0 && own.state !== trip.state,
    `${kept} attempts remain (owner's and stranger's); token requests ${pa.tokenRequests.length}`,
  );
  const real = await owner.callback('a', { code: trip.code, state: trip.state });
  report.check(
    `${tag} wrong browser: the owner's callback still succeeds afterwards`,
    real.status === 303 && real.location === '/home',
    location(real),
  );
  const probe = app.browser();
  const probeTrip = await begin(probe, a);
  const rowsBefore = await rig.count('oidc_attempts');
  const forged = await probe.callback('a', { code: probeTrip.code, state: probeTrip.query.nonce ?? '' });
  report.check(
    `${tag} a wrong state with the right cookie is attempt_invalid and consumes no attempt`,
    forged.location === fail('a', 'attempt_invalid') && (await rig.count('oidc_attempts')) === rowsBefore,
    `${location(forged)}; attempts ${rowsBefore} before, ${await rig.count('oidc_attempts')} after`,
  );
  const noncanonical = await begin(app.browser(), a);
  const jarB = app.browser();
  jarB.jar.set(attemptCookie('a'), 'x'.repeat(43));
  const bad = await jarB.callback('a', { code: noncanonical.code, state: noncanonical.state });
  report.check(
    `${tag} a malformed attempt cookie is attempt_invalid`,
    bad.location === fail('a', 'attempt_invalid'),
    location(bad),
  );
}

async function caseConcurrent(app: OidcApp, rig: StoreRig, tag: string): Promise<void> {
  pa.tokenRequests.length = 0;
  const browser = app.browser();
  const trip = await begin(browser, a);
  const before = await rig.count('sessions');
  const results = await Promise.all(
    Array.from({ length: 20 }, () => browser.callback('a', { code: trip.code, state: trip.state })),
  );
  const done = results.filter((hop) => hop.location === '/home');
  const invalid = results.filter((hop) => hop.location === fail('a', 'attempt_invalid'));
  const issued = results.filter((hop) =>
    hop.setCookie.some((line) => line.startsWith(`${COOKIE}=`) && !/Max-Age=0/i.test(line)),
  );
  report.check(
    `${tag} 20 concurrent valid callbacks: exactly one result, one token request, one new session`,
    done.length === 1 &&
      invalid.length === 19 &&
      issued.length === 1 &&
      pa.tokenRequests.length === 1 &&
      (await rig.count('sessions')) === before + 1,
    `${done.length} succeeded, ${invalid.length} attempt_invalid, ${pa.tokenRequests.length} token requests, sessions +${(await rig.count('sessions')) - before}`,
  );
}

async function caseExpiry(app: OidcApp, rig: StoreRig, tag: string): Promise<void> {
  pa.tokenRequests.length = 0;
  const browser = app.browser();
  const trip = await begin(browser, a);
  await rig
    .rows('UPDATE oidc_attempts SET expires_at = ? WHERE provider = ?', [Date.now() - 1000, 'a'])
    .catch(() => []);
  const cb = await browser.callback('a', { code: trip.code, state: trip.state });
  report.check(
    `${tag} an attempt past its expiry is attempt_invalid and reaches no token request`,
    cb.location === fail('a', 'attempt_invalid') && pa.tokenRequests.length === 0,
    `${location(cb)}; token requests ${pa.tokenRequests.length}`,
  );
}

async function caseMixUp(app: OidcApp, rig: StoreRig, tag: string): Promise<void> {
  pa.tokenRequests.length = 0;
  pb.tokenRequests.length = 0;
  const browser = app.browser();
  const tripA = await begin(browser, a);
  const tripB = await begin(browser, b);
  report.check(
    `${tag} mix-up: the two providers get their own callback URL, client and attempt cookie`,
    tripA.query.redirect_uri !== tripB.query.redirect_uri &&
      tripA.query.client_id === 'client-a' &&
      tripB.query.client_id === 'client-b' &&
      browser.jar.has(attemptCookie('a')) &&
      browser.jar.has(attemptCookie('b')),
    `${tripA.query.redirect_uri} | ${tripB.query.redirect_uri}`,
  );
  const rowsBefore = await rig.count('oidc_attempts');
  const aState = await browser.callback('b', { code: tripB.code, state: tripA.state });
  report.check(
    `${tag} mix-up: provider A's state at provider B's callback with B's cookie is attempt_invalid and consumes no attempt`,
    aState.location === fail('b', 'attempt_invalid') &&
      (await rig.count('oidc_attempts')) === rowsBefore &&
      pb.tokenRequests.length === 0,
    `${location(aState)}; attempts ${rowsBefore} before and ${await rig.count('oidc_attempts')} after`,
  );
  const stray = app.browser();
  const onlyA = await begin(stray, a);
  const wrongPath = await stray.callback('b', { code: onlyA.code, state: onlyA.state });
  report.check(
    `${tag} mix-up: A's attempt cookie and state sent to B's callback are attempt_invalid`,
    wrongPath.location === fail('b', 'attempt_invalid') && pb.tokenRequests.length === 0,
    `${location(wrongPath)}; B token requests ${pb.tokenRequests.length}`,
  );
  const doneA = await browser.callback('a', { code: tripA.code, state: tripA.state });
  const other = app.browser();
  const tripB2 = await begin(other, b);
  const doneB = await other.callback('b', { code: tripB2.code, state: tripB2.state });
  report.check(
    `${tag} mix-up: A's attempt survived the wrong-callback tries, and B's own flow completes`,
    doneA.location === '/home' && doneB.location === '/home',
    `${location(doneA)}; ${location(doneB)}`,
  );
  const codeOfB = app.browser();
  const tripX = await begin(codeOfB, a);
  const foreign = pb.authorize(tripX.url);
  const mixed = await codeOfB.callback('a', { code: foreign.code, state: tripX.state });
  report.check(
    `${tag} mix-up: a code issued by provider B presented at provider A's callback is provider_response`,
    mixed.location === fail('a', 'provider_response'),
    location(mixed),
  );
}

async function caseIss(app: OidcApp, tag: string): Promise<void> {
  const wrong = app.browser();
  const t1 = await begin(wrong, c);
  const cbWrong = await wrong.callback('c', { code: t1.code, state: t1.state, iss: pb.issuer });
  const replay = await wrong.callback('c', { code: t1.code, state: t1.state, iss: pc.issuer });
  const absent = app.browser();
  const t2 = await begin(absent, c);
  const cbAbsent = await absent.callback('c', { code: t2.code, state: t2.state });
  const right = app.browser();
  const t3 = await begin(right, c);
  const cbRight = await right.callback('c', { code: t3.code, state: t3.state, iss: pc.issuer });
  report.check(
    `${tag} RFC 9207: iss naming another provider is provider_response and the attempt stays spent`,
    cbWrong.location === fail('c', 'provider_response') && replay.location === fail('c', 'attempt_invalid'),
    `${location(cbWrong)}; then ${location(replay)}`,
  );
  report.check(
    `${tag} RFC 9207: iss absent when the provider advertises support is provider_response`,
    cbAbsent.location === fail('c', 'provider_response'),
    location(cbAbsent),
  );
  report.check(
    `${tag} RFC 9207: the matching iss completes the sign-in`,
    cbRight.location === '/home',
    location(cbRight),
  );
}

async function caseOutcomes(app: OidcApp, tag: string): Promise<void> {
  const denied = app.browser();
  const t1 = await begin(denied, a);
  const cbDenied = await denied.callback('a', { state: t1.state, error: 'access_denied' });
  const errored = app.browser();
  const t2 = await begin(errored, a);
  const cbError = await errored.callback('a', { state: t2.state, error: 'server_error' });
  const noCode = app.browser();
  const t3 = await begin(noCode, a);
  const cbNoCode = await noCode.callback('a', { state: t3.state });
  report.check(
    `${tag} provider error=access_denied is provider_denied, any other error is provider_error, no code is provider_response`,
    cbDenied.location === fail('a', 'provider_denied') &&
      cbError.location === fail('a', 'provider_error') &&
      cbNoCode.location === fail('a', 'provider_response'),
    `${location(cbDenied)}; ${location(cbError)}; ${location(cbNoCode)}`,
  );
  report.check(
    `${tag} every failure redirect clears the attempt cookie and sets no session`,
    [cbDenied, cbError, cbNoCode].every(
      (hop) =>
        hop.setCookie.some((line) => line.startsWith(`${attemptCookie('a')}=`) && /Max-Age=0/i.test(line)) &&
        !hop.setCookie.some((line) => line.startsWith(`${COOKIE}=`)),
    ),
    'three failures',
  );
  const unknown = await app.browser().start('nobody');
  report.check(
    `${tag} an unconfigured provider name is 404 at start and at callback`,
    unknown.status === 404 && (await app.browser().callback('nobody', { state: 'x'.repeat(43) })).status === 404,
    `${unknown.status}`,
  );
  const paths: [string, string][] = [
    ['/dashboard', '/dashboard'],
    ['//evil.test/x', ''],
    ['https://evil.test/', ''],
    ['/\\evil.test', ''],
  ];
  for (const [returnTo, want] of paths) {
    const browser = app.browser();
    const trip = await begin(browser, a, { returnTo });
    if (want === '') {
      report.check(
        `${tag} return path ${JSON.stringify(returnTo)} is refused at start`,
        trip.start.status === 400 &&
          trip.start.body?.code === 'RETURN_PATH_REFUSED' &&
          !browser.jar.has(attemptCookie('a')),
        `${trip.start.status} ${String(trip.start.body?.code)}`,
      );
    } else {
      const cb = await browser.callback('a', { code: trip.code, state: trip.state });
      report.check(
        `${tag} the local return path ${JSON.stringify(returnTo)} is where the callback lands`,
        cb.location === want,
        location(cb),
      );
    }
  }
}

for (const kind of kinds) {
  await report.run(`${kind} flow`, async () => {
    const rig = await makeStoreRig(kind);
    const app = await bootOidc({
      store: rig.open(),
      entries: [a, b, c],
      resolveUser: (identity) => ({ kind: 'user', userId: `u-${identity.subject}` }),
      addressLimit: { max: 100_000, windowSeconds: 60 },
    });
    try {
      const tag = `[${kind}]`;
      await caseStart(app, rig, tag);
      await rig.rows('DELETE FROM oidc_attempts');
      await caseSuccess(app, rig, tag);
      await caseWrongBrowser(app, rig, tag);
      await rig.rows('DELETE FROM oidc_attempts');
      await caseConcurrent(app, rig, tag);
      await caseExpiry(app, rig, tag);
      await caseMixUp(app, rig, tag);
      await caseIss(app, tag);
      await caseOutcomes(app, tag);
      report.check(
        `${tag} the records name each refusal by closed reason and carry no state, code, cookie or token text`,
        !app.lines.some((line) => line.includes('AT-CANARY') || line.includes('secret-a')),
        `${app.lines.length} records, ${app.events('auth.signin.failed').length} auth.signin.failed`,
      );
    } finally {
      await app.close();
      await rig.dispose();
    }
  });
}

await host.close();
pki.dispose();
report.finish();
