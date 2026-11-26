// Does:  Proves a pool accepts only a certificate that verifies and signs in with every password of the SASLprep list.
// Holds: Every role and database made here is the proof's own, named va_, and dropped in finally.

// biome-ignore-all lint/security/noSecrets: planted test passwords, not credentials
// biome-ignore-all lint/performance/noAwaitInLoops: each role is made, used and judged alone so a failure names it
import { sql } from '@skeld/data/sql';
import { createReport } from '../support/support-proof.ts';
import { bootPool } from './rig/boot-pool.ts';
import { pg19, side, uniqueName, urlOf } from './rig/pg19.ts';
import { startHostileServer } from './rig/hostile-server.ts';

const report = createReport();
const server = pg19();
const admin = { user: server.user, password: server.password, port: server.port };

async function version(
  url: string,
  ca?: string,
): Promise<{ stage: string | null; reason: string | null; major: number | null }> {
  const booted = await bootPool(url, ca === undefined ? {} : { ca });
  try {
    if (booted.failure !== null || booted.database === null) {
      return { stage: booted.failure?.stage ?? null, reason: booted.failure?.reason ?? null, major: null };
    }
    const rows = await booted.database
      .for(booted.server)
      .query(sql`select current_setting('server_version_num')::int as v`);
    return { stage: null, reason: null, major: Math.floor(Number(rows[0]?.v) / 10_000) };
  } finally {
    await booted.finish();
  }
}

// Why: A certificate that verifies is the only way in, so each refusal is paired with a pool that connects.
const accepted = await version(urlOf(admin), server.ca);
report.result(
  'a certificate from the supplied authority is accepted',
  accepted.major === 19 ? [] : [`expected PostgreSQL 19, got ${JSON.stringify(accepted)}`],
  `server major ${accepted.major}`,
);

const other = await startHostileServer({ mode: 'tls-n' });
const strangerAuthority = other.ca;
await other.close();
const refusals = [
  { name: 'a certificate from another authority is refused', ca: strangerAuthority },
  { name: 'a certificate the default roots do not know is refused', ca: undefined },
];
for (const refusal of refusals) {
  const result = await version(urlOf(admin), refusal.ca);
  const problems =
    result.stage === 'tls' && result.reason === 'certificate' && result.major === null
      ? []
      : [`expected a refusal at tls/certificate, got ${JSON.stringify(result)}`];
  report.result(refusal.name, problems, `stage ${result.stage}, reason ${result.reason}`);
}

const passwords = [
  { name: 'ASCII', text: 'Correct-Horse-Battery-9' },
  { name: 'a precomposed accented letter', text: 'café-pass-1' },
  { name: 'a decomposed accented letter', text: 'café-pass-2' },
  { name: 'a soft hyphen', text: 'soft­hyphen-3' },
  { name: 'a no-break space', text: 'no break-4' },
  { name: 'a character SASLprep prohibits (BEL)', text: 'bel\u0007char-5' },
];
const client = await side();
const roles: string[] = [];
try {
  for (const password of passwords) {
    const role = uniqueName('va_pw');
    roles.push(role);
    await client.query(`create role ${role} login password ${client.escapeLiteral(password.text)}`);
    const result = await version(urlOf({ user: role, password: password.text, port: server.port }), server.ca);
    report.result(
      `the password list: ${password.name} signs in`,
      result.major === 19 ? [] : [`expected a session on PostgreSQL 19, got ${JSON.stringify(result)}`],
      `server major ${result.major}`,
    );
  }
  const control = await version(
    urlOf({ user: roles[0] ?? '', password: 'not-the-password', port: server.port }),
    server.ca,
  );
  report.result(
    'control: a wrong password is refused by the server at authentication',
    control.stage === 'authentication' && control.major === null
      ? []
      : [`expected a refusal at authentication, got ${JSON.stringify(control)}`],
    `stage ${control.stage}, reason ${control.reason}`,
  );
} finally {
  for (const role of roles) {
    await client.query(`drop role if exists ${role}`);
  }
  await client.end();
}
report.finish();
