// Does:  Makes throwaway certificate authorities with openssl and runs a proof in a child that trusts the test CA.
// Holds: Trust is only NODE_EXTRA_CA_CERTS of the child; no process changes its own trust and verification stays on.

import { X509Certificate, createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export interface Leaf {
  readonly key: string;
  readonly cert: string;
  readonly spki: string;
}

export interface Pki {
  readonly dir: string;
  readonly caFile: string;
  readonly ca: string;
  readonly good: Leaf;
  readonly untrusted: Leaf;
  readonly wronghost: Leaf;
  readonly expired: Leaf;
  dispose: () => void;
}

function openssl(...args: string[]): void {
  execFileSync('openssl', args, { stdio: 'ignore' });
}

export function makePki(): Pki {
  const dir = mkdtempSync(join(tmpdir(), 'skeld-v-pki-'));
  const file = (name: string): string => join(dir, name);
  const curve = ['-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:prime256v1', '-nodes'];
  const ca = (name: string): void => {
    openssl(
      ...['req', '-x509', ...curve, '-keyout', file(`${name}.key`), '-out', file(`${name}.pem`), '-days', '2'],
      ...['-subj', `/CN=Skeld proof ${name}`, '-addext', 'basicConstraints=critical,CA:TRUE'],
      ...['-addext', 'keyUsage=critical,keyCertSign'],
    );
  };
  ca('ca');
  ca('rogue');
  const usage = 'extendedKeyUsage=serverAuth';
  writeFileSync(file('good.ext'), ['subjectAltName=DNS:localhost,IP:127.0.0.1', usage, ''].join('\n'));
  writeFileSync(file('other.ext'), ['subjectAltName=DNS:elsewhere.test', usage, ''].join('\n'));
  const leaf = (name: string, issuer: string, ext: string, dates: string[]): Leaf => {
    openssl(
      'req',
      '-new',
      ...curve,
      '-keyout',
      file(`${name}.key`),
      '-out',
      file(`${name}.csr`),
      '-subj',
      '/CN=localhost',
    );
    openssl(
      'x509',
      '-req',
      '-in',
      file(`${name}.csr`),
      '-CA',
      file(`${issuer}.pem`),
      '-CAkey',
      file(`${issuer}.key`),
      '-CAcreateserial',
      '-out',
      file(`${name}.pem`),
      '-extfile',
      file(ext),
      ...dates,
    );
    const cert = readFileSync(file(`${name}.pem`), 'utf8');
    const der = new X509Certificate(cert).publicKey.export({ type: 'spki', format: 'der' });
    return {
      key: readFileSync(file(`${name}.key`), 'utf8'),
      cert,
      spki: createHash('sha256').update(der).digest('base64'),
    };
  };
  const day = ['-days', '1'];
  const good = leaf('good', 'ca', 'good.ext', day);
  const untrusted = leaf('untrusted', 'rogue', 'good.ext', day);
  const wronghost = leaf('wronghost', 'ca', 'other.ext', day);
  const expired = leaf('expired', 'ca', 'good.ext', [
    '-not_before',
    '20200101000000Z',
    '-not_after',
    '20200102000000Z',
  ]);
  const caPem = readFileSync(file('ca.pem'), 'utf8');
  return {
    dir,
    caFile: file('ca.pem'),
    ca: caPem,
    good,
    untrusted,
    wronghost,
    expired,
    dispose: () => rmSync(dir, { recursive: true, force: true }),
  };
}

function readLeaf(dir: string, name: string): Leaf {
  const cert = readFileSync(join(dir, `${name}.pem`), 'utf8');
  const der = new X509Certificate(cert).publicKey.export({ type: 'spki', format: 'der' });
  return {
    key: readFileSync(join(dir, `${name}.key`), 'utf8'),
    cert,
    spki: createHash('sha256').update(der).digest('base64'),
  };
}

// Does:  Reads the authority and leaves a parent made; its dispose removes nothing, the parent owns the folder.
export function loadPki(dir: string): Pki {
  return {
    dir,
    caFile: join(dir, 'ca.pem'),
    ca: readFileSync(join(dir, 'ca.pem'), 'utf8'),
    good: readLeaf(dir, 'good'),
    untrusted: readLeaf(dir, 'untrusted'),
    wronghost: readLeaf(dir, 'wronghost'),
    expired: readLeaf(dir, 'expired'),
    dispose: () => undefined,
  };
}

// Does:  In the runner, makes the CA, re-runs the script in a child that trusts it by NODE_EXTRA_CA_CERTS, exits.
// Holds: In the child it only loads what the parent made; the runner's own trust is never touched.
export async function childPki(scriptUrl: string): Promise<Pki> {
  const inherited = process.env.SKELD_PKI_DIR;
  if (inherited !== undefined) {
    return loadPki(inherited);
  }
  const made = makePki();
  const child = spawn(process.execPath, [...process.execArgv, fileURLToPath(scriptUrl)], {
    stdio: 'inherit',
    env: { ...process.env, NODE_EXTRA_CA_CERTS: made.caFile, SKELD_PKI_DIR: made.dir },
  });
  const code = await new Promise<number | null>((resolve) => child.on('close', resolve));
  made.dispose();
  process.exit(code ?? 1);
}
