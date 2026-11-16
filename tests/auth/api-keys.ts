// Does:  Proves API keys through the real part and gate: scopes, digests, bounds, revocation, kinds and inputs.
// Holds: A key is judged on the wire and in the table; a refused request never reaches its handler or another verifier.

import { createHash, randomBytes } from 'node:crypto';
import type { Pool } from 'pg';
import { AuthError } from '@skeld/auth/auth-error';
import { expose } from '@skeld/core/secret';
import {
  cookieHeader,
  get,
  observe,
  type Observed,
  send,
  series,
  signJwt,
  sleepMs,
  spareStore,
  startApp,
  type App,
  disableUser,
} from './rig/v1-app.ts';
import { createReport } from './rig/v1-report.ts';
import { cleanAll, type Kind, makeRig, type Rig, rigKinds, toNumber } from './support-store.ts';

const statement =
  'API keys are high-entropy scoped credentials with only a digest at rest, bounded issue and list, and authoritative revocation: the next request after a revoke is refused; a wrong scope, an expired key, a disabled subject and a malformed or foreign token are refused; unknown input keys are rejected before any store call; a credential kind is never tried by another verifier in either direction';
const report = createReport('v04', statement);

const INVALID = '{"status":401,"code":"CREDENTIAL_INVALID","message":"Credential not accepted"}';
const DENIED = '{"status":403,"code":"ACCESS_DENIED","message":"Access denied"}';

interface Context {
  readonly label: string;
  readonly rig: Rig;
  readonly observed: Observed;
  readonly app: App;
}

async function rejection(call: () => Promise<unknown>): Promise<string> {
  try {
    const value = await call();
    return `resolved ${JSON.stringify(value)}`;
  } catch (error) {
    return error instanceof AuthError ? `${error.code}: ${error.message}` : String(error);
  }
}

async function issue(
  app: App,
  input: { userId: string; name?: string; scopes?: readonly string[]; expiresInSeconds?: number },
): Promise<{ key: string; keyId: string }> {
  const result = await app.keys.issue({ name: 'key', scopes: ['docs:read'], ...input });
  if (result.kind !== 'issued') {
    throw new Error(`issue answered ${result.kind}`);
  }
  return { key: expose(result.key), keyId: result.info.keyId };
}

const bearer = (key: string): string => `authorization: Bearer ${key}`;

async function formatCases({ label, rig, observed, app }: Context): Promise<void> {
  const issued = await app.keys.issue({ userId: 'alice', name: 'ci deploy', scopes: ['docs:read', 'docs:write'] });
  if (issued.kind !== 'issued') {
    throw new Error('issue failed');
  }
  const text = expose(issued.key);
  const [prefix, keyId, secret] = text.split('.');
  report.check(
    `${label} a key is skeld1.<16 base64url>.<43 base64url>, 67 characters, in its canonical spelling`,
    prefix === 'skeld1' &&
      /^[A-Za-z0-9_-]{16}$/.test(keyId ?? '') &&
      /^[A-Za-z0-9_-]{43}$/.test(secret ?? '') &&
      text.length === 67 &&
      Buffer.from(secret ?? '', 'base64url').toString('base64url') === secret &&
      Buffer.from(secret ?? '', 'base64url').length === 32,
    `${text.length} characters`,
  );
  report.check(
    `${label} the secret shows only in the issued outcome: the key prints as [secret] and the info holds only keyId, name, scopes, createdAt and expiresAt`,
    String(issued.key) === '[secret]' &&
      JSON.stringify(issued).includes('[secret]') &&
      !JSON.stringify(issued).includes(secret ?? 'x') &&
      Object.keys(issued.info).sort().join(',') === 'createdAt,expiresAt,keyId,name,scopes',
    Object.keys(issued.info).join(','),
  );
  const rows = await rig.query('SELECT * FROM api_keys WHERE key_id = ?', [keyId]);
  const row = rows[0] ?? {};
  const want = createHash('sha256')
    .update(Buffer.from(secret ?? '', 'base64url'))
    .digest('hex');
  const dump = JSON.stringify(row, (_key, value) =>
    value instanceof Uint8Array
      ? Buffer.from(value).toString('hex')
      : typeof value === 'bigint'
        ? String(value)
        : value,
  );
  report.check(
    `${label} the table holds the SHA-256 of the 32 decoded secret bytes (a 32-byte digest), the key id, the name, the scopes joined by one space and no secret in any column`,
    row.digest instanceof Uint8Array &&
      Buffer.from(row.digest).toString('hex') === want &&
      Buffer.from(row.digest).length === 32 &&
      row.key_id === keyId &&
      row.name === 'ci deploy' &&
      row.scopes === 'docs:read docs:write' &&
      !dump.includes(secret ?? 'x') &&
      !dump.includes(
        Buffer.from(secret ?? '', 'base64url')
          .toString('hex')
          .replace(want, ''),
      ),
    `columns ${Object.keys(row).join(',')}`,
  );
  const admitted = await get(app.port, '/docs', [bearer(text)]);
  report.check(
    `${label} the key admits as api_key:<user> on a policy that names api_key`,
    admitted.status === 200 && admitted.json().who === 'api_key:alice',
    `${admitted.status} ${admitted.body}`,
  );
  observed.reset();
  await series([1, 2, 3], async () => {
    await get(app.port, '/docs', [bearer(text)]);
  });
  report.check(
    `${label} every request reads the store (3 requests, ${observed.calls('apiKeyRead')} apiKeyRead calls): no cache`,
    observed.calls('apiKeyRead') === 3,
    `${observed.calls('apiKeyRead')}`,
  );
  await app.logs.settle();
  report.check(
    `${label} the secret and the key text are in no log record`,
    !app.logs.text().includes(secret ?? 'x'),
    `${app.logs.records().length} records searched`,
  );
  const entropy = await Promise.all(
    Array.from({ length: 30 }, (_, index) =>
      issue(app, { userId: `entropy-${index}` }).then((entry) => entry.key.split('.')[2] ?? ''),
    ),
  );
  report.check(
    `${label} 30 issued secrets are distinct (43 characters of 32 random bytes each)`,
    new Set(entropy).size === 30,
    `${new Set(entropy).size} distinct`,
  );
}

async function scopeCases({ label, app }: Context): Promise<void> {
  const reader = await issue(app, { userId: 'scopes', scopes: ['docs:read'] });
  const both = await issue(app, { userId: 'scopes', scopes: ['docs:read', 'docs:write'] });
  const none = await issue(app, { userId: 'scopes', scopes: ['other:thing'] });
  const readReply = await get(app.port, '/docs', [bearer(reader.key)]);
  const writeWithReader = await send(app.port, {
    method: 'POST',
    path: '/docs',
    headers: [bearer(reader.key)],
    body: '{"name":"a"}',
  });
  const writeWithBoth = await send(app.port, {
    method: 'POST',
    path: '/docs',
    headers: [bearer(both.key)],
    body: '{"name":"a"}',
  });
  const readWithNone = await get(app.port, '/docs', [bearer(none.key)]);
  report.check(
    `${label} a scope is the exact text <policy>:<action>: docs:read reads (200) and cannot write (403 ACCESS_DENIED, handler not run); docs:read plus docs:write writes (200); other:thing reads nothing (403)`,
    readReply.status === 200 &&
      writeWithReader.status === 403 &&
      writeWithReader.body === DENIED &&
      writeWithBoth.status === 200 &&
      readWithNone.status === 403 &&
      readWithNone.body === DENIED &&
      app.hit('save') === 1,
    `${readReply.status} ${writeWithReader.status} ${writeWithBoth.status} ${readWithNone.status}; handler runs ${app.hit('save')}`,
  );
  const badScopes: [string, readonly string[]][] = [
    ['no scopes', []],
    ['a wildcard', ['docs:*']],
    ['a bare policy', ['docs']],
    ['an empty action', ['docs:']],
    ['an empty policy', [':read']],
    ['three parts', ['docs:read:x']],
    ['a space', ['docs: read']],
    ['a policy that starts with a digit', ['1docs:read']],
    ['a 65-character action', [`docs:${'a'.repeat(65)}`]],
    ['a repeated scope', ['docs:read', 'docs:read']],
    ['33 scopes', Array.from({ length: 33 }, (_, n) => `p${n}:a`)],
    ['a non-string scope', JSON.parse('[5]')],
  ];
  await series(badScopes, async ([name, scopes]) => {
    const outcome = await rejection(() => app.keys.issue({ userId: 'scopes', name: 'x', scopes }));
    report.check(
      `${label} issue with ${name}: INVALID_INPUT "invalid input"`,
      outcome === 'INVALID_INPUT: invalid input',
      outcome,
    );
  });
  const limit = await app.keys.issue({
    userId: 'scopes32',
    name: 'x',
    scopes: Array.from({ length: 32 }, (_, n) => `p${n}:a`),
  });
  report.check(`${label} 32 distinct scopes are accepted`, limit.kind === 'issued', limit.kind);
  const bad: [string, { name: string; expiresInSeconds?: number }][] = [
    ['an empty name', { name: '' }],
    ['a 65-character name', { name: 'n'.repeat(65) }],
    ['a name with a non-ASCII character', { name: 'clé' }],
    ['a name with a line break', { name: 'a\nb' }],
    ['expiresInSeconds 59', { name: 'x', expiresInSeconds: 59 }],
    ['expiresInSeconds 31,536,001', { name: 'x', expiresInSeconds: 31_536_001 }],
  ];
  await series(bad, async ([name, input]) => {
    const outcome = await rejection(() => app.keys.issue({ userId: 'bounds', scopes: ['docs:read'], ...input }));
    report.check(`${label} issue with ${name}: INVALID_INPUT`, outcome === 'INVALID_INPUT: invalid input', outcome);
  });
  const ok = await Promise.all([
    app.keys.issue({ userId: 'bounds', name: 'n'.repeat(64), scopes: ['docs:read'] }),
    app.keys.issue({ userId: 'bounds', name: 'x', scopes: ['docs:read'], expiresInSeconds: 60 }),
    app.keys.issue({ userId: 'bounds', name: 'x', scopes: ['docs:read'], expiresInSeconds: 31_536_000 }),
  ]);
  report.check(
    `${label} a 64-character name and expiresInSeconds 60 and 31,536,000 are accepted`,
    ok.every((entry) => entry.kind === 'issued'),
    ok.map((entry) => entry.kind).join(','),
  );
  const first = ok[1];
  report.check(
    `${label} expiresInSeconds 60 gives expiresAt = createdAt + 60,000 ms; no expiry gives null`,
    first?.kind === 'issued' &&
      first.info.expiresAt === first.info.createdAt + 60_000 &&
      ok[0]?.kind === 'issued' &&
      ok[0].info.expiresAt === null,
    JSON.stringify(first?.kind === 'issued' ? first.info : first),
  );
  const badUsers = await Promise.all(
    ['', 'a b', 'x'.repeat(129)].map((userId) =>
      rejection(() => app.keys.issue({ userId, name: 'x', scopes: ['docs:read'] })),
    ),
  );
  report.check(
    `${label} a user id outside its grammar: INVALID_INPUT`,
    badUsers.every((outcome) => outcome === 'INVALID_INPUT: invalid input'),
    badUsers.join(' | '),
  );
}

async function unknownKeyCases({ label, rig, observed, app }: Context): Promise<void> {
  const before = await rig.query('SELECT count(*) AS n FROM api_keys');
  observed.reset();
  const attempts: [string, () => Promise<unknown>][] = [
    [
      'issue with a misspelt expiresInSecond',
      () => app.keys.issue(JSON.parse('{"userId":"typo","name":"x","scopes":["docs:read"],"expiresInSecond":3600}')),
    ],
    [
      'issue with the field name in the wrong case',
      () => app.keys.issue(JSON.parse('{"userId":"typo","name":"x","scopes":["docs:read"],"ExpiresInSeconds":3600}')),
    ],
    [
      'issue with an extra key',
      () => app.keys.issue(JSON.parse('{"userId":"typo","name":"x","scopes":["docs:read"],"maxPerUser":9}')),
    ],
    [
      'issue with a symbol key',
      () => app.keys.issue({ userId: 'typo', name: 'x', scopes: ['docs:read'], [Symbol('s')]: 1 }),
    ],
    ['list with an extra limit', () => app.keys.list(JSON.parse('{"userId":"typo","limit":5}'))],
    [
      'revoke with an extra key',
      () => app.keys.revoke(JSON.parse('{"userId":"typo","keyId":"aaaaaaaaaaaaaaaa","force":true}')),
    ],
    ['issue given a string instead of an object', () => app.keys.issue(JSON.parse('"typo"'))],
  ];
  await series(attempts, async ([name, call]) => {
    const outcome = await rejection(call);
    report.check(
      `${label} ${name}: INVALID_INPUT "invalid input", naming no key`,
      outcome === 'INVALID_INPUT: invalid input',
      outcome,
    );
  });
  const after = await rig.query('SELECT count(*) AS n FROM api_keys');
  report.check(
    `${label} no store call was made and no key was created by any of them`,
    observed.calls() === 0 && toNumber(after[0]?.n) === toNumber(before[0]?.n),
    `${observed.calls()} store calls; rows ${toNumber(before[0]?.n)} -> ${toNumber(after[0]?.n)}`,
  );
}

async function revocationCases({ label, rig, observed, app }: Context): Promise<void> {
  const mine = await issue(app, { userId: 'rev-owner', scopes: ['docs:read'] });
  const other = await issue(app, { userId: 'rev-other', scopes: ['docs:read'] });
  const stranger = await app.keys.revoke({ userId: 'rev-other', keyId: mine.keyId });
  const stillWorks = await get(app.port, '/docs', [bearer(mine.key)]);
  report.check(
    `${label} another user's revoke answers absent and leaves the key working and its row in place`,
    stranger.kind === 'absent' &&
      stillWorks.status === 200 &&
      (await rig.query('SELECT 1 FROM api_keys WHERE key_id = ?', [mine.keyId])).length === 1,
    `${stranger.kind} ${stillWorks.status}`,
  );
  const gone = await app.keys.revoke({ userId: 'rev-owner', keyId: mine.keyId });
  const refused = await get(app.port, '/docs', [bearer(mine.key)]);
  report.check(
    `${label} revoke: revoked, and the very next request with the key is 401 CREDENTIAL_INVALID with the challenge`,
    gone.kind === 'revoked' &&
      refused.status === 401 &&
      refused.body === INVALID &&
      refused.first('www-authenticate') === 'Bearer',
    `${gone.kind} ${refused.status}`,
  );
  const twice = await app.keys.revoke({ userId: 'rev-owner', keyId: mine.keyId });
  const missing = await app.keys.revoke({ userId: 'rev-owner', keyId: 'AAAAAAAAAAAAAAAA' });
  const stillOther = await get(app.port, '/docs', [bearer(other.key)]);
  report.check(
    `${label} a second revoke and a revoke of an unknown id answer absent; another user's key is untouched`,
    twice.kind === 'absent' && missing.kind === 'absent' && stillOther.status === 200,
    `${twice.kind} ${missing.kind} ${stillOther.status}`,
  );
  const bad = await Promise.all(
    ['', 'short', 'a'.repeat(17), 'has space.....'].map((keyId) =>
      rejection(() => app.keys.revoke({ userId: 'rev-owner', keyId })),
    ),
  );
  report.check(
    `${label} a key id outside its grammar is INVALID_INPUT or absent, never a deletion`,
    bad.every((outcome) => outcome === 'INVALID_INPUT: invalid input' || outcome.includes('"absent"')),
    bad.join(' | '),
  );
  const expiring = await issue(app, { userId: 'exp-user', scopes: ['docs:read'], expiresInSeconds: 60 });
  const live = await get(app.port, '/docs', [bearer(expiring.key)]);
  await rig.query('UPDATE api_keys SET expires_at = 1 WHERE key_id = ?', [expiring.keyId]);
  const expired = await get(app.port, '/docs', [bearer(expiring.key)]);
  const listed = await app.keys.list({ userId: 'exp-user' });
  report.check(
    `${label} an expired key (its stored expiry passed) is 401 on the next request and absent from list: expiry is the store's judgment`,
    live.status === 200 &&
      expired.status === 401 &&
      expired.body === INVALID &&
      listed.kind === 'listed' &&
      listed.keys.length === 0,
    `${live.status} then ${expired.status}; listed ${listed.kind === 'listed' ? listed.keys.length : listed.kind}`,
  );
  observed.reset();
  const disabled = await issue(app, { userId: 'off-user', scopes: ['docs:read'] });
  const offGeneration = await disableUser(app.subjects, 'off-user');
  const whileOff = await get(app.port, '/docs', [bearer(disabled.key)]);
  const issueOff = await app.keys.issue({ userId: 'off-user', name: 'x', scopes: ['docs:read'] });
  await app.subjects.enable('off-user', offGeneration);
  const afterOn = await get(app.port, '/docs', [bearer(disabled.key)]);
  await app.subjects.revokeSessions('off-user');
  const afterRevokeAll = await get(app.port, '/docs', [bearer(disabled.key)]);
  report.check(
    `${label} a disabled subject's key is 401 and issue is refused disabled; after enable the same key works; revokeSessions does not revoke keys`,
    whileOff.status === 401 &&
      issueOff.kind === 'refused' &&
      issueOff.reason === 'disabled' &&
      afterOn.status === 200 &&
      afterRevokeAll.status === 200,
    `${whileOff.status} ${issueOff.kind} ${afterOn.status} ${afterRevokeAll.status}`,
  );
}

async function changeRecords(kind: Kind, rig: Rig, pools: Pool[]): Promise<void> {
  const label = `[${kind}]`;
  const app = await startApp({ store: observe(spareStore(rig, pools)).store });
  try {
    const mine = await issue(app, { userId: 'rec-owner', scopes: ['docs:read'] });
    await app.keys.revoke({ userId: 'rec-other', keyId: mine.keyId });
    await app.keys.revoke({ userId: 'rec-owner', keyId: mine.keyId });
    await app.keys.revoke({ userId: 'rec-owner', keyId: mine.keyId });
    await app.logs.settle();
    const changes = app.logs.named('auth.credential.changed').map((record) => record.fields);
    report.check(
      `${label} one auth.credential.changed added and one removed, each with the user, api_key and the key id, written after the confirmed commit; none for an absent or another user's revoke`,
      changes.length === 2 &&
        changes[0]?.['auth.change'] === 'added' &&
        changes[1]?.['auth.change'] === 'removed' &&
        changes.every(
          (fields) =>
            fields['auth.key'] === mine.keyId &&
            fields['auth.credential'] === 'api_key' &&
            fields['auth.user'] === 'rec-owner',
        ),
      JSON.stringify(changes),
    );
  } finally {
    await app.close();
  }
}

async function boundCases({ label, rig, app }: Context): Promise<void> {
  const keys = await Promise.all(
    Array.from({ length: 5 }, (_, n) => app.keys.issue({ userId: 'cap', name: `k${n}`, scopes: ['docs:read'] })),
  );
  const over = await app.keys.issue({ userId: 'cap', name: 'over', scopes: ['docs:read'] });
  report.check(
    `${label} with maxPerUser 5: five keys are issued and the sixth is refused limit`,
    keys.every((entry) => entry.kind === 'issued') && over.kind === 'refused' && over.reason === 'limit',
    `${keys.map((entry) => entry.kind).join(',')} then ${over.kind}`,
  );
  const racers = await Promise.all(
    Array.from({ length: 20 }, (_, n) => app.keys.issue({ userId: 'race-cap', name: `r${n}`, scopes: ['docs:read'] })),
  );
  const issuedCount = racers.filter((entry) => entry.kind === 'issued').length;
  const refusedCount = racers.filter((entry) => entry.kind === 'refused' && entry.reason === 'limit').length;
  const rows = await rig.query('SELECT count(*) AS n FROM api_keys WHERE user_id = ?', ['race-cap']);
  report.check(
    `${label} 20 concurrent issues for one user with maxPerUser 5: exactly 5 issued, 15 refused limit, 5 rows`,
    issuedCount === 5 && refusedCount === 15 && toNumber(rows[0]?.n) === 5,
    `${issuedCount} issued, ${refusedCount} refused, ${toNumber(rows[0]?.n)} rows`,
  );
  const listed = await app.keys.list({ userId: 'cap' });
  const text = listed.kind === 'listed' ? JSON.stringify(listed.keys) : '';
  report.check(
    `${label} list returns only that user's keys, as info (no secret, no digest), at most maxPerUser`,
    listed.kind === 'listed' &&
      listed.keys.length === 5 &&
      listed.keys.every((info) => Object.keys(info).sort().join(',') === 'createdAt,expiresAt,keyId,name,scopes') &&
      !text.includes('digest'),
    listed.kind === 'listed' ? `${listed.keys.length} keys` : listed.kind,
  );
  const stranger = await app.keys.list({ userId: 'nobody-here' });
  report.check(
    `${label} list for a user with no keys is an empty list`,
    stranger.kind === 'listed' && stranger.keys.length === 0,
    stranger.kind,
  );
  const one = keys[0];
  if (one?.kind === 'issued') {
    await app.keys.revoke({ userId: 'cap', keyId: one.info.keyId });
    const again = await app.keys.issue({ userId: 'cap', name: 'again', scopes: ['docs:read'] });
    report.check(`${label} a revoked key frees its place under the cap`, again.kind === 'issued', again.kind);
  }
}

async function ceilingCases(kind: Kind): Promise<void> {
  const label = `[${kind}]`;
  const rig = await makeRig(kind, { attach: false });
  const app = await startApp({ store: rig.store, maxPerUser: 1000 });
  try {
    const began = performance.now();
    await series(
      Array.from({ length: 10 }, (_, n) => n),
      async (round) => {
        await Promise.all(
          Array.from({ length: 100 }, (_, n) =>
            app.keys.issue({ userId: 'ceiling', name: `c${round}-${n}`, scopes: ['docs:read'] }),
          ),
        );
      },
    );
    const over = await app.keys.issue({ userId: 'ceiling', name: 'over', scopes: ['docs:read'] });
    const listed = await app.keys.list({ userId: 'ceiling' });
    const rows = await rig.query('SELECT count(*) AS n FROM api_keys WHERE user_id = ?', ['ceiling']);
    report.check(
      `${label} at the ceiling (maxPerUser 1,000): 1,000 keys issued, the 1,001st refused limit, list returns all 1,000 (${Math.round(performance.now() - began)} ms on a shared host)`,
      over.kind === 'refused' &&
        over.reason === 'limit' &&
        listed.kind === 'listed' &&
        listed.keys.length === 1000 &&
        toNumber(rows[0]?.n) === 1000,
      `${listed.kind === 'listed' ? listed.keys.length : listed.kind} listed; ${toNumber(rows[0]?.n)} rows`,
    );
  } finally {
    await app.close();
    await rig.dispose();
  }
  await series([0, 1001, 1.5], async (bad) => {
    const spare = await makeRig(kind, { attach: false });
    try {
      const outcome = await startApp({ store: spare.store, maxPerUser: bad }).then(
        async (started) => {
          await started.close();
          return 'listened';
        },
        (error: unknown) => (error instanceof Error ? error.message : String(error)),
      );
      report.check(
        `${label} maxPerUser ${bad} refuses boot as GATE_FAILED api_key`,
        outcome.startsWith('gate failed: api_key: '),
        outcome,
      );
    } finally {
      await spare.dispose();
    }
  });
}

async function kindCases({ label, observed, app }: Context): Promise<void> {
  const real = await issue(app, { userId: 'kinds', scopes: ['docs:read'] });
  const session = await app.signIn('kinds');
  const jwtToken = signJwt('kinds-jwt');
  const [prefix, keyId, secret] = real.key.split('.');
  // biome-ignore lint/security/noSecrets: the base64url alphabet, not a secret
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  const spelled = `${prefix}.${keyId}.${secret?.slice(0, 42)}${alphabet[alphabet.indexOf(secret?.[42] ?? 'A') + 1]}`;
  const unknownKey = `${prefix}.${randomBytes(12).toString('base64url')}.${randomBytes(32).toString('base64url')}`;
  const wrongSecret = `${prefix}.${keyId}.${randomBytes(32).toString('base64url')}`;
  observed.reset();
  const jwtReply = await get(app.port, '/jwt-docs', [bearer(jwtToken)]);
  report.check(
    `${label} a valid JWT is verified as a JWT only: admitted as jwt, the JWT claims map ran once and no API-key read was made (never tried as an API key)`,
    jwtReply.status === 200 &&
      String(jwtReply.json().who).startsWith('jwt:') &&
      app.hit('jwtMap') === 1 &&
      observed.calls('apiKeyRead') === 0,
    `${jwtReply.status} ${jwtReply.body}; map ${app.hit('jwtMap')}; apiKeyRead ${observed.calls('apiKeyRead')}`,
  );
  const maps = app.hit('jwtMap');
  observed.reset();
  const cases: [string, string, number][] = [
    ['an unknown well-formed API key', unknownKey, 1],
    ['a right id with a wrong secret', wrongSecret, 1],
    ['a skeld1. token that is malformed', 'skeld1.short.token', 0],
    ['a skeld1. token with an extra segment', `${real.key}.extra`, 0],
    ['an upper-cased prefix', `S${real.key.slice(1)}`, 0],
    ["the live key's non-canonical spelling (its last character moved by one)", spelled, 0],
  ];
  await series(cases, async ([name, token, reads]) => {
    observed.reset();
    const reply = await get(app.port, '/docs', [bearer(token)]);
    report.check(
      `${label} ${name}: 401 CREDENTIAL_INVALID, ${reads} apiKeyRead call(s), no JWT work, nothing else read`,
      reply.status === 401 &&
        reply.body === INVALID &&
        observed.calls('apiKeyRead') === reads &&
        observed.calls() === reads &&
        app.hit('jwtMap') === maps,
      `${reply.status}; apiKeyRead ${observed.calls('apiKeyRead')}, all ${observed.calls()}; map ${app.hit('jwtMap') - maps}`,
    );
  });
  const foreign: [string, string][] = [
    ['a JWT-shaped token with a bad signature', `${jwtToken.slice(0, -4)}AAAA`],
    ['a session token sent as a bearer', session.token ?? ''],
    [
      'three random base64url segments',
      `${randomBytes(9).toString('base64url')}.${randomBytes(9).toString('base64url')}.${randomBytes(9).toString('base64url')}`,
    ],
    ['an opaque 43-character string', randomBytes(32).toString('base64url')],
  ];
  await series(foreign, async ([name, token]) => {
    observed.reset();
    const reply = await get(app.port, '/docs', [bearer(token)]);
    report.check(
      `${label} ${name}: 401 on a policy that names api_key and session, no store read (a foreign token is not tried as an API key)`,
      reply.status === 401 && observed.calls() === 0,
      `${reply.status}; store calls ${observed.calls()}`,
    );
  });
  observed.reset();
  const keyAsJwt = await get(app.port, '/jwt-docs', [bearer(real.key)]);
  const keyOnSessionRoute = await get(app.port, '/session-only', [bearer(real.key)]);
  report.check(
    `${label} an API key on a policy that names only jwt, or only session: 401, and the JWT claims map never ran for it`,
    keyAsJwt.status === 401 && keyOnSessionRoute.status === 401 && app.hit('jwtMap') === maps,
    `${keyAsJwt.status} ${keyOnSessionRoute.status}; map ${app.hit('jwtMap') - maps}`,
  );
  observed.reset();
  const jwtAsKey = await send(app.port, { method: 'POST', path: '/keys-only', headers: [bearer(jwtToken)] });
  report.check(
    `${label} a valid JWT on a policy that names only api_key: 401 and no API-key read`,
    jwtAsKey.status === 401 && observed.calls('apiKeyRead') === 0,
    `${jwtAsKey.status}; apiKeyRead ${observed.calls('apiKeyRead')}`,
  );
  const keysOnlyKey = await issue(app, { userId: 'kinds-keys', scopes: ['keysonly:use'] });
  const keyOnly = await send(app.port, { method: 'POST', path: '/keys-only', headers: [bearer(keysOnlyKey.key)] });
  report.check(
    `${label} an API key on a policy that names only api_key needs no CSRF token (a bearer is no cookie): 200`,
    keyOnly.status === 200,
    `${keyOnly.status} ${keyOnly.body}`,
  );
  observed.reset();
  const asCookie = await get(app.port, '/docs', [cookieHeader('__Host-skeld', real.key)]);
  report.check(
    `${label} an API key sent as the session cookie is 401 with no store read`,
    asCookie.status === 401 && observed.calls('apiKeyRead') === 0,
    `${asCookie.status}`,
  );
  observed.failWith('no', 'apiKeyRead');
  const outage = await get(app.port, '/docs', [bearer(real.key)]);
  observed.failWith(null);
  report.check(
    `${label} while the store cannot answer apiKeyRead: 503 AUTH_UNAVAILABLE, never 200, never another verifier's answer (no fallback)`,
    outage.status === 503 && outage.json().code === 'AUTH_UNAVAILABLE' && app.hit('jwtMap') === maps,
    `${outage.status} ${outage.body}`,
  );
  const principalSeen = await get(app.port, '/whoami', [bearer(real.key)]);
  report.check(
    `${label} an optional route admits a valid key as itself`,
    principalSeen.json().who === 'api_key:kinds',
    principalSeen.body,
  );
  await sleepMs(0);
}

async function suite(kind: Kind): Promise<void> {
  const label = `[${kind}]`;
  const rig = await makeRig(kind, { attach: false });
  const observed = observe(rig.store);
  const app = await startApp({ store: observed.store, maxPerUser: 5 });
  const context: Context = { label, rig, observed, app };
  try {
    await report.run(`${label} format and digest`, () => formatCases(context));
    await report.run(`${label} scopes and input bounds`, () => scopeCases(context));
    await report.run(`${label} unknown input keys`, () => unknownKeyCases(context));
    await report.run(`${label} revocation, expiry and disabled subjects`, () => revocationCases(context));
    await report.run(`${label} issue and list bounds`, () => boundCases(context));
    await report.run(`${label} credential kinds`, () => kindCases(context));
  } finally {
    await app.close();
    await rig.dispose();
  }
  await report.run(`${label} the ceiling`, () => ceilingCases(kind));
  const records = await makeRig(kind, { attach: false });
  const pools: Pool[] = [];
  try {
    await report.run(`${label} change records`, () => changeRecords(kind, records, pools));
  } finally {
    await Promise.all(pools.map((pool) => pool.end()));
    await records.dispose();
  }
}

try {
  await series(rigKinds, suite);
} finally {
  await cleanAll();
}
report.finish();
