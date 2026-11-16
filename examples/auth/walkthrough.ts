import { setTimeout as sleep } from 'node:timers/promises';
import { needsRehash } from '@skeld/auth/password';
import { oidcRoutes, sessionRoutes } from '@skeld/auth/routes';
import { createClient } from '@skeld/core/client';
import { Secret } from '@skeld/core/secret';
import { startExample } from './app.ts';
import { appContract } from './contract.ts';
import { type ChangeDeps, changePassword, reconcile } from './credential-change.ts';
import { receiveLaunch } from './launch.ts';
import { PASSWORD_COST } from './login.ts';

// Runs the example end to end: started by with-local-provider.ts, it starts the example on the port it is given,
// drives it over HTTP like a browser and an API client would, and checks each answer. Exits non-zero at the
// first answer that is not the expected one.

const launch = await receiveLaunch();
const records: string[] = [];
const example = await startExample({
  port: launch.port,
  provider: launch.provider,
  // Room for every sign-in below; the last section then uses up the rest to show the limit.
  loginLimit: { max: 80, windowSeconds: 600 },
  logSink: (lines) => {
    records.push(...lines);
  },
});
const { origin } = example;
// Every secret the run sees, to check at the end that none reached a log record.
const secrets = new Set<string>();

async function run(): Promise<void> {
  await loginFailures();
  const alice = await sessionsAndGrants();
  await apiKey(alice);
  await bearerJwt();
  await oidcSignIns();
  await signOut(alice);
  const changed = await completedChange(password('alice'));
  const interrupted = await interruptedChanges(changed);
  const serialized = await reconcileWaits(interrupted);
  const afterRogue = await enableOutsideTheLock(serialized);
  const settled = await staleEnable(afterRogue);
  await loginLimit(settled);
  logs();
}

async function loginFailures(): Promise<void> {
  section('Login failures: limit first, then one verification, one answer');
  const visitor = createBrowser(origin);
  const known = await rawLogin(visitor, 'alice', `${password('alice')}-wrong`);
  const unknown = await rawLogin(visitor, 'nobody', 'any-password-at-all');
  check('wrong password for a known user is 401', known.status === 401);
  check('unknown user is 401', unknown.status === 401);
  check('both bodies are byte-identical', known.body === unknown.body);
  check('both header sets match apart from date and x-request-id', known.headers === unknown.headers);
  say(`    body: ${known.body}`);
}

async function sessionsAndGrants(): Promise<Browser> {
  section('Sign in, rehash, session status');
  const alice = createBrowser(origin);
  const aliceApp = alice.client();
  const before = example.users.findById('alice')?.passwordHash ?? '';
  const signedIn = await aliceApp.login({ body: { username: 'alice', password: password('alice') } });
  check('alice signs in: 200', signedIn.status === 200);
  if (signedIn.status !== 200 || signedIn.body.status !== 'session') {
    throw new Error('no session');
  }
  alice.csrfToken = signedIn.body.csrfToken;
  const after = example.users.findById('alice')?.passwordHash ?? '';
  say(`    stored hash parameters: ${parameters(before)} -> ${parameters(after)}`);
  check(
    'needsRehash was true before and is false after',
    needsRehash(before, PASSWORD_COST) && !needsRehash(after, PASSWORD_COST),
  );
  const status = await alice.sessions().authSession();
  check(
    'GET /auth/session reports alice',
    status.status === 200 && status.body.status === 'session' && status.body.userId === 'alice',
  );

  section('Grants: tenant members act on their documents through operations');
  check('alice reads acme-plan: 200', (await aliceApp.readDocument({ params: { id: 'acme-plan' } })).status === 200);
  const written = await aliceApp.writeDocument({
    params: { id: 'acme-plan' },
    body: { body: 'Ship the widget twice.' },
  });
  check('alice writes acme-plan with the CSRF header: 200', written.status === 200);
  const noCsrf = alice.client(null);
  const refused = await noCsrf.writeDocument({ params: { id: 'acme-plan' }, body: { body: 'no token' } });
  check(
    'the same write without x-csrf-token: 403 CSRF_TOKEN_INVALID',
    refused.status === 403 && codeOf(refused.body) === 'CSRF_TOKEN_INVALID',
  );
  check(
    'alice reads globex-plan (other tenant): 404',
    (await aliceApp.readDocument({ params: { id: 'globex-plan' } })).status === 404,
  );
  const bob = createBrowser(origin);
  const bobApp = bob.client();
  const bobIn = await bobApp.login({ body: { username: 'bob', password: password('bob') } });
  if (bobIn.status !== 200 || bobIn.body.status !== 'session') {
    throw new Error('bob has no session');
  }
  bob.csrfToken = bobIn.body.csrfToken;
  check('bob reads globex-plan: 200', (await bobApp.readDocument({ params: { id: 'globex-plan' } })).status === 200);
  check('bob reads acme-plan: 404', (await bobApp.readDocument({ params: { id: 'acme-plan' } })).status === 404);
  const bobWrite = await bobApp.writeDocument({ params: { id: 'acme-plan' }, body: { body: 'taken over' } });
  check('bob writes acme-plan: 404', bobWrite.status === 404);
  return alice;
}

async function apiKey(alice: Browser): Promise<void> {
  const aliceApp = alice.client();
  section('API key: issued by a signed-in user, used as a bearer credential, revoked');
  const issued = await aliceApp.issueApiKey({ body: { name: 'walkthrough' } });
  if (issued.status !== 201) {
    throw new Error(`API key not issued: ${issued.status}`);
  }
  const key = issued.body.key;
  secrets.add(key);
  check('alice issues a key scoped documents:read: 201', key.startsWith('skeld1.'));
  const keyApp = createClient(appContract, { baseUrl: origin, credential: { kind: 'bearer', token: () => key } });
  check('the key reads acme-plan: 200', (await keyApp.readDocument({ params: { id: 'acme-plan' } })).status === 200);
  const keyWrite = await keyApp.writeDocument({ params: { id: 'acme-plan' }, body: { body: 'by key' } });
  check('the key writes acme-plan (no documents:write scope): 403', keyWrite.status === 403);
  check(
    'the key reads globex-plan: 404',
    (await keyApp.readDocument({ params: { id: 'globex-plan' } })).status === 404,
  );
  const revoked = await aliceApp.revokeApiKey({ params: { keyId: issued.body.keyId } });
  check('alice revokes the key: 204', revoked.status === 204);
  check(
    'the revoked key reads acme-plan: 401',
    (await keyApp.readDocument({ params: { id: 'acme-plan' } })).status === 401,
  );
}

async function bearerJwt(): Promise<void> {
  section('JWT from the local issuer');
  const token = example.issuerToken('alice');
  const stranger = example.issuerToken('nobody');
  secrets.add(token);
  secrets.add(stranger);
  const jwtApp = createClient(appContract, { baseUrl: origin, credential: { kind: 'bearer', token: () => token } });
  const report = await jwtApp.readReport();
  check('a JWT for alice reaches /reports/me: 200', report.status === 200 && report.body.userId === 'alice');
  const strangerApp = createClient(appContract, {
    baseUrl: origin,
    credential: { kind: 'bearer', token: () => stranger },
  });
  check('a JWT for a subject map denies: 401', (await strangerApp.readReport()).status === 401);
  check(
    'a JWT on the documents route (session or key only): 401',
    (await jwtApp.readDocument({ params: { id: 'acme-plan' } })).status === 401,
  );
}

async function oidcSignIns(): Promise<void> {
  section('OIDC sign-in through the local provider');
  const mapped = await oidcSignIn(createBrowser(origin), 'p-alice');
  check('p-alice, mapped to alice: 303 to /', mapped.location === '/');
  check('p-alice gets a session for alice', mapped.userId === 'alice');
  const unmapped = await oidcSignIn(createBrowser(origin), 'p-mallory');
  check(
    'p-mallory, mapped to no one: 303 to the failure path',
    unmapped.location === '/?provider=local&error=mapping_denied',
  );
  check('p-mallory gets no session', unmapped.userId === null);
}

async function signOut(alice: Browser): Promise<void> {
  section('Sign-out');
  const oldCookie = alice.cookie();
  const signedOut = await alice.sessions().authSignOut();
  check('POST /auth/sign-out with the CSRF header: 204', signedOut.status === 204);
  check(
    'the signed-out cookie is refused: 401',
    (await createBrowser(origin, oldCookie).sessions().authSession()).status === 401,
  );
}

async function completedChange(current: string): Promise<string> {
  section('Password change, run to completion');
  const first = await signIn('alice', current);
  const second = await signIn('alice', current);
  const next = newPassword();
  const changed = await first.client().changePassword({ body: { currentPassword: current, newPassword: next } });
  check('POST /account/password: 204', changed.status === 204);
  check('the session that asked is ended: 401', (await first.sessions().authSession()).status === 401);
  check('the other session is ended: 401', (await second.sessions().authSession()).status === 401);
  check('the old password is refused: 401', (await rawLogin(createBrowser(origin), 'alice', current)).status === 401);
  check('the new password signs in: 200', (await rawLogin(createBrowser(origin), 'alice', next)).status === 200);
  return next;
}

async function interruptedChanges(start: string): Promise<string> {
  section('Password change, interrupted at each point');
  let current = start;
  for (const point of POINTS) {
    say(`  - ${point.name}`);
    // biome-ignore lint/performance/noAwaitInLoops: each point starts from the state the previous one settled.
    current = await interruptAt(point, current);
  }
  return current;
}

// Runs one interrupted change and its reconciliation; answers the password the record holds afterwards.
async function interruptAt(point: (typeof POINTS)[number], current: string): Promise<string> {
  const real = example.changeDeps;
  const held = await signIn('alice', current);
  const candidate = newPassword();
  const outcome = await changePassword(
    point.deps(real),
    'alice',
    new Secret(current),
    new Secret(candidate),
    AbortSignal.timeout(10_000),
  ).then(
    (answer) => answer.kind + ('step' in answer ? `:${answer.step}` : ''),
    () => 'crashed',
  );
  check(`the change answers ${point.answer}`, outcome === point.answer);
  const subject = await example.auth.subjects.read('alice');
  const disabled = subject.kind === 'subject' && !subject.enabled;
  check(
    point.nothingChanged ? 'the subject is still enabled' : 'the subject is disabled',
    disabled === !point.nothingChanged,
  );
  const heldStatus = (await held.sessions().authSession()).status;
  check(
    point.nothingChanged ? 'the held session still works: 200' : 'the held session is ended: 401',
    heldStatus === (point.nothingChanged ? 200 : 401),
  );
  const withOld = (await rawLogin(createBrowser(origin), 'alice', current)).status;
  const withNew = (await rawLogin(createBrowser(origin), 'alice', candidate)).status;
  if (point.nothingChanged) {
    check('the old password still signs in: 200', withOld === 200);
    return current;
  }
  check('no sign-in with either password while disabled: 401, 401', withOld === 401 && withNew === 401);
  check('reconcile enables the subject', (await reconcile(real, 'alice')) === 'enabled');
  const stored = point.written ? candidate : current;
  const other = point.written ? current : candidate;
  check(
    `after reconcile the ${point.written ? 'new' : 'old'} password signs in: 200`,
    (await rawLogin(createBrowser(origin), 'alice', stored)).status === 200,
  );
  check(
    `and the ${point.written ? 'old' : 'new'} one does not: 401`,
    (await rawLogin(createBrowser(origin), 'alice', other)).status === 401,
  );
  check('the held session stays ended: 401', (await held.sessions().authSession()).status === 401);
  return stored;
}

// Starts a change for alice that pauses right after its disable, while `during` runs; answers the change.
function changeWithPause(
  current: string,
  candidate: string,
  during: (disabledAt: number) => Promise<void>,
  log: string[] = [],
): Promise<string> {
  const real = example.changeDeps;
  const deps: ChangeDeps = {
    ...real,
    subjects: {
      ...subjectsOf(real),
      disable: async (userId) => {
        const disabled = await real.subjects.disable(userId);
        log.push('change: disabled');
        if (disabled.kind === 'done') {
          await during(disabled.generation);
        }
        return disabled;
      },
      enable: async (userId, generation) => {
        const enabled = await real.subjects.enable(userId, generation);
        log.push(`change: enable ${enabled.kind}`);
        return enabled;
      },
    },
  };
  return changePassword(deps, 'alice', new Secret(current), new Secret(candidate), AbortSignal.timeout(10_000)).then(
    (answer) =>
      answer.kind + ('step' in answer ? `:${answer.step}` : '') + ('reason' in answer ? `:${answer.reason}` : ''),
  );
}

async function reconcileWaits(current: string): Promise<string> {
  section('The application lock: a reconcile waits for a running change of the same user');
  const log: string[] = [];
  const gate = Promise.withResolvers<void>();
  const entered = Promise.withResolvers<void>();
  const candidate = newPassword();
  const change = changeWithPause(
    current,
    candidate,
    () => {
      entered.resolve();
      return gate.promise;
    },
    log,
  );
  await entered.promise;
  const real = example.changeDeps;
  const reconciling = reconcile(
    {
      ...real,
      subjects: {
        ...subjectsOf(real),
        read: (userId) => {
          log.push('reconcile: read');
          return real.subjects.read(userId);
        },
      },
    },
    'alice',
  );
  await sleep(200);
  log.push('200 ms later');
  gate.resolve();
  check('the change completes: changed', (await change) === 'changed');
  check('the reconcile then runs: the subject is enabled, so it ends every session', (await reconciling) === 'revoked');
  say(`    order: ${log.join(' -> ')}`);
  check(
    'the reconcile read nothing until the change had enabled',
    log.join('|') === 'change: disabled|200 ms later|change: enable done|reconcile: read',
  );
  check('the new password signs in: 200', (await rawLogin(createBrowser(origin), 'alice', candidate)).status === 200);
  return candidate;
}

async function enableOutsideTheLock(current: string): Promise<string> {
  section('An enable outside the lock: the change enable is refused and the attempt stops');
  const held = await signIn('alice', current);
  const candidate = newPassword();
  let early: Browser | null = null;
  const outcome = await changeWithPause(current, candidate, async (disabledAt) => {
    // What the lock excludes: a second actor that skips it, reads generation r and enables at r while this
    // change is between its disable and its write, then someone signs in on the old password.
    const rogue = await example.auth.subjects.enable('alice', disabledAt);
    check(`the rogue enable at the generation it read is accepted: ${rogue.kind}`, rogue.kind === 'done');
    early = await signIn('alice', current);
  });
  check(
    'the enable of the change is refused (enabled) and the change stops: stopped:enabled',
    outcome === 'stopped:enabled',
  );
  const signedInEarly: Browser = early ?? held;
  check('the session held before the change is ended: 401', (await held.sessions().authSession()).status === 401);
  check(
    'the session signed in on the old password meanwhile still works: 200 (what the lock exists to prevent)',
    (await signedInEarly.sessions().authSession()).status === 200,
  );
  check('reconcile ends every session: revoked', (await reconcile(example.changeDeps, 'alice')) === 'revoked');
  check('that session is now ended: 401', (await signedInEarly.sessions().authSession()).status === 401);
  check(
    'the new password (written) signs in: 200',
    (await rawLogin(createBrowser(origin), 'alice', candidate)).status === 200,
  );
  check('the old password does not: 401', (await rawLogin(createBrowser(origin), 'alice', current)).status === 401);
  return candidate;
}

async function staleEnable(current: string): Promise<string> {
  section('A stale enable: the fence moved after the change disabled it');
  const candidate = newPassword();
  const outcome = await changeWithPause(current, candidate, async () => {
    // Another disable (an operator's, say) raises the generation past the one the change holds.
    await example.auth.subjects.disable('alice');
  });
  check('the enable of the change is refused (stale) and the change stops: stopped:stale', outcome === 'stopped:stale');
  const subject = await example.auth.subjects.read('alice');
  check('the subject stays disabled', subject.kind === 'subject' && !subject.enabled);
  check(
    'no sign-in with the new password while disabled: 401',
    (await rawLogin(createBrowser(origin), 'alice', candidate)).status === 401,
  );
  check(
    'reconcile enables at the generation it reads: enabled',
    (await reconcile(example.changeDeps, 'alice')) === 'enabled',
  );
  check('the new password signs in: 200', (await rawLogin(createBrowser(origin), 'alice', candidate)).status === 200);
  return candidate;
}

async function loginLimit(current: string): Promise<void> {
  section('Login limit');
  const flood = createBrowser(origin);
  let attempt = await rawLogin(flood, 'alice', `${current}-wrong`);
  let tries = 1;
  while (attempt.status === 401 && tries < 100) {
    // biome-ignore lint/performance/noAwaitInLoops: each sign-in is one more charge against the same window.
    attempt = await rawLogin(flood, 'alice', `${current}-wrong`);
    tries += 1;
  }
  check(`after the window's sign-ins the next is 429 (try ${tries})`, attempt.status === 429);
  const correct = await rawLogin(flood, 'alice', current);
  check('the correct password is 429 too: the limit is charged before any verification', correct.status === 429);
  say(`    body: ${correct.body}; retry-after: ${correct.retryAfter}`);
}

function logs(): void {
  section('Logs');
  const leaked = [...secrets].filter((secret) => records.some((record) => record.includes(secret)));
  check(
    `${records.length} log records hold none of the ${secrets.size} passwords, keys, tokens and cookies`,
    leaked.length === 0,
  );
}

// Each interruption point of the credential change, as a wrapper of the real dependencies.
const POINTS: readonly {
  readonly name: string;
  readonly answer: string;
  readonly nothingChanged: boolean;
  readonly written: boolean;
  readonly deps: (real: ChangeDeps) => ChangeDeps;
}[] = [
  {
    name: 'step 1 (disable) not applied',
    answer: 'not_started',
    nothingChanged: true,
    written: false,
    deps: (real) => ({ ...real, subjects: { ...subjectsOf(real), disable: async () => notApplied } }),
  },
  {
    name: 'step 1 applied, its answer lost (unknown)',
    answer: 'pending:disable',
    nothingChanged: false,
    written: false,
    deps: (real) => ({
      ...real,
      subjects: {
        ...subjectsOf(real),
        disable: async (userId) => {
          await real.subjects.disable(userId);
          return unknown;
        },
      },
    }),
  },
  {
    name: 'step 2 (the write) committed, its answer lost',
    answer: 'pending:write',
    nothingChanged: false,
    written: true,
    deps: (real) => ({
      ...real,
      users: {
        findById: (id) => real.users.findById(id),
        replaceHash: (id, verified, nextHash) => {
          real.users.replaceHash(id, verified, nextHash);
          throw new Error('simulated: the write committed but its answer was lost');
        },
      },
    }),
  },
  {
    name: 'a crash after step 2, before step 3',
    answer: 'crashed',
    nothingChanged: false,
    written: true,
    deps: (real) => ({
      ...real,
      subjects: {
        ...subjectsOf(real),
        enable: () => {
          throw new Error('simulated crash');
        },
      },
    }),
  },
  {
    name: 'step 3 (enable) not applied',
    answer: 'pending:enable',
    nothingChanged: false,
    written: true,
    deps: (real) => ({ ...real, subjects: { ...subjectsOf(real), enable: async () => notApplied } }),
  },
];

const notApplied = { kind: 'unavailable', outcome: 'not_applied' } as const;
const unknown = { kind: 'unavailable', outcome: 'unknown' } as const;

function subjectsOf(real: ChangeDeps): ChangeDeps['subjects'] {
  return {
    read: (userId) => real.subjects.read(userId),
    disable: (userId) => real.subjects.disable(userId),
    enable: (userId, generation) => real.subjects.enable(userId, generation),
    revokeSessions: (userId) => real.subjects.revokeSessions(userId),
  };
}

// A cookie jar and the Origin header a browser would add: enough of a browser for this script.
type Browser = ReturnType<typeof createBrowser>;

function createBrowser(target: string, cookie?: readonly [string, string]) {
  const jar = new Map<string, string>(cookie === undefined ? [] : [cookie]);
  const state: { csrfToken: string | null } = { csrfToken: null };

  const send = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = new URL(input instanceof Request ? input.url : input);
    const headers = new Headers(init?.headers);
    const method = init?.method ?? 'GET';
    if (url.origin === target) {
      if (jar.size > 0) {
        headers.set('cookie', [...jar].map(([name, value]) => `${name}=${value}`).join('; '));
      }
      if (method !== 'GET' && method !== 'HEAD') {
        headers.set('origin', target);
      }
    }
    const response = await fetch(input, { ...init, headers, redirect: 'manual' });
    if (url.origin === target) {
      for (const line of response.headers.getSetCookie()) {
        const [pair = '', ...attributes] = line.split(';');
        const [name = '', value = ''] = pair.split('=');
        if (attributes.some((attribute) => attribute.trim().toLowerCase() === 'max-age=0')) {
          jar.delete(name);
        } else {
          jar.set(name, value);
          secrets.add(value);
        }
      }
    }
    return response;
  };

  return {
    get csrfToken(): string | null {
      return state.csrfToken;
    },
    set csrfToken(token: string | null) {
      state.csrfToken = token;
    },
    fetch: send,
    cookie: (name = '__Host-skeld'): readonly [string, string] => [name, jar.get(name) ?? ''],
    // The typed client, sending the session cookie and, on unsafe methods, the CSRF token it is given.
    client: (csrfToken?: string | null) =>
      createClient(appContract, {
        baseUrl: target,
        fetch: send,
        credential: { kind: 'session', csrfToken: () => (csrfToken === undefined ? state.csrfToken : csrfToken) },
      }),
    sessions: () =>
      createClient(sessionRoutes, {
        baseUrl: target,
        fetch: send,
        credential: { kind: 'session', csrfToken: () => state.csrfToken },
      }),
  };
}

async function signIn(username: string, secret: string): Promise<Browser> {
  const browser = createBrowser(origin);
  const answer = await browser.client().login({ body: { username, password: secret } });
  if (answer.status !== 200 || answer.body.status !== 'session') {
    throw new Error(`${username} could not sign in: ${answer.status}`);
  }
  browser.csrfToken = answer.body.csrfToken;
  secrets.add(answer.body.csrfToken);
  return browser;
}

// POST /login without the typed client, to compare the raw bytes of two answers.
async function rawLogin(browser: Browser, username: string, secret: string) {
  secrets.add(secret);
  const response = await browser.fetch(`${origin}/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password: secret }),
  });
  const headers = [...response.headers]
    .filter(([name]) => name !== 'date' && name !== 'x-request-id' && name !== 'set-cookie')
    .map(([name, value]) => `${name}: ${value}`)
    .join('\n');
  return {
    status: response.status,
    body: await response.text(),
    headers,
    retryAfter: response.headers.get('retry-after'),
  };
}

// The browser's side of OIDC: start, follow the provider's redirect, land on the callback.
async function oidcSignIn(
  browser: Browser,
  account: string,
): Promise<{ location: string | null; userId: string | null }> {
  const started = await createClient(oidcRoutes, { baseUrl: origin, fetch: browser.fetch }).authOidcStart({
    params: { provider: 'local' },
    body: { returnTo: '/' },
  });
  if (started.status !== 200) {
    throw new Error(`OIDC start answered ${started.status}`);
  }
  // The local provider signs in the account login_hint names, without asking for anything.
  const authorized = await fetch(`${started.body.url}&login_hint=${account}`, { redirect: 'manual' });
  const callback = authorized.headers.get('location') ?? '';
  const landed = await browser.fetch(callback);
  const status = await browser.sessions().authSession();
  const userId = status.status === 200 && status.body.status === 'session' ? status.body.userId : null;
  return { location: landed.headers.get('location'), userId };
}

function password(user: string): string {
  const value = example.passwords.get(user);
  if (value === undefined) {
    throw new Error(`no password for ${user}`);
  }
  secrets.add(value);
  return value;
}

function newPassword(): string {
  const value = `new-${crypto.randomUUID()}`;
  secrets.add(value);
  return value;
}

// The cost part of an encoded hash ($argon2id$v=19$m=...,t=...,p=...$salt$tag), never the salt or the tag.
function parameters(hash: string): string {
  return hash.split('$')[3] ?? '';
}

function codeOf(body: unknown): unknown {
  return typeof body === 'object' && body !== null && 'code' in body ? body.code : undefined;
}

function say(line: string): void {
  process.stdout.write(`${line}\n`);
}

function section(title: string): void {
  say(`\n${title}`);
}

function check(label: string, condition: boolean): void {
  if (!condition) {
    throw new Error(`walkthrough failed: ${label}`);
  }
  say(`  ok  ${label}`);
}

// Runs last, once every function and table above is defined.
try {
  await run();
  say('\nwalkthrough passed');
} finally {
  await example.close();
}
