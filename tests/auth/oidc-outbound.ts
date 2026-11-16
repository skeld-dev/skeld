// Does:  Proves the OIDC outbound requests verify TLS, follow no redirect and stay bounded in time, size and concurrency.
// Holds: Browser input never names an outbound URL; cache freshness is never lengthened and stale data fails closed.
// biome-ignore-all lint/performance/noAwaitInLoops: each case is a request that must finish before the next
// biome-ignore-all lint/security/noSecrets: header names and canary text are fixtures, not secrets

import { type Browser, type OidcApp, type Trip, begin, bootOidc, COOKIE, location } from './rig/oidc-app.ts';
import { childPki } from './rig/pki.ts';
import { type Json, type Provider, providerHost, rsaKey } from './rig/provider.ts';
import { createReport } from './rig/report.ts';
import { type Kind, kinds, makeStoreRig, type StoreRig } from './rig/stores.ts';
import { sleep } from './rig/util.ts';

const pki = await childPki(import.meta.url);
const report = createReport(
  'v05',
  'oidc-outbound',
  'discovery, key and token requests verify TLS, follow no redirect, are bounded in concurrency, queue, time and body size; browser input names no outbound URL; freshness is never lengthened and stale data fails closed; rotation, an unknown kid and a shared refresh work without stale trust',
);
const host = await providerHost(pki.good);
const untrusted = await providerHost(pki.untrusted);
const wronghost = await providerHost(pki.wronghost);
const expired = await providerHost(pki.expired);
const target = await providerHost(pki.good);
const targetProvider = target.add('target', 'x', 'x');
let serial = 0;
const unavailable = (name: string): string => `/login?provider=${name}&error=provider_unavailable`;
const response = (name: string): string => `/login?provider=${name}&error=provider_response`;

interface Ctx {
  readonly app: OidcApp;
  readonly rig: StoreRig;
  readonly tag: string;
  readonly kind: Kind;
}

async function withApp(
  kind: Kind,
  entries: readonly { provider: Provider; name: string }[],
  body: (ctx: Ctx) => Promise<void>,
): Promise<void> {
  const rig = await makeStoreRig(kind);
  const app = await bootOidc({
    store: rig.open(),
    entries,
    resolveUser: (identity) => ({ kind: 'user', userId: `u-${identity.subject}` }),
    addressLimit: { max: 100_000, windowSeconds: 60 },
  });
  try {
    await body({ app, rig, tag: `[${kind}]`, kind });
  } finally {
    await app.close();
    await rig.dispose();
  }
}

function make(on = host, secret = 'secret-x'): { provider: Provider; name: string } {
  serial += 1;
  const name = `p${serial}`;
  return { provider: on.add(name, `client-${name}`, secret), name };
}

async function login(
  app: OidcApp,
  entry: { provider: Provider; name: string },
): Promise<{ hop: string; session: boolean; ms: number }> {
  const browser = app.browser();
  const began = performance.now();
  const trip = await begin(browser, entry);
  if (trip.url === '') {
    return { hop: `start ${trip.start.status}`, session: false, ms: performance.now() - began };
  }
  const hop = await browser.callback(entry.name, { code: trip.code, state: trip.state });
  return { hop: location(hop), session: browser.jar.has(COOKIE), ms: performance.now() - began };
}

async function tlsCases(kind: Kind): Promise<void> {
  const good = make();
  const certs = [
    ['an untrusted authority', make(untrusted), untrusted],
    ['a certificate for another host name', make(wronghost), wronghost],
    ['an expired certificate', make(expired), expired],
  ] as const;
  const viaToken = make(host);
  const viaJwks = make(host);
  const entries = [good, ...certs.map(([, entry]) => entry), viaToken, viaJwks];
  await withApp(kind, entries, async ({ app, tag }) => {
    const control = await app.browser().start(good.name);
    report.check(
      `${tag} control: a document over a certificate the authority signed for this host is served`,
      control.status === 200 && good.provider.hits.discovery === 1,
      `${control.status}`,
    );
    for (const [name, entry, server] of certs) {
      const started = await app.browser().start(entry.name);
      await sleep(50);
      report.check(
        `${tag} discovery over ${name} is refused: 503 PROVIDER_UNAVAILABLE and the server saw no HTTP request`,
        started.status === 503 &&
          started.body?.code === 'PROVIDER_UNAVAILABLE' &&
          entry.provider.hits.all === 0 &&
          started.setCookie.length === 0,
        `${started.status}; HTTP requests at the server ${entry.provider.hits.all}${server === expired ? '' : ''}`,
      );
    }
    viaToken.provider.docOverride = { token_endpoint: `${untrusted.base}/x/token` };
    const t = await login(app, viaToken);
    report.check(
      `${tag} a token endpoint over an untrusted authority fails the callback: provider_unavailable, no session`,
      t.hop === unavailable(viaToken.name) && !t.session,
      t.hop,
    );
    viaJwks.provider.docOverride = { jwks_uri: `${expired.base}/x/jwks` };
    const j = await login(app, viaJwks);
    report.check(
      `${tag} a key set over an expired certificate fails the callback: provider_unavailable, no session`,
      j.hop === unavailable(viaJwks.name) && !j.session,
      j.hop,
    );
  });
}

async function redirectCases(kind: Kind): Promise<void> {
  const viaDiscovery = make();
  const viaToken = make();
  const viaJwks = make();
  await withApp(kind, [viaDiscovery, viaToken, viaJwks], async ({ app, tag }) => {
    const before = targetProvider.hits.all;
    viaDiscovery.provider.discovery = ({ res }) => {
      res.writeHead(302, { location: `${targetProvider.issuer}/.well-known/openid-configuration` }).end();
    };
    const started = await app.browser().start(viaDiscovery.name);
    report.check(
      `${tag} a redirect from discovery is not followed: 503 PROVIDER_UNAVAILABLE and the target got no request`,
      started.status === 503 && targetProvider.hits.all === before,
      `${started.status}; target requests ${targetProvider.hits.all - before}`,
    );
    viaToken.provider.token = ({ res }) => {
      res.writeHead(307, { location: `${targetProvider.issuer}/token` }).end();
    };
    const t = await login(app, viaToken);
    report.check(
      `${tag} a redirect from the token endpoint is not followed: provider_response, no session, no request to the target`,
      t.hop === response(viaToken.name) && !t.session && targetProvider.hits.all === before,
      `${t.hop}; target requests ${targetProvider.hits.all - before}`,
    );
    viaJwks.provider.jwks = ({ res }) => {
      res.writeHead(301, { location: `${targetProvider.issuer}/jwks` }).end();
    };
    const j = await login(app, viaJwks);
    report.check(
      `${tag} a redirect from the key set is not followed: provider_unavailable, no session, no request to the target`,
      j.hop === unavailable(viaJwks.name) && !j.session && targetProvider.hits.all === before,
      `${j.hop}; target requests ${targetProvider.hits.all - before}`,
    );
  });
}

async function sizeCases(kind: Kind): Promise<void> {
  const big = make();
  const chunked = make();
  const lying = make();
  const short = make();
  const nearly = make();
  const html = make();
  const asHtml = make();
  await withApp(kind, [big, chunked, lying, short, nearly, html, asHtml], async ({ app, tag }) => {
    const pad = (bytes: number): Json => ({ ...big.provider.doc(), pad: 'x'.repeat(bytes) });
    big.provider.discovery = ({ res }) => {
      const body = JSON.stringify(pad(300_000));
      res.writeHead(200, { 'content-type': 'application/json', 'content-length': String(Buffer.byteLength(body)) });
      res.end(body);
    };
    const over = await app.browser().start(big.name);
    report.check(
      `${tag} a document whose declared length passes 262,144 bytes is refused unread: 503`,
      over.status === 503,
      `${over.status}`,
    );
    chunked.provider.discovery = ({ res }) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      const body = JSON.stringify({ ...chunked.provider.doc(), pad: 'x'.repeat(600_000) });
      for (let at = 0; at < body.length; at += 65_536) {
        res.write(body.slice(at, at + 65_536));
      }
      res.end();
    };
    const cut = await app.browser().start(chunked.name);
    report.check(`${tag} a chunked document past the bound is refused: 503`, cut.status === 503, `${cut.status}`);
    lying.provider.discovery = ({ res }) => {
      res.socket?.write(
        `HTTP/1.1 200 OK\r\ncontent-type: application/json\r\ncontent-length: 20\r\nconnection: close\r\n\r\n${JSON.stringify({ ...lying.provider.doc(), pad: 'y'.repeat(200_000) })}`,
      );
      res.socket?.end();
    };
    const liar = await app.browser().start(lying.name);
    report.check(
      `${tag} a body longer than its declared length is refused: 503`,
      liar.status === 503,
      `${liar.status}`,
    );
    short.provider.discovery = ({ res }) => {
      res.socket?.write(
        `HTTP/1.1 200 OK\r\ncontent-type: application/json\r\ncontent-length: 5000\r\nconnection: close\r\n\r\n${JSON.stringify(short.provider.doc())}`,
      );
      res.socket?.end();
    };
    const shorter = await app.browser().start(short.name);
    report.check(
      `${tag} a body shorter than its declared length is refused: 503`,
      shorter.status === 503,
      `${shorter.status}`,
    );
    nearly.provider.discovery = ({ json }) => json(200, { ...nearly.provider.doc(), pad: 'z'.repeat(200_000) });
    const fits = await app.browser().start(nearly.name);
    report.check(`${tag} a 200 KB document under the bound is accepted`, fits.status === 200, `${fits.status}`);
    html.provider.discovery = ({ res }) => {
      res.writeHead(200, { 'content-type': 'text/html' }).end('<html>not json</html>');
    };
    const page = await app.browser().start(html.name);
    report.check(`${tag} a body that is not a JSON object is refused: 503`, page.status === 503, `${page.status}`);
    // Why: The contract judges a body by its bytes alone, so a JSON object sent as text/html is accepted.
    asHtml.provider.discovery = ({ res }) => {
      res.writeHead(200, { 'content-type': 'text/html' }).end(JSON.stringify(asHtml.provider.doc()));
    };
    const typed = await app.browser().start(asHtml.name);
    report.check(
      `${tag} the media type is not judged (ADR-083): a JSON object sent as text/html is accepted`,
      typed.status === 200,
      `${typed.status}`,
    );
  });
}

async function timeCases(kind: Kind): Promise<void> {
  const head = make();
  const body = make();
  await withApp(kind, [head, body], async ({ app, tag }) => {
    head.provider.discovery = () => undefined;
    body.provider.discovery = ({ res }) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.write('{"issuer":');
    };
    const began = performance.now();
    const [a, b] = await Promise.all([app.browser().start(head.name), app.browser().start(body.name)]);
    const ms = Math.round(performance.now() - began);
    report.check(
      `${tag} a server that never answers, and one that stalls mid-body, both end at the 5 s deadline: 503`,
      a.status === 503 && b.status === 503 && ms >= 4900 && ms <= 6500,
      `${a.status}, ${b.status} after ${ms} ms (host shared with another verifier and an engineer)`,
    );
  });
}

async function burstCase(kind: Kind): Promise<void> {
  const burst = make();
  await withApp(kind, [burst], async ({ app, tag }) => {
    let active = 0;
    let peak = 0;
    burst.provider.token = ({ res }) => {
      active += 1;
      peak = Math.max(peak, active);
      setTimeout(() => {
        active -= 1;
        res.writeHead(400, { 'content-type': 'application/json' }).end('{"error":"invalid_grant"}');
      }, 1500);
    };
    const trips: { browser: Browser; trip: Trip }[] = [];
    for (let i = 0; i < 100; i++) {
      const browser = app.browser();
      trips.push({ browser, trip: await begin(browser, burst) });
    }
    const began = performance.now();
    const settled = await Promise.all(
      trips.map(async ({ browser, trip }) => {
        const hop = await browser.callback(burst.name, { code: trip.code, state: trip.state });
        return { hop: location(hop), ms: performance.now() - began };
      }),
    );
    const refusedList = settled.filter((item) => item.hop === unavailable(burst.name));
    const refusedAtOnce = refusedList.length;
    const answeredList = settled.filter((item) => item.hop === response(burst.name));
    const firstAnswer = Math.min(...answeredList.map((item) => item.ms));
    const lastRefusal = Math.max(...refusedList.map((item) => item.ms));
    const answered = settled.filter((item) => item.hop === response(burst.name)).length;
    report.check(
      `${tag} 100 concurrent token requests: at most 16 in flight at the provider`,
      peak <= 16 && peak > 1,
      `peak in flight ${peak}`,
    );
    report.check(
      `${tag} 16 run, 64 wait their turn and the other 20 are refused at once (provider_unavailable)`,
      answered === 80 &&
        refusedAtOnce === 20 &&
        burst.provider.tokenRequests.length === 80 &&
        lastRefusal < firstAnswer,
      `${answered} reached the provider and were answered, ${refusedAtOnce} refused, the last after ${Math.round(lastRefusal)} ms and before the first answer at ${Math.round(firstAnswer)} ms, provider saw ${burst.provider.tokenRequests.length}`,
    );
    burst.provider.token = null;
    const retry = await login(app, burst);
    report.check(
      `${tag} a refusal by the process's own bound starts no cooldown: the next login runs straight away`,
      retry.session,
      retry.hop,
    );
  });
}

async function injectionCases(kind: Kind): Promise<void> {
  const entry = make();
  await withApp(kind, [entry], async ({ app, tag }) => {
    const before = targetProvider.hits.all;
    const sink = `${target.base}/target`;
    const browser = app.browser();
    const started = await browser.start(entry.name, { returnTo: sink });
    const trip = await begin(app.browser(), entry);
    const names = ['%2e%2e%2f', encodeURIComponent(sink), `${entry.name}%00`, '__proto__'];
    const odd: number[] = [];
    for (const name of names) {
      odd.push(
        (
          await fetch(
            `${app.base}/auth/oidc/${name}/callback?state=${'a'.repeat(43)}&iss=${encodeURIComponent(sink)}`,
            {
              redirect: 'manual',
              headers: { host: new URL(target.base).host, 'x-forwarded-host': new URL(target.base).host },
            },
          )
        ).status,
      );
    }
    const cb = await app
      .browser()
      .callback(entry.name, { code: trip.code, state: trip.state, iss: sink, error_uri: sink });
    const withHeaders = await fetch(`${app.base}/auth/oidc/${entry.name}/start`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: app.origin,
        host: new URL(target.base).host,
        'x-forwarded-host': new URL(target.base).host,
        referer: sink,
      },
      body: '{}',
    });
    await sleep(100);
    report.check(
      `${tag} a returnTo, iss, error_uri, provider name and Host naming another server cause no request to it`,
      started.status === 400 && targetProvider.hits.all === before,
      `start ${started.status}; callback ${location(cb)}; odd names ${odd.join(',')}; start with hostile headers ${withHeaders.status}; requests to the named server ${targetProvider.hits.all - before}`,
    );
    const ok = await login(app, entry);
    report.check(`${tag} the legitimate login still works against the configured endpoints`, ok.session, ok.hop);
  });
}

async function freshnessCases(kind: Kind): Promise<void> {
  const noStore = make();
  const longLived = make();
  const unreadable = make();
  const aged = make();
  const stale = make();
  const looseDates = ['5000', '99999', '2099'].map((text) => ({ text, entry: make() }));
  const validDate = make();
  const looseDate = make();
  const entries = [
    noStore,
    longLived,
    unreadable,
    aged,
    stale,
    validDate,
    looseDate,
    ...looseDates.map(({ entry }) => entry),
  ];
  await withApp(kind, entries, async ({ app, tag }) => {
    const starts = async (
      entry: { provider: Provider; name: string },
      header: Record<string, string> = {},
      count = 3,
    ): Promise<number> => {
      entry.provider.discovery = ({ json }) => json(200, entry.provider.doc(), header);
      const first = entry.provider.hits.discovery;
      for (let i = 0; i < count; i++) {
        await app.browser().start(entry.name);
      }
      return entry.provider.hits.discovery - first;
    };
    report.check(
      `${tag} max-age=300 serves three starts from one fetch`,
      (await starts(longLived, { 'cache-control': 'max-age=300' })) === 1,
      'fetches 1',
    );
    report.check(
      `${tag} no-store is fetched every time`,
      (await starts(noStore, { 'cache-control': 'no-store' })) === 3,
      'fetches 3',
    );
    report.check(
      `${tag} an unreadable max-age counts as max-age=0: fetched every time`,
      (await starts(unreadable, { 'cache-control': 'max-age=abc' })) === 3,
      'fetches 3',
    );
    for (const { text, entry } of looseDates) {
      report.check(
        `${tag} an Expires of "${text}" is not an HTTP date: it counts as unreadable, so the next use refetches (3 starts, 3 fetches)`,
        (await starts(entry, { 'cache-control': '', expires: text })) === 3,
        'fetches 3',
      );
    }
    report.check(
      `${tag} a valid IMF-fixdate Expires an hour ahead keeps the document fresh: three starts, one fetch`,
      (await starts(validDate, { 'cache-control': '', expires: new Date(Date.now() + 3_600_000).toUTCString() })) === 1,
      'fetches 1',
    );
    report.check(
      `${tag} a Date of "5000" beside a valid future Expires is unreadable too: the next use refetches (3 fetches)`,
      (await starts(looseDate, {
        'cache-control': '',
        expires: new Date(Date.now() + 3_600_000).toUTCString(),
        date: '5000',
      })) === 3,
      'fetches 3',
    );
    const agedFetches = await starts(aged, { 'cache-control': 'max-age=2', age: '1' }, 1);
    await sleep(1300);
    await app.browser().start(aged.name);
    report.check(
      `${tag} Age is deducted: max-age=2 with Age 1 is fresh for about 1 s, not 2`,
      agedFetches === 1 && aged.provider.hits.discovery === 2,
      `fetches ${aged.provider.hits.discovery} after 1.3 s`,
    );

    stale.provider.cacheControl = 'max-age=2';
    stale.provider.jwksCacheControl = 'max-age=2';
    const fine = await login(app, stale);
    report.check(`${tag} control: a login with a short-lived document and key set succeeds`, fine.session, fine.hop);
    stale.provider.discovery = ({ res }) => res.destroy();
    stale.provider.jwks = ({ res }) => res.destroy();
    const fetchesBefore = stale.provider.hits.discovery;
    await sleep(2300);
    const lapsed = await app.browser().start(stale.name);
    report.check(
      `${tag} past its freshness the document is not trusted: the refetch fails and the start is 503 (stale fails closed)`,
      lapsed.status === 503 && stale.provider.hits.discovery === fetchesBefore + 1,
      `${lapsed.status}; refetches ${stale.provider.hits.discovery - fetchesBefore}`,
    );
    const again = await app.browser().start(stale.name);
    report.check(
      `${tag} the failed fetch starts a cooldown: the next start is 503 with no request`,
      again.status === 503 && stale.provider.hits.discovery === fetchesBefore + 1,
      `${again.status}; fetches ${stale.provider.hits.discovery - fetchesBefore}`,
    );
  });
}

async function keyCases(kind: Kind): Promise<void> {
  const rotating = make();
  const unknown = make();
  const shared = make();
  const down = make();
  const crowded = make();
  const repeated = make();
  await withApp(kind, [rotating, unknown, shared, down, crowded, repeated], async ({ app, tag }) => {
    const second = rsaKey(`${rotating.provider.clientId}-k2`);
    const first = await login(app, rotating);
    report.check(
      `${tag} control: the first login fetches the key set once`,
      first.session && rotating.provider.hits.jwks === 1,
      `${first.hop}; fetches ${rotating.provider.hits.jwks}`,
    );
    const original = rotating.provider.key;
    rotating.provider.jwks = ({ json }) => json(200, { keys: [original.jwk, second.jwk] });
    rotating.provider.key = second;
    const rotated = await login(app, rotating);
    report.check(
      `${tag} key rotation: an ID Token under a new kid forces one refresh and verifies`,
      rotated.session && rotating.provider.hits.jwks === 2,
      `${rotated.hop}; fetches ${rotating.provider.hits.jwks}`,
    );

    await login(app, unknown);
    const hitsBefore = unknown.provider.hits.jwks;
    const hidden = rsaKey('never-published');
    unknown.provider.signWith = hidden;
    unknown.provider.header = (header) => ({ ...header, kid: hidden.kid });
    const lost = await login(app, unknown);
    const lostAgain = await login(app, unknown);
    unknown.provider.signWith = null;
    unknown.provider.header = (header) => header;
    await app.settle();
    report.check(
      `${tag} an unknown kid forces one refresh and is provider_response; a second within the minute makes no fetch`,
      lost.hop === response(unknown.name) &&
        lostAgain.hop === response(unknown.name) &&
        unknown.provider.hits.jwks === hitsBefore + 1,
      `${lost.hop}; ${lostAgain.hop}; fetches +${unknown.provider.hits.jwks - hitsBefore}`,
    );

    await login(app, shared);
    const sharedKey = rsaKey(`${shared.provider.clientId}-k9`);
    shared.provider.jwks = ({ json }) => {
      setTimeout(() => json(200, { keys: [sharedFirst.jwk, sharedKey.jwk] }), 300);
    };
    shared.provider.signWith = sharedKey;
    const sharedFirst = shared.provider.key;
    shared.provider.header = (header) => ({ ...header, kid: sharedKey.kid });
    const sharedBefore = shared.provider.hits.jwks;
    const trips: { browser: Browser; trip: Trip }[] = [];
    for (let i = 0; i < 10; i++) {
      const browser = app.browser();
      trips.push({ browser, trip: await begin(browser, shared) });
    }
    const results = await Promise.all(
      trips.map(async ({ browser, trip }) =>
        location(await browser.callback(shared.name, { code: trip.code, state: trip.state })),
      ),
    );
    report.check(
      `${tag} ten callbacks under one unknown kid share one refresh and all verify`,
      results.every((hop) => hop === '/home') && shared.provider.hits.jwks === sharedBefore + 1,
      `${results.filter((hop) => hop === '/home').length} of 10 signed in; fetches +${shared.provider.hits.jwks - sharedBefore}`,
    );

    down.provider.jwks = ({ json }) => json(500, { error: 'down' });
    const downBefore = down.provider.hits.jwks;
    const gone = await login(app, down);
    const goneAgain = await login(app, down);
    await app.settle();
    const reasons = app
      .events('auth.keys.unavailable')
      .map((record) => `${String(record.fields?.['auth.source'])}:${String(record.fields?.['auth.reason'])}`);
    report.check(
      `${tag} a failing key set is provider_unavailable with one auth.keys.unavailable each, and a 60 s cooldown makes no second fetch`,
      gone.hop === unavailable(down.name) &&
        goneAgain.hop === unavailable(down.name) &&
        down.provider.hits.jwks === downBefore + 1 &&
        reasons.filter((reason) => reason.startsWith(`${down.name}:`)).length === 2,
      `${gone.hop}; ${goneAgain.hop}; fetches +${down.provider.hits.jwks - downBefore}; records ${reasons.join(', ')}`,
    );

    crowded.provider.jwks = ({ json }) =>
      json(200, { keys: Array.from({ length: 33 }, (_, i) => rsaKey(`many-${i}`, 2048).jwk) });
    const many = await login(app, crowded);
    report.check(
      `${tag} a key set of 33 entries is refused whole: provider_unavailable`,
      many.hop === unavailable(crowded.name),
      many.hop,
    );
    const dup = rsaKey('same');
    repeated.provider.jwks = ({ json }) =>
      json(200, { keys: [dup.jwk, { ...repeated.provider.key.jwk, kid: 'same' }] });
    const twice = await login(app, repeated);
    report.check(
      `${tag} a key set that repeats a kid is refused whole: provider_unavailable`,
      twice.hop === unavailable(repeated.name),
      twice.hop,
    );
  });
}

for (const kind of kinds) {
  await report.run(`${kind} outbound`, async () => {
    await tlsCases(kind);
    await redirectCases(kind);
    await sizeCases(kind);
    await timeCases(kind);
    await burstCase(kind);
    await injectionCases(kind);
    await freshnessCases(kind);
    await keyCases(kind);
  });
}

for (const server of [host, untrusted, wronghost, expired, target]) {
  await server.close();
}
pki.dispose();
report.finish();
