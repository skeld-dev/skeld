// Does:  Proves the application mapper owns identity attachment: it gets the verified issuer and subject and may deny.
// Holds: An email never attaches an identity; a denied or changed mapping issues no session.
// biome-ignore-all lint/performance/noAwaitInLoops: each case is a request that must finish before the next
// biome-ignore-all lint/nursery/noUnsafeTypeAssertion: a hostile mapper deliberately returns shapes the type forbids
// biome-ignore-all lint/security/noSecrets: claim names and canary text are fixtures, not secrets

import { type OidcApp, begin, bootOidc, COOKIE, location } from './rig/oidc-app.ts';
import { childPki } from './rig/pki.ts';
import { providerHost } from './rig/provider.ts';
import { createReport } from './rig/report.ts';
import { makeStoreRig, type StoreRig } from './rig/stores.ts';
import { behaviorKinds as kinds } from '../support/test-profile.ts';

const pki = await childPki(import.meta.url);
const report = createReport(
  'the trusted mapper receives the verified issuer and subject and may deny; an email alone attaches nothing; a denied or changed mapping issues no session; no email, name or token text reaches a store row or a log record',
);
const host = await providerHost(pki.good);
const pa = host.add('a', 'client-a', 'secret-a');
const a = { provider: pa, name: 'a' };
const fail = (code: string): string => `/login?provider=a&error=${code}`;

interface Identity {
  readonly provider: string;
  readonly issuer: string;
  readonly subject: string;
  readonly claims: {
    readonly email: string | null;
    readonly emailVerified: boolean;
    readonly name: string | null;
    readonly all: Record<string, unknown>;
  };
}
const identities: Identity[] = [];
let mapper: (identity: Identity, call: number) => unknown | Promise<unknown> = (identity) => ({
  kind: 'user',
  userId: `u-${identity.subject}`,
});
let calls = 0;

async function login(
  app: OidcApp,
  subject = 'subject-1',
  claims: Record<string, unknown> = {},
): Promise<{ hop: string; session: boolean; cookies: string[] }> {
  const browser = app.browser();
  pa.subject = subject;
  const trip = await begin(browser, a);
  calls = 0;
  pa.claims = (base) => ({ ...base, ...claims });
  const hop = await browser.callback('a', { code: trip.code, state: trip.state });
  pa.claims = (base) => base;
  return { hop: location(hop), session: browser.jar.has(COOKIE), cookies: hop.setCookie };
}

async function causes(app: OidcApp, event: string): Promise<string[]> {
  await app.settle();
  return app
    .events(event)
    .map(
      (record) =>
        `${String(record.fields?.['auth.callback'])}:${String(record.fields?.['auth.cause'] ?? record.fields?.['auth.reason'])}`,
    );
}

async function mappingCases(app: OidcApp, rig: StoreRig, tag: string): Promise<void> {
  identities.length = 0;
  const ok = await login(app, 'sub-1', { email: 'shared@example.test', email_verified: true });
  const seen = identities[0];
  report.check(
    `${tag} the mapper gets the verified issuer and subject, the provider name and the claims, once before the handoff and once inside it`,
    identities.length === 2 &&
      seen?.issuer === pa.issuer &&
      seen.subject === 'sub-1' &&
      seen.provider === 'a' &&
      seen.claims.email === 'shared@example.test' &&
      seen.claims.emailVerified === true &&
      seen.claims.name === 'A Person' &&
      ok.hop === '/home' &&
      ok.session,
    `${identities.length} calls; issuer ${seen?.issuer}; subject ${seen?.subject}; ${ok.hop}`,
  );

  const first = await login(app, 'sub-2', { email: 'shared@example.test', email_verified: true });
  const users = (await rig.rows('SELECT user_id FROM sessions')).map((row) => String(row.user_id)).sort();
  report.check(
    `${tag} two subjects with the same verified email are two identities and two users: the email attaches nothing`,
    first.session && users.length === 2 && users[0] === 'u-sub-1' && users[1] === 'u-sub-2',
    `session users ${users.join(', ')}`,
  );

  mapper = (identity) =>
    identity.claims.email === 'shared@example.test' ? { kind: 'user', userId: 'u-from-email' } : { kind: 'deny' };
  const sameUser = await login(app, 'sub-3', { email: 'shared@example.test' });
  const noMatch = await login(app, 'sub-4', { email: 'other@example.test' });
  mapper = (identity) => ({ kind: 'user', userId: `u-${identity.subject}` });
  report.check(
    `${tag} auth takes the mapper's answer and adds no email lookup of its own`,
    sameUser.session && !noMatch.session && noMatch.hop === fail('mapping_denied'),
    `${sameUser.hop}; ${noMatch.hop}`,
  );

  const flags: [string, Record<string, unknown>, boolean][] = [
    ['email_verified true with an email', { email: 'x@example.test', email_verified: true }, true],
    ['email_verified the string "true"', { email: 'x@example.test', email_verified: 'true' }, false],
    ['email_verified true and no email', { email: undefined, email_verified: true }, false],
    ['email_verified false', { email: 'x@example.test', email_verified: false }, false],
  ];
  for (const [name, claims, want] of flags) {
    identities.length = 0;
    await login(app, 'flags', claims);
    report.check(
      `${tag} emailVerified is ${want} for ${name}`,
      identities[0]?.claims.emailVerified === want,
      String(identities[0]?.claims.emailVerified),
    );
  }
  identities.length = 0;
  await login(app, 'bounds', { email: `${'e'.repeat(250)}@example.test`, name: 'n'.repeat(257) });
  report.check(
    `${tag} an email over 254 characters and a name over 256 reach the mapper as null`,
    identities[0]?.claims.email === null && identities[0].claims.name === null,
    `${identities[0]?.claims.email} ${identities[0]?.claims.name}`,
  );

  const sessionsBefore = await rig.count('sessions');
  mapper = () => ({ kind: 'deny' });
  const denied = await login(app, 'denied');
  mapper = (identity) => ({ kind: 'user', userId: `u-${identity.subject}` });
  report.check(
    `${tag} a mapper that denies is mapping_denied, with no session and the attempt spent`,
    denied.hop === fail('mapping_denied') && !denied.session && (await rig.count('sessions')) === sessionsBefore,
    denied.hop,
  );
}

async function faultCases(app: OidcApp, tag: string): Promise<void> {
  await app.settle();
  const changed: [string, (identity: Identity, call: number) => unknown][] = [
    [
      'names another user the second time',
      (identity, call) => ({ kind: 'user', userId: call === 1 ? `u-${identity.subject}` : 'u-someone-else' }),
    ],
    [
      'denies the second time',
      (identity, call) => (call === 1 ? { kind: 'user', userId: `u-${identity.subject}` } : { kind: 'deny' }),
    ],
  ];
  for (const [name, answer] of changed) {
    mapper = answer;
    calls = 0;
    const before = app.events('auth.signin.failed').length;
    const seen = await login(app, 'changed');
    mapper = (identity) => ({ kind: 'user', userId: `u-${identity.subject}` });
    await app.settle();
    const failed = app
      .events('auth.signin.failed')
      .slice(before)
      .map((record) => String(record.fields?.['auth.reason']));
    report.check(
      `${tag} a mapper that ${name} refuses the sign-in: mapping_failed, no session, one signin.failed written by the handoff with reason rejected`,
      seen.hop === fail('mapping_failed') && !seen.session && failed.length === 1 && failed[0] === 'rejected',
      `${seen.hop}; signin.failed ${failed.join(', ')}`,
    );
  }
  mapper = (identity, call) => {
    if (call === 1) {
      return { kind: 'user', userId: `u-${identity.subject}` };
    }
    throw new Error('CANARY-SECOND-CALL');
  };
  const beforeSecond = app.events('auth.callback.failed').length;
  const second = await login(app, 'second-throws');
  mapper = (identity) => ({ kind: 'user', userId: `u-${identity.subject}` });
  const secondRecords = (await causes(app, 'auth.callback.failed')).slice(beforeSecond);
  report.check(
    `${tag} a mapper that throws the second time refuses the sign-in with one auth.callback.failed and no session`,
    second.hop === fail('mapping_failed') && !second.session && secondRecords.length === 1,
    `${second.hop}; records ${secondRecords.join(', ')}`,
  );
}

async function subjectCases(app: OidcApp, tag: string): Promise<void> {
  await login(app, 'fenced');
  const disabled = await app.subjects.disable('u-fenced');
  calls = 0;
  identities.length = 0;
  const refused = await login(app, 'fenced');
  report.check(
    `${tag} a disabled subject's login is subject_refused with no session and the second mapper call never made`,
    refused.hop === fail('subject_refused') && !refused.session && identities.length === 1,
    `${refused.hop}; mapper calls ${identities.length}`,
  );
  await app.subjects.enable('u-fenced', disabled.kind === 'done' ? disabled.generation : 1);
  const again = await login(app, 'fenced');
  report.check(
    `${tag} after enable the same subject signs in again`,
    again.session && again.hop === '/home',
    again.hop,
  );
}

async function surfaceCases(app: OidcApp, rig: StoreRig, tag: string): Promise<void> {
  pa.extraToken = { refresh_token: 'RT-CANARY' };
  await login(app, 'refreshing');
  pa.extraToken = {};
  const dump = JSON.stringify(
    await Promise.all(
      ['subjects', 'sessions', 'api_keys', 'limit_windows', 'oidc_attempts'].map((table) =>
        rig.rows(`SELECT * FROM ${table}`),
      ),
    ),
  );
  report.check(
    `${tag} no email, name, access token or refresh token text is in any store row or log record`,
    !/example\.test|A Person|AT-CANARY|RT-CANARY/.test(dump) &&
      !app.lines.some((line) => /example\.test|A Person|AT-CANARY|RT-CANARY/.test(line)),
    `${dump.length} bytes of rows, ${app.lines.length} records`,
  );
}

for (const kind of kinds) {
  await report.run(`${kind} mapping`, async () => {
    const rig = await makeStoreRig(kind);
    const app = await bootOidc({
      store: rig.open(),
      entries: [a],
      resolveUser: (identity) => {
        identities.push(identity);
        calls++;
        return mapper(identity, calls) as never;
      },
      addressLimit: { max: 100_000, windowSeconds: 60 },
    });
    const tag = `[${kind}]`;
    try {
      await mappingCases(app, rig, tag);
      await faultCases(app, tag);
      await subjectCases(app, tag);
      await surfaceCases(app, rig, tag);
    } finally {
      await app.close();
      await rig.dispose();
    }
  });
}

await host.close();
pki.dispose();
report.finish();
