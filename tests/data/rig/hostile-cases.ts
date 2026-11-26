// Does:  Runs each hostile-server case of the connection criteria through the public API and judges it.
// Holds: A verdict comes from the criterion's statement and the bytes a fixture recorded, never from product code.

import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { DataError } from '@skeld/data/data-error';
import { sql } from '@skeld/data/sql';
import { type BootFailure, type PoolBounds, bootPool } from './boot-pool.ts';
import {
  type HostileConfig,
  type HostileConnection,
  type HostileServer,
  startHostileServer,
} from './hostile-server.ts';

export interface CaseResult {
  readonly name: string;
  readonly problems: string[];
  readonly observed: string;
}

const SSL_REQUEST = Buffer.from('0000000804d2162f', 'hex');
const secret = (): string => `pw-${randomBytes(6).toString('hex')}`;

function need(problems: string[], condition: boolean, message: string): void {
  if (!condition) {
    problems.push(message);
  }
}

function describe(connections: readonly HostileConnection[]): string {
  return connections
    .map(
      (c) =>
        `#${c.id} raw=${c.raw.length}B received=${c.received.length}B types=[${c.messages.map((m) => m.type || 'startup').join(' ')}]`,
    )
    .join('; ');
}

function holds(connections: readonly HostileConnection[], text: string): boolean {
  const needle = Buffer.from(text, 'utf8');
  return connections.some((c) => c.raw.includes(needle) || c.received.includes(needle));
}

// Does:  Reads the one JSON line a child process printed; the fields are checked where they are used.
function parseReport(out: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(out.trim().split('\n').pop() ?? '{}');
  return typeof parsed === 'object' && parsed !== null ? Object.fromEntries(Object.entries(parsed)) : {};
}

function num(value: unknown): number {
  return typeof value === 'number' ? value : Number.MAX_SAFE_INTEGER;
}

function failureLine(failure: BootFailure | null): string {
  return failure === null ? 'booted' : `${failure.code} stage=${failure.stage} reason=${failure.reason}`;
}

interface Refusal {
  readonly name: string;
  readonly config: HostileConfig;
  readonly stage: string;
  readonly reason: string;
  readonly password?: boolean;
  readonly sent: readonly string[];
  readonly planted?: boolean;
}

async function refusal(spec: Refusal): Promise<CaseResult> {
  const fixture = await startHostileServer(spec.config);
  const password = secret();
  const url = `postgres://u${spec.password === false ? '' : `:${password}`}@127.0.0.1:${fixture.port}/d?sslmode=require`;
  const booted = await bootPool(url, { ca: fixture.ca });
  const lines = await booted.finish();
  const problems: string[] = [];
  const failure = booted.failure;
  need(
    problems,
    failure !== null && failure.code === 'PLUGIN_FAILED',
    `boot did not fail with PLUGIN_FAILED: ${failureLine(failure)}`,
  );
  need(
    problems,
    failure?.stage === spec.stage && failure.reason === spec.reason,
    `expected ${spec.stage}/${spec.reason}, got ${failureLine(failure)}`,
  );
  need(problems, fixture.connections.length > 0, 'the fixture received no connection');
  for (const c of fixture.connections) {
    need(problems, c.raw.subarray(0, 8).equals(SSL_REQUEST), `connection ${c.id} did not begin with the TLS request`);
    const types = c.messages.map((m) => m.type || 'startup').join(' ');
    need(
      problems,
      spec.sent.join(' ') === types,
      `connection ${c.id} sent [${types}], allowed [${spec.sent.join(' ')}]`,
    );
  }
  need(problems, !holds(fixture.connections, password), 'the password reached the fixture');
  if (spec.config.mode === 'tls-n' || spec.config.mode === 'tls-extra' || spec.config.mode === 'tls-error') {
    need(
      problems,
      fixture.connections.every((c) => c.raw.equals(SSL_REQUEST)),
      'a byte followed the TLS request',
    );
  } else if (
    spec.config.mode === 'self-signed' ||
    spec.config.mode === 'wrong-host' ||
    spec.config.mode === 'alpn-other'
  ) {
    need(
      problems,
      fixture.connections.every((c) => c.received.length === 0),
      'a byte reached the fixture after the handshake',
    );
  }
  const everything = `${failure?.everything ?? ''}\n${lines.join('\n')}`;
  need(problems, !everything.includes(password), 'the password appears in the error or the log');
  need(problems, !everything.includes(fixture.marker), "the fixture's own text appears in the error or the log");
  need(
    problems,
    fixture.connections.every((c) => c.cycles === 0),
    'a statement reached the fixture',
  );
  const observed = `${failureLine(failure)}; ${describe(fixture.connections)}`;
  await fixture.close();
  return { name: spec.name, problems, observed };
}

export const ac1 = (): Promise<CaseResult[]> =>
  runAll([
    {
      name: 'AC-1 (a) the TLS request is answered N',
      config: { mode: 'tls-n' },
      stage: 'tls',
      reason: 'declined',
      sent: [],
    },
    {
      name: 'AC-1 (b) S arrives with a further byte in the same write',
      config: { mode: 'tls-extra' },
      stage: 'tls',
      reason: 'answer',
      sent: [],
    },
    {
      name: 'AC-1 (c) the TLS request is answered with an error message',
      config: { mode: 'tls-error' },
      stage: 'tls',
      reason: 'answer',
      sent: [],
    },
    {
      name: 'AC-1 (d) a self-signed certificate',
      config: { mode: 'self-signed' },
      stage: 'tls',
      reason: 'certificate',
      sent: [],
    },
    {
      name: 'AC-1 (e) a certificate from the supplied root for another host name',
      config: { mode: 'wrong-host' },
      stage: 'tls',
      reason: 'hostname',
      sent: [],
    },
  ]);

export const ac2 = (): Promise<CaseResult[]> =>
  runAll([
    {
      name: 'AC-2 a server asks for a cleartext password',
      config: { mode: 'cleartext' },
      stage: 'authentication',
      reason: 'method',
      sent: ['startup'],
    },
    {
      name: 'AC-2 a server asks for MD5',
      config: { mode: 'md5' },
      stage: 'authentication',
      reason: 'method',
      sent: ['startup'],
    },
    {
      name: 'AC-2 a server reports success with no exchange to a pool that holds a password',
      config: { mode: 'auth-ok' },
      stage: 'authentication',
      reason: 'not-asked',
      sent: ['startup'],
    },
  ]);

export async function wrongSignature(): Promise<CaseResult> {
  const password = secret();
  const fixture = await startHostileServer({ mode: 'scram', password, wrongSignature: true });
  const booted = await bootPool(
    `postgres://u:${encodeURIComponent(password)}@127.0.0.1:${fixture.port}/d?sslmode=require`,
    { ca: fixture.ca },
  );
  const lines = await booted.finish();
  const problems: string[] = [];
  const failure = booted.failure;
  need(
    problems,
    failure?.code === 'PLUGIN_FAILED' && failure.stage === 'authentication' && failure.reason === 'signature',
    `expected authentication/signature, got ${failureLine(failure)}`,
  );
  const entry = fixture.connections[0];
  need(
    problems,
    entry?.scram?.proofVerified === true,
    'the exchange did not reach the server signature (the fixture did not verify the proof)',
  );
  need(
    problems,
    fixture.connections.every((c) => c.cycles === 0 && c.messages.every((m) => m.type === '' || m.type === 'p')),
    'a statement reached the fixture, which would have handed a session out',
  );
  need(problems, !holds(fixture.connections, password), 'the password reached the fixture');
  need(
    problems,
    !`${failure?.everything}${lines.join('')}`.includes(password),
    'the password appears in the error or the log',
  );
  const observed = `${failureLine(failure)}; scram=${JSON.stringify(entry?.scram)}; ${describe(fixture.connections)}`;
  await fixture.close();
  return { name: 'AC-2 a wrong server signature is refused before the connection is handed out', problems, observed };
}

async function runAll(specs: Refusal[]): Promise<CaseResult[]> {
  const out: CaseResult[] = [];
  for (const spec of specs) {
    // biome-ignore lint/performance/noAwaitInLoops: each case owns one fixture and one server, run one at a time
    out.push(await refusal(spec));
  }
  return out;
}

async function sessionPool(config: HostileConfig, bounds: PoolBounds) {
  const fixture = await startHostileServer(config);
  const booted = await bootPool(`postgres://u@127.0.0.1:${fixture.port}/d?sslmode=require`, { ca: fixture.ca, bounds });
  return { fixture, booted };
}

async function codeOf(run: Promise<unknown>): Promise<string> {
  try {
    await run;
    return 'resolved';
  } catch (error) {
    return error instanceof DataError ? error.code : String(error);
  }
}

export async function hostileAnswer(
  name: string,
  hostile: 'field-below-minus-one' | 'field-past-message',
  expected: string,
): Promise<CaseResult> {
  const { fixture, booted } = await sessionPool({ mode: 'auth-ok', hostile }, { maxResultBytes: 1_048_576 });
  const problems: string[] = [];
  const database = booted.database;
  if (database === null || booted.failure !== null) {
    await fixture.close();
    return { name, problems: [`the pool did not boot: ${failureLine(booted.failure)}`], observed: '' };
  }
  const handle = database.for(booted.server);
  const code = await codeOf(handle.query(sql`select 1`));
  await fixture.closed(0);
  const rows = await handle.query(sql`select 1`);
  await booted.finish();
  need(problems, code === expected, `the call failed with ${code}, expected ${expected}`);
  need(problems, fixture.connections[0]?.closed === true, 'the PostgreSQL connection was not closed');
  need(
    problems,
    JSON.stringify(rows) === '[{"?column?":1}]',
    `the next query was not answered: ${JSON.stringify(rows)}`,
  );
  const observed = `first call ${code}; fixture connection #1 closed=${fixture.connections[0]?.closed}; next query ${JSON.stringify(rows)}; connections=${fixture.connections.length}`;
  await fixture.close();
  return { name, problems, observed };
}

export async function oversizedLength(bound = 1_048_576): Promise<CaseResult> {
  const fixture = await startHostileServer({ mode: 'auth-ok', hostile: 'oversized-length' });
  const child = spawn(
    process.execPath,
    [...process.execArgv, fileURLToPath(new URL('./flood-client.ts', import.meta.url))],
    {
      env: { ...process.env, VA_PORT: String(fixture.port), VA_CA: fixture.ca, VA_BOUND: String(bound) },
      stdio: ['ignore', 'pipe', 'inherit'],
    },
  );
  let out = '';
  child.stdout.on('data', (d: Buffer) => {
    out += d.toString();
  });
  await new Promise<void>((resolve) => child.once('close', () => resolve()));
  await fixture.closed(0);
  const problems: string[] = [];
  const report = parseReport(out);
  need(
    problems,
    num(report.controlRise) >= bound,
    `control: a held buffer of ${bound * 2} bytes moved arrayBuffers by only ${String(report.controlRise)}`,
  );
  const first = fixture.connections[0];
  need(
    problems,
    report.code === 'RESULT_TOO_LARGE',
    `the call failed with ${report.code ?? report.bootFailed}, expected RESULT_TOO_LARGE`,
  );
  need(problems, first?.closed === true, 'the PostgreSQL connection was not closed');
  need(problems, (first?.hostileWritten ?? 0) > 5, 'the fixture never wrote the flood');
  need(
    problems,
    num(report.peakRise) < bound && num(report.settledRise) < bound,
    `arrayBuffers rose by ${report.peakRise} (peak) and ${report.settledRise} (settled), not under the bound ${bound}`,
  );
  need(
    problems,
    JSON.stringify(report.next) === '[{"?column?":1}]',
    `the next query was not answered: ${JSON.stringify(report.next)}`,
  );
  const observed = `call ${report.code}; fixture wrote ${first?.hostileWritten} bytes until the client closed (closed=${first?.closed}, capped=${first?.hostileCapped}); client arrayBuffers rose ${report.peakRise} at peak (a held buffer of ${bound * 2} bytes moved it ${report.controlRise}), ${report.settledRise} settled, ${report.collectedRise} after collection, bound ${bound}; next query ${JSON.stringify(report.next)}`;
  await fixture.close();
  return { name: 'AC-3 (a) a declared message length over the inbound bound', problems, observed };
}

export async function iterationsOverBound(): Promise<CaseResult> {
  const password = secret();
  const fixture = await startHostileServer({ mode: 'scram', password, iterations: 2_000_000 });
  const booted = await bootPool(`postgres://u:${password}@127.0.0.1:${fixture.port}/d?sslmode=require`, {
    ca: fixture.ca,
  });
  await booted.finish();
  await fixture.closed(0);
  const problems: string[] = [];
  const failure = booted.failure;
  need(
    problems,
    failure?.code === 'PLUGIN_FAILED' && failure.stage === 'authentication' && failure.reason === 'iterations',
    `expected authentication/iterations, got ${failureLine(failure)}`,
  );
  need(problems, fixture.connections[0]?.closed === true, 'the PostgreSQL connection was not closed');
  need(
    problems,
    fixture.connections.every(
      (c) =>
        c.messages.every((m) => m.type === '' || m.type === 'p') &&
        c.messages.filter((m) => m.type === 'p').length <= 1,
    ),
    'the client answered the iteration count with a proof',
  );
  const observed = `${failureLine(failure)}; scram=${JSON.stringify(fixture.connections[0]?.scram)}; ${describe(fixture.connections)}`;
  await fixture.close();
  return { name: 'AC-3 (d) an iteration count over its bound', problems, observed };
}

export async function parametersOverBound(): Promise<CaseResult> {
  const { fixture, booted } = await sessionPool({ mode: 'auth-ok' }, { maxParameterBytes: 1024 });
  const problems: string[] = [];
  const database = booted.database;
  if (database === null || booted.failure !== null) {
    await fixture.close();
    return { name: 'AC-3 (f)', problems: [`the pool did not boot: ${failureLine(booted.failure)}`], observed: '' };
  }
  const handle = database.for(booted.server);
  const before = fixture.connections.map((c) => c.messages.length);
  const bytesBefore = fixture.connections.map((c) => c.received.length);
  const code = await codeOf(handle.query(sql`select ${'x'.repeat(4096)}`));
  const after = fixture.connections.map((c) => c.messages.length);
  const bytesAfter = fixture.connections.map((c) => c.received.length);
  const rows = await handle.query(sql`select 1`);
  await booted.finish();
  need(problems, code === 'PARAMETERS_TOO_LARGE', `the call failed with ${code}, expected PARAMETERS_TOO_LARGE`);
  need(
    problems,
    JSON.stringify(before) === JSON.stringify(after) && JSON.stringify(bytesBefore) === JSON.stringify(bytesAfter),
    'the fixture received a byte for the refused call',
  );
  need(
    problems,
    JSON.stringify(rows) === '[{"?column?":1}]',
    `the next query was not answered: ${JSON.stringify(rows)}`,
  );
  const observed = `call ${code}; fixture bytes received before=${bytesBefore.join(',')} after=${bytesAfter.join(',')}; next query ${JSON.stringify(rows)}; connections=${fixture.connections.length}`;
  await fixture.close();
  return { name: 'AC-3 (f) a call whose parameters exceed the outbound bound sends nothing', problems, observed };
}

export async function alpnOther(): Promise<CaseResult> {
  const result = await refusal({
    name: 'GP-4 a TLS fixture whose only ALPN protocol is another one',
    config: { mode: 'alpn-other' },
    stage: 'tls',
    reason: 'handshake',
    sent: [],
  });
  return result;
}

export async function noCancelKey(): Promise<CaseResult> {
  const fixture = await startHostileServer({ mode: 'auth-ok', key: 'none' });
  const booted = await bootPool(`postgres://u@127.0.0.1:${fixture.port}/d?sslmode=require`, { ca: fixture.ca });
  await booted.finish();
  const problems: string[] = [];
  const failure = booted.failure;
  need(
    problems,
    failure?.code === 'PLUGIN_FAILED' && failure.stage === 'startup' && failure.reason === 'no-key',
    `expected startup/no-key, got ${failureLine(failure)}`,
  );
  need(
    problems,
    fixture.connections.every((c) => c.cycles === 0),
    'a statement reached the fixture',
  );
  const observed = `${failureLine(failure)}; the fixture reached ReadyForQuery without BackendKeyData; ${describe(fixture.connections)}`;
  await fixture.close();
  return { name: 'GP-8 a fixture that reaches ReadyForQuery without a cancel key', problems, observed };
}

export async function negotiatedAlpn(): Promise<CaseResult> {
  const fixture: HostileServer = await startHostileServer({ mode: 'auth-ok' });
  const booted = await bootPool(`postgres://u@127.0.0.1:${fixture.port}/d?sslmode=require`, { ca: fixture.ca });
  await booted.finish();
  const problems: string[] = [];
  need(problems, booted.failure === null, `the pool did not boot: ${failureLine(booted.failure)}`);
  need(
    problems,
    fixture.connections[0]?.alpn === 'postgresql',
    `the ALPN negotiated with the pool was ${String(fixture.connections[0]?.alpn)}`,
  );
  const observed = `boot ${failureLine(booted.failure)}; ALPN negotiated with the pool: ${String(fixture.connections[0]?.alpn)}`;
  await fixture.close();
  return { name: 'GP-4 the pool offers ALPN postgresql to a server that accepts it', problems, observed };
}

export async function selfSignedUnderLaxEnvironment(): Promise<CaseResult> {
  const fixture = await startHostileServer({ mode: 'self-signed' });
  const child = spawn(
    process.execPath,
    [...process.execArgv, fileURLToPath(new URL('./boot-client.ts', import.meta.url))],
    {
      env: {
        ...process.env,
        NODE_TLS_REJECT_UNAUTHORIZED: '0',
        VA_PORT: String(fixture.port),
        VA_CA: fixture.ca,
        VA_CONTROL: '1',
      },
      stdio: ['ignore', 'pipe', 'ignore'],
    },
  );
  let out = '';
  child.stdout.on('data', (d: Buffer) => {
    out += d.toString();
  });
  await new Promise<void>((resolve) => child.once('close', () => resolve()));
  const problems: string[] = [];
  const report = parseReport(out);
  const pool = fixture.connections.slice(1);
  need(problems, report.env === '0', 'the child did not run with NODE_TLS_REJECT_UNAUTHORIZED=0');
  need(
    problems,
    report.control === true,
    'control: a bare TLS client in the same process did not accept the self-signed certificate, so the setting is not shown to act',
  );
  need(
    problems,
    report.booted === false && report.stage === 'tls' && report.reason === 'certificate',
    `expected a refusal at tls/certificate, got booted=${report.booted} ${report.stage}/${report.reason}`,
  );
  need(
    problems,
    pool.length > 0 && pool.every((c) => c.received.length === 0 && c.messages.length === 0),
    'a startup message reached the fixture',
  );
  const observed = `child env NODE_TLS_REJECT_UNAUTHORIZED=${report.env}; control (bare TLS client) accepted the certificate: ${report.control}; pool boot ${report.booted ? 'booted' : `refused at ${report.stage}/${report.reason}`}; fixture connections of the pool: ${describe(pool)}`;
  await fixture.close();
  return { name: 'GP-13 a self-signed fixture under NODE_TLS_REJECT_UNAUTHORIZED=0', problems, observed };
}
