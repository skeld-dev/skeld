// Does:  Proves the OIDC sign-in and its cookies in a real Chromium: attributes, scoping, cross-site and profiles.
// Holds: The browser trusts only this run's certificate key; a second profile follows the first one's callback and consumes nothing.
// biome-ignore-all lint/performance/noAwaitInLoops: each store kind is a sequential run with its own browsers
// biome-ignore-all lint/security/noSecrets: cookie and header names are fixtures, not secrets

import { createServer } from 'node:net';
import { type BrowserCookie, type Chrome, launch } from './rig/cdp.ts';
import { bootOidc, COOKIE } from './rig/oidc-app.ts';
import { childPki } from './rig/pki.ts';
import { providerHost } from './rig/provider.ts';
import { createReport } from './rig/report.ts';
import { kinds, makeStoreRig } from './rig/stores.ts';
import { isRecord, sleep } from './rig/util.ts';

const pki = await childPki(import.meta.url);
const report = createReport(
  'v05',
  'oidc-browser',
  "in a real Chromium the host-only __Host- session and attempt cookies are accepted, stored and sent exactly as their attributes say across the redirect to the provider and back; a cross-site unsafe request is refused; a second profile that follows the first profile's callback consumes nothing; sign-out clears the cookie",
);
const host = await providerHost(pki.good, '127.0.0.1');

async function freePort(): Promise<number> {
  const probe = createServer();
  await new Promise<void>((resolve) => probe.listen(0, '127.0.0.1', resolve));
  const address = probe.address();
  const port = typeof address === 'object' && address !== null ? address.port : 0;
  await new Promise<void>((resolve) => probe.close(() => resolve()));
  return port;
}

const attempt = `${COOKIE}-oidc-a`;
const find = (cookies: readonly BrowserCookie[], name: string): BrowserCookie | undefined =>
  cookies.find((cookie) => cookie.name === name);
const describe = (cookie: BrowserCookie | undefined): string =>
  cookie === undefined
    ? 'absent'
    : `${cookie.name} domain=${cookie.domain} path=${cookie.path} secure=${cookie.secure} httpOnly=${cookie.httpOnly} sameSite=${cookie.sameSite} session=${cookie.session}`;

async function pageJson(chrome: Chrome, expression: string): Promise<Record<string, unknown>> {
  const value = await chrome.evaluate(expression);
  return isRecord(value) ? value : {};
}

for (const kind of kinds) {
  await report.run(`${kind} browser`, async () => {
    const tag = `[${kind}]`;
    const rig = await makeStoreRig(kind);
    const port = await freePort();
    const origin = `http://localhost:${port}`;
    const provider = host.add(`b-${kind}`, 'client-b', 'secret-b');
    const app = await bootOidc({
      store: rig.open(),
      entries: [{ provider, name: 'a' }],
      resolveUser: (identity) => ({ kind: 'user', userId: `u-${identity.subject}` }),
      origin,
      addressLimit: { max: 100_000, windowSeconds: 60 },
    });
    const first = await launch([pki.good.spki]);
    let second: Chrome | null = null;
    try {
      report.note(
        `${tag} browser ${first.version}; the app at ${origin} (plain http on the loopback name localhost), the provider at ${host.base} (https, a certificate this run made, trusted by the browser through the SPKI allow-list of that one key only)`,
      );
      await first.navigate(`${origin}/auth/session`);
      const none = await pageJson(first, "fetch('/auth/session').then((r) => r.json())");
      report.check(`${tag} a fresh profile has no session`, none.status === 'none', JSON.stringify(none));

      const start = await pageJson(
        first,
        "fetch('/auth/oidc/a/start', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }).then((r) => r.json())",
      );
      const authorizeUrl = String(start.url);
      let cookies = await first.cookies();
      const stored = find(cookies, attempt);
      report.check(
        `${tag} the browser accepts and stores the __Host- attempt cookie at an http loopback origin: host-only, Path=/, Secure, HttpOnly, SameSite=Lax, 600 s`,
        stored?.domain === 'localhost' &&
          stored.path === '/' &&
          stored.secure &&
          stored.httpOnly &&
          stored.sameSite === 'Lax' &&
          !stored.session &&
          stored.expires - Date.now() / 1000 > 590 &&
          stored.expires - Date.now() / 1000 <= 600,
        describe(stored),
      );
      const visible = String(await first.evaluate('document.cookie'));
      report.check(
        `${tag} the HttpOnly cookie is not visible to page script`,
        !visible.includes('__Host'),
        `document.cookie = ${JSON.stringify(visible)}`,
      );

      const landed = await first.navigate(authorizeUrl);
      cookies = await first.cookies();
      const sessionCookie = find(cookies, COOKIE);
      const sentToProvider = provider.authorizeCookies.at(-1);
      report.check(
        `${tag} the redirect to the provider on another host carried no cookie of the app (host-only scoping)`,
        provider.hits.authorize === 1 && sentToProvider === undefined,
        `provider authorize requests ${provider.hits.authorize}; Cookie header there: ${sentToProvider === undefined ? 'none' : 'present'}`,
      );
      report.check(
        `${tag} the redirect back is a cross-site top-level GET: the Lax attempt cookie was sent, the sign-in completed and the page landed on /home`,
        landed === `${origin}/home`,
        landed,
      );
      const callback = first.seen.find((item) => item.url.includes('/auth/oidc/a/callback'));
      report.check(
        `${tag} the browser's own callback request carried the attempt cookie and nothing else of the app's`,
        callback?.cookieNames.join(',') === attempt,
        `cookies sent: ${callback?.cookieNames.join(',')}; blocked: ${callback?.blocked.join(',') || 'none'}`,
      );
      report.check(
        `${tag} the session cookie is stored host-only, Path=/, Secure, HttpOnly, SameSite=Lax, and the attempt cookie is gone`,
        sessionCookie?.domain === 'localhost' &&
          sessionCookie.path === '/' &&
          sessionCookie.secure &&
          sessionCookie.httpOnly &&
          sessionCookie.sameSite === 'Lax' &&
          find(cookies, attempt) === undefined,
        describe(sessionCookie),
      );

      const state = await pageJson(first, "fetch('/auth/session').then((r) => r.json())");
      report.check(
        `${tag} a same-site request now sends the session cookie: status session for the mapped user`,
        state.status === 'session' && state.userId === 'u-subject-1' && typeof state.csrfToken === 'string',
        `${String(state.status)} ${String(state.userId)}`,
      );
      const sessionRequest = first.seen.filter((item) => item.url.endsWith('/auth/session')).at(-1);
      report.check(
        `${tag} that request carried the session cookie by name`,
        sessionRequest?.cookieNames.includes(COOKIE) === true,
        `cookies sent: ${sessionRequest?.cookieNames.join(',')}`,
      );

      const refusedBefore = app.events('skeld.refuse.csrf').length;
      await first.navigate(`${host.base}/x/none`);
      const cross = await pageJson(
        first,
        `fetch('${origin}/auth/sign-out', { method: 'POST', credentials: 'include', mode: 'no-cors' }).then((r) => ({ type: r.type })).catch((e) => ({ error: String(e) }))`,
      );
      await first.evaluate(
        `document.body.innerHTML = '<form id="f" method="POST" action="${origin}/auth/sign-out"><input name="x" value="1"></form>'; undefined`,
      );
      const posted = first.seen.length;
      await first.evaluate("document.getElementById('f').submit(); undefined");
      await sleep(600);
      const crossRequests = first.seen.slice(posted - 1).filter((item) => item.url.endsWith('/auth/sign-out'));
      const crossFetch = first.seen
        .filter((item) => item.url.endsWith('/auth/sign-out') && item.method === 'POST')
        .at(0);
      await app.settle();
      report.check(
        `${tag} a cross-site unsafe POST (fetch with credentials, and a form post) is refused 403 and the Lax session cookie was not sent`,
        [crossFetch, ...crossRequests].every((item) => item?.status === 403 && !item.cookieNames.includes(COOKIE)) &&
          app.events('skeld.refuse.csrf').length >= refusedBefore + 1,
        `fetch ${JSON.stringify(cross)}; statuses ${[crossFetch, ...crossRequests].map((item) => item?.status).join(',')}; cookie withheld/blocked: ${[crossFetch, ...crossRequests].map((item) => item?.blocked.join('+') || 'none').join(',')}; skeld.refuse.csrf records +${app.events('skeld.refuse.csrf').length - refusedBefore}`,
      );

      await first.navigate(`${origin}/auth/session`);
      const still = await pageJson(first, "fetch('/auth/session').then((r) => r.json())");
      report.check(
        `${tag} the cross-site attempts changed nothing: the session is still live`,
        still.status === 'session',
        String(still.status),
      );

      const noToken = await pageJson(
        first,
        "fetch('/auth/sign-out', { method: 'POST' }).then(async (r) => ({ status: r.status, body: await r.json() }))",
      );
      report.check(
        `${tag} a same-origin sign-out without the session-bound token is refused 403 CSRF_TOKEN_INVALID and the session stays`,
        noToken.status === 403 &&
          isRecord(noToken.body) &&
          noToken.body.code === 'CSRF_TOKEN_INVALID' &&
          (await pageJson(first, "fetch('/auth/session').then((r) => r.json())")).status === 'session',
        JSON.stringify(noToken),
      );
      const token = String(state.csrfToken);
      const out = await pageJson(
        first,
        `fetch('/auth/sign-out', { method: 'POST', headers: { 'x-csrf-token': '${token}' } }).then((r) => ({ status: r.status }))`,
      );
      cookies = await first.cookies();
      const after = await pageJson(first, "fetch('/auth/session').then((r) => r.json())");
      report.check(
        `${tag} sign-out with the token is 204, clears the session cookie in the browser and ends the session`,
        out.status === 204 &&
          find(cookies, COOKIE) === undefined &&
          after.status === 'none' &&
          (await rig.count('sessions')) === 0,
        `${JSON.stringify(out)}; cookie ${describe(find(cookies, COOKIE))}; session ${String(after.status)}; sessions rows ${await rig.count('sessions')}`,
      );

      const again = await pageJson(
        first,
        "fetch('/auth/oidc/a/start', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }).then((r) => r.json())",
      );
      const issued = provider.authorize(String(again.url));
      const callbackUrl = `${origin}/auth/oidc/a/callback?${new URLSearchParams({ code: issued.code, state: issued.state }).toString()}`;
      second = await launch([pki.good.spki]);
      const attemptsBefore = await rig.count('oidc_attempts');
      const strangerLanded = await second.navigate(callbackUrl);
      const strangerCookies = await second.cookies();
      report.check(
        `${tag} a second profile that follows the first profile's callback URL lands on attempt_invalid with no cookie`,
        strangerLanded === `${origin}/login?provider=a&error=attempt_invalid` && strangerCookies.length === 0,
        `${strangerLanded}; cookies ${strangerCookies.length}`,
      );
      report.check(
        `${tag} the second profile consumed nothing: the attempt is still in the store and the provider got no token request`,
        (await rig.count('oidc_attempts')) === attemptsBefore && provider.tokenRequests.length === 1,
        `attempts ${attemptsBefore} before, ${await rig.count('oidc_attempts')} after; token requests ${provider.tokenRequests.length}`,
      );
      const ownerLanded = await first.navigate(callbackUrl);
      const ownerCookies = await first.cookies();
      report.check(
        `${tag} the first profile then completes with the same URL: session cookie set`,
        ownerLanded === `${origin}/home` && find(ownerCookies, COOKIE) !== undefined,
        `${ownerLanded}; ${describe(find(ownerCookies, COOKIE))}`,
      );
      const replayed = await first.navigate(callbackUrl);
      report.check(
        `${tag} reloading the consumed callback URL is attempt_invalid`,
        replayed === `${origin}/login?provider=a&error=attempt_invalid`,
        replayed,
      );
    } finally {
      await first.close();
      await second?.close();
      await app.close();
      await rig.dispose();
    }
  });
}

await host.close();
pki.dispose();
report.finish();
