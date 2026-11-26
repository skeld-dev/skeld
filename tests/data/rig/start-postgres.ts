// Does:  Starts the disposable PostgreSQL 19 proof container with TLS from a generated authority.
// Holds: The URL and authority path reach only the named 0600 file outside the repository, never output or arguments.

import { execFileSync, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { chmodSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const CONTAINER = 'skeld-data-pg';
const IMAGE = 'postgres:19-alpine';
const HOST_PORT = '54419';
const FOLDER_PREFIX = 'skeld-data-pg-';
const WAIT_MS = 120_000;

// Why: The published port reaches the container from the bridge address, so each line matches every address.
const HBA = [
  'local all all trust',
  'host all skeld_relay 0.0.0.0/0 scram-sha-256',
  'host all skeld_relay ::/0 scram-sha-256',
  'hostssl all all 0.0.0.0/0 scram-sha-256',
  'hostssl all all ::/0 scram-sha-256',
  '',
].join('\n');

// Why: The server refuses a key it does not own, and a read-only mount is owned by the host user.
const WRAPPER = [
  'set -eu',
  'install -d -o postgres -g postgres -m 0700 /tls',
  'for f in server.key server.crt pg_hba.conf; do install -o postgres -g postgres -m 0600 "/tls-src/$f" "/tls/$f"; done',
  'exec docker-entrypoint.sh postgres -c ssl=on -c ssl_cert_file=/tls/server.crt -c ssl_key_file=/tls/server.key -c hba_file=/tls/pg_hba.conf',
].join('\n');

function docker(args: string[], env?: NodeJS.ProcessEnv): string {
  return execFileSync('docker', args, { encoding: 'utf8', env, stdio: ['ignore', 'pipe', 'pipe'] });
}

function openssl(...args: string[]): void {
  execFileSync('openssl', args, { stdio: 'ignore' });
}

// Does:  Removes a previous container and the certificate folder it was started with.
// Holds: Only a folder directly inside the system temporary folder and named by this script's prefix is ever deleted.
function removePrevious(): void {
  const found = spawnSync(
    'docker',
    ['inspect', '--format', '{{range .Mounts}}{{if eq .Destination "/tls-src"}}{{.Source}}{{end}}{{end}}', CONTAINER],
    {
      encoding: 'utf8',
    },
  );
  if (found.status !== 0) {
    return;
  }
  docker(['rm', '-f', '-v', CONTAINER]);
  const old = found.stdout.trim();
  if (old !== '' && dirname(old) === resolve(tmpdir()) && basename(old).startsWith(FOLDER_PREFIX)) {
    rmSync(old, { recursive: true, force: true });
  }
}

function makeAuthority(dir: string): void {
  const file = (name: string): string => join(dir, name);
  const curve = ['-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:prime256v1', '-nodes'];
  openssl(
    ...['req', '-x509', ...curve, '-keyout', file('ca.key'), '-out', file('ca.pem'), '-days', '7'],
    ...['-subj', '/CN=Skeld data proof authority', '-addext', 'basicConstraints=critical,CA:TRUE'],
    ...['-addext', 'keyUsage=critical,keyCertSign'],
  );
  writeFileSync(
    file('server.ext'),
    ['subjectAltName=DNS:localhost,IP:127.0.0.1', 'extendedKeyUsage=serverAuth', ''].join('\n'),
  );
  openssl('req', '-new', ...curve, '-keyout', file('server.key'), '-out', file('server.csr'), '-subj', '/CN=localhost');
  openssl(
    ...['x509', '-req', '-in', file('server.csr'), '-CA', file('ca.pem'), '-CAkey', file('ca.key')],
    ...['-CAcreateserial', '-out', file('server.crt'), '-extfile', file('server.ext'), '-days', '7'],
  );
  // Why: Nothing after this signs a certificate, so the authority's key is not kept.
  unlinkSync(file('ca.key'));
  writeFileSync(file('pg_hba.conf'), HBA);
}

function waitUntilReady(): void {
  const deadline = Date.now() + WAIT_MS;
  for (;;) {
    const state = docker(['inspect', '--format', '{{.State.Running}}', CONTAINER]).trim();
    if (state !== 'true') {
      throw new Error(`${CONTAINER} stopped before it accepted connections`);
    }
    // Why: Initialisation runs a server on a socket only, so a TCP answer means the final server is up.
    const probe = spawnSync('docker', ['exec', CONTAINER, 'pg_isready', '-q', '-h', '127.0.0.1', '-p', '5432'], {
      stdio: 'ignore',
    });
    if (probe.status === 0) {
      return;
    }
    if (Date.now() > deadline) {
      throw new Error(`${CONTAINER} did not accept connections within ${WAIT_MS} ms`);
    }
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 250);
  }
}

function main(): void {
  const target = process.argv[2];
  if (target === undefined || process.argv.length !== 3) {
    throw new Error('usage: node tests/data/rig/start-postgres.ts <env-file>');
  }
  const envFile = resolve(target);
  const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
  const inside = relative(repo, envFile);
  if (inside !== '' && !inside.startsWith('..') && !inside.startsWith('/')) {
    throw new Error('the environment file must be outside the repository');
  }

  removePrevious();
  const dir = mkdtempSync(join(tmpdir(), FOLDER_PREFIX));
  makeAuthority(dir);

  const password = randomBytes(24).toString('hex');
  // Why: `-e NAME` without a value reads the client's environment, so the password is in no argument list.
  docker(
    [
      ...['run', '-d', '--name', CONTAINER, '-e', 'POSTGRES_PASSWORD'],
      ...['-e', 'POSTGRES_INITDB_ARGS=--auth-host=scram-sha-256 --auth-local=trust'],
      ...['-p', `127.0.0.1:${HOST_PORT}:5432`, '--tmpfs', '/var/lib/postgresql'],
      ...['-v', `${dir}:/tls-src:ro`, '--entrypoint', 'sh', IMAGE, '-c', WRAPPER],
    ],
    { ...process.env, POSTGRES_PASSWORD: password },
  );
  waitUntilReady();

  const url = `postgres://postgres:${password}@127.0.0.1:${HOST_PORT}/postgres?sslmode=require`;
  const lines = `SKELD_TEST_PG19_URL=${url}\nSKELD_TEST_PG19_CA=${join(dir, 'ca.pem')}\n`;
  writeFileSync(envFile, lines, { mode: 0o600 });
  chmodSync(envFile, 0o600);
  process.stdout.write(`${CONTAINER} accepts connections on 127.0.0.1:${HOST_PORT}; variables written to ${envFile}\n`);
}

try {
  main();
} catch (error) {
  process.stderr.write(`start-postgres: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
