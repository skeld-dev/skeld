// Does:  Proves the twenty gate and auth diagnostic hooks the product declares fire under the diag build.
// Holds: The child that drives them runs under the skeld-diag condition; a hook is shown by name in a recorder file.

import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cookieHeader, get, observe, send, series, sleepMs, startApp } from './rig/v1-app.ts';
import { createReport } from './rig/v1-report.ts';
import { cleanAll, type Kind, makeRig } from './support-store.ts';
import { storeKinds as rigKinds } from '../support/test-profile.ts';
import { hashPassword } from '@skeld/auth/password';
import { Secret } from '@skeld/core/secret';

const self = fileURLToPath(import.meta.url);

async function child(kind: Kind): Promise<void> {
  const rig = await makeRig(kind, { attach: false, cleanupIntervalSeconds: 1, maxClients: 1 });
  const blackHole = net.createServer(() => undefined);
  await new Promise<void>((resolve) => {
    blackHole.listen(0, '127.0.0.1', resolve);
  });
  const address = blackHole.address();
  const holePort = address !== null && typeof address === 'object' ? address.port : 0;
  const expired = Date.now() - 60_000;
  await rig.query(
    'INSERT INTO sessions (digest, user_id, created_at, last_seen_at, absolute_expires_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)',
    [Buffer.alloc(32, 1), 'expired-one', expired, expired, expired, expired],
  );
  const observed = observe(rig.store);
  let throwing = false;
  const app = await startApp({
    store: observed.store,
    session: { idleSeconds: 6, absoluteSeconds: 30, renewSeconds: 1 },
    jwksUrl: `https://127.0.0.1:${holePort}/jwks`,
    addressLimit: { max: 100, windowSeconds: 60 },
    oidcIssuers: Array.from({ length: 16 }, (_, n) => `https://127.0.0.1:${holePort}/issuer${n + 1}`),
    docsRead: () => {
      if (throwing) {
        throw new Error('a policy action that threw');
      }
      return true;
    },
  });
  const signed = await app.signIn('diag-user');
  const cookie = cookieHeader('__Host-skeld', signed.token ?? '');
  await get(app.port, '/docs', [cookie]);
  await get(app.port, '/docs');
  throwing = true;
  await get(app.port, '/docs', [cookie]);
  throwing = false;
  await sleepMs(1300);
  await get(app.port, '/docs', [cookie]);
  await app.limits.charge('login', 'diag');
  await send(app.port, { method: 'POST', path: '/rotate', headers: [cookie] });
  const hashes = await Promise.all(Array.from({ length: 4 }, () => hashPassword(new Secret('diag-password'))));
  if (hashes.length !== 4) {
    throw new Error('hashes');
  }
  const unknownKid = `${Buffer.from('{"alg":"ES256","kid":"unknown-kid"}').toString('base64url')}.${Buffer.from('{"sub":"x"}').toString('base64url')}.${Buffer.alloc(64, 7).toString('base64url')}`;
  const jwtReply = get(app.port, '/jwt-docs', [`authorization: Bearer ${unknownKid}`]);
  const starts = Promise.all(
    Array.from({ length: 16 }, (_, n) =>
      send(app.port, { method: 'POST', path: `/auth/oidc/p${n + 1}/start`, body: '{}' }),
    ),
  );
  await sleepMs(700);
  if (kind === 'sqlite') {
    await rig.hold('subjects', 'x', 900);
    await Promise.all([app.signIn('blocked-1'), app.signIn('blocked-2')]);
  } else {
    await app.signIn('held-user');
    await rig.hold('subjects', 'held-user', 8000);
    await Promise.all([app.signIn('held-user'), app.signIn('held-user')]);
  }
  await Promise.all([jwtReply, starts]);
  await sleepMs(1500);
  await app.close();
  blackHole.close();
  await rig.dispose();
  await cleanAll();
  process.exit(0);
}

function figure(value: unknown, key: string): number {
  const found: unknown = typeof value === 'object' && value !== null ? Reflect.get(value, key) : undefined;
  return typeof found === 'number' ? found : 0;
}

function firedLabels(parsed: object, section: string): string[] {
  const table: unknown = Reflect.get(parsed, section);
  if (typeof table !== 'object' || table === null) {
    return [];
  }
  return Object.entries(table)
    .filter(([, figures]) => {
      if (typeof figures === 'number') {
        return figures > 0;
      }
      return section === 'limits'
        ? figure(figures, 'run_peak') > 0
        : figure(figures, 'n') > 0 || figure(figures, 'run_n') > 0;
    })
    .map(([label]) => label.replace(/\{.*\}$/, ''));
}

function seen(text: string, file: string, into: Map<string, string>): void {
  for (const line of text.split('\n')) {
    try {
      const parsed: unknown = line.trim() === '' ? null : JSON.parse(line);
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        continue;
      }
      for (const key of ['name', 'hook']) {
        const named: unknown = Reflect.get(parsed, key);
        if (typeof named === 'string') {
          into.set(named, into.get(named) ?? `${file} (event)`);
        }
      }
      for (const section of ['counts', 'spans', 'limits']) {
        for (const label of firedLabels(parsed, section)) {
          into.set(label, into.get(label) ?? `${file} (${section.slice(0, -1)})`);
        }
      }
    } catch {
      // Why: a line cut off by the end of the process is not data
    }
  }
}

const coreGateHooks = ['boot.gate', 'req.gate.identify', 'req.gate.authorize', 'refuse.gate', 'err.gate'];

function declared(path: string, pattern: RegExp): string[] {
  const text = readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8');
  return [...text.matchAll(/'([a-z_.]+)'/g)].map((match) => match[1] ?? '').filter((name) => pattern.test(name));
}

// Does:  Reads auth's hook names from the unions in its diag/empty.ts and the five gate names from core's.
function hooks(): { core: string[]; coreDeclared: string[]; auth: string[]; eventsNever: boolean } {
  const authText = readFileSync(
    fileURLToPath(new URL('../../packages/auth/src/diag/empty.ts', import.meta.url)),
    'utf8',
  );
  const unions = [...authText.matchAll(/export type (?:Span|Count|Limit)Name =([^;]*);/g)];
  const auth = unions.flatMap((union) =>
    [...(union[1] ?? '').matchAll(/'([a-z_.]+)'/g)].map((match) => match[1] ?? ''),
  );
  const coreDeclared = declared('../../packages/core/src/diag/empty.ts', /gate/);
  return { core: coreGateHooks, coreDeclared, auth, eventsNever: /export type EventName = never;/.test(authText) };
}

function read(dir: string, file: string): string {
  try {
    return readFileSync(join(dir, file), 'utf8');
  } catch {
    return '';
  }
}

async function main(): Promise<void> {
  const report = createReport(
    'v09',
    'the five core gate hooks and the fifteen auth hooks the product declares each fire under the diag build and are shown by name in the recorder files; a hook that fires and is not declared is a finding; a declared hook that never fires is a finding',
  );
  const map = hooks();
  report.check(
    "auth's declared hooks (the SpanName, CountName and LimitName unions of its diag/empty.ts) are the fifteen this script drives, and EventName is never",
    map.auth.length === 15 && new Set(map.auth).size === 15 && map.eventsNever,
    `${map.auth.length} declared`,
  );
  report.check(
    "the gate hooks declared in core's diag/empty.ts are exactly the five this script drives (a new hook without a proof fails here)",
    [...map.coreDeclared].sort().join(',') === [...map.core].sort().join(','),
    `declared: ${map.coreDeclared.join(',')}`,
  );
  const union = new Set<string>();
  await series(rigKinds, (kind) => {
    const dir = mkdtempSync(join(tmpdir(), 'skeld-v09-diag-'));
    try {
      const began = performance.now();
      const run = spawnSync(
        process.execPath,
        ['--conditions=skeld-source', '--conditions=skeld-diag', self, 'child', kind],
        {
          env: { ...process.env, SKELD_DIAG_DIR: dir, SKELD_DIAG_STEP_N: '1' },
          encoding: 'utf8',
          timeout: 90_000,
        },
      );
      report.check(
        `[${kind}] the diag child drove the gated server and exited 0 in ${Math.round((performance.now() - began) / 1000)} s`,
        run.status === 0,
        `exit ${String(run.status)} ${run.stderr.slice(0, 300)}`,
      );
      const authSeen = new Map<string, string>();
      const coreSeen = new Map<string, string>();
      seen(read(dir, 'auth-snapshot.jsonl'), 'auth-snapshot.jsonl', authSeen);
      seen(read(dir, 'auth-journal.jsonl'), 'auth-journal.jsonl', authSeen);
      seen(read(dir, 'snapshot.jsonl'), 'snapshot.jsonl', coreSeen);
      seen(read(dir, 'journal.jsonl'), 'journal.jsonl', coreSeen);
      const absent = kind === 'sqlite' ? 'auth.store.waiting' : 'auth.store.busy_retry';
      for (const hook of map.core) {
        report.check(
          `[${kind}] core hook ${hook} fires`,
          coreSeen.has(hook),
          coreSeen.get(hook) ?? 'not in the recorder output',
        );
        union.add(hook);
      }
      for (const hook of map.auth) {
        if (hook === absent) {
          report.check(
            `[${kind}] auth hook ${hook} is not reported by this adapter, as the adapter's contract says`,
            !authSeen.has(hook),
            authSeen.get(hook) ?? 'absent',
          );
          continue;
        }
        const where = authSeen.get(hook);
        report.check(`[${kind}] auth hook ${hook} fires`, where !== undefined, where ?? 'not in the recorder output');
        if (where !== undefined) {
          union.add(hook);
        }
      }
      const unmappedAuth = [...authSeen.keys()].filter((name) => !map.auth.includes(name));
      const unmappedCore = [...coreSeen.keys()].filter((name) => name.includes('gate') && !map.core.includes(name));
      report.check(
        `[${kind}] no auth hook fires that the product does not declare, and no core gate hook outside the five`,
        unmappedAuth.length === 0 && unmappedCore.length === 0,
        `auth: ${unmappedAuth.join(',') || 'none'}; core gate: ${unmappedCore.join(',') || 'none'}`,
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
    return Promise.resolve();
  });
  const quiet = mkdtempSync(join(tmpdir(), 'skeld-v09-normal-'));
  try {
    const normal = spawnSync(process.execPath, ['--conditions=skeld-source', self, 'child', 'sqlite'], {
      env: { ...process.env, SKELD_DIAG_DIR: quiet, SKELD_DIAG_STEP_N: '1' },
      encoding: 'utf8',
      timeout: 90_000,
    });
    report.check(
      'under the normal build (no skeld-diag condition, the same drive, SKELD_DIAG_DIR set) the hooks are the empty module: the child exits 0 and no recorder file is written',
      normal.status === 0 && readdirSync(quiet).length === 0,
      `exit ${String(normal.status)}; ${readdirSync(quiet).length} files in the diag folder`,
    );
  } finally {
    rmSync(quiet, { recursive: true, force: true });
  }
  report.check(
    `between the two adapters all twenty hooks fired (${union.size} of 20)`,
    union.size === 20,
    [...union].sort().join(','),
  );
  report.finish();
}

const kindArg = process.argv[3];
if (process.argv[2] === 'child' && (kindArg === 'sqlite' || kindArg === 'postgres')) {
  await child(kindArg);
} else {
  try {
    await main();
  } finally {
    await cleanAll();
  }
}
