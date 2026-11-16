import { fork } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Launch } from './launch.ts';
import { startLocalProvider } from './local-oidc-provider.ts';

// Usage: node --conditions=skeld-source with-local-provider.ts <server.ts | walkthrough.ts>
//
// Starts the local OIDC provider, writes its certificate to a temporary file and runs the script in a child
// Node process started with NODE_EXTRA_CA_CERTS naming that file. Certificate and hostname verification stay
// on in the child: it trusts this run's provider because its default trust was extended at start, for the
// whole process. Nothing sets NODE_TLS_REJECT_UNAUTHORIZED or turns verification off.

const script = process.argv[2];
if (script !== 'server.ts' && script !== 'walkthrough.ts') {
  throw new Error('usage: with-local-provider.ts <server.ts | walkthrough.ts>');
}
// auth binds cookies and the provider's redirect URI to the service's origin before it listens: fix the port.
const port = process.env.PORT === undefined ? await freePort() : Number(process.env.PORT);
const accounts = ['p-alice', 'p-mallory'];
const provider = await startLocalProvider({
  redirectUri: `http://127.0.0.1:${port}/auth/oidc/local/callback`,
  accounts,
});
const dir = mkdtempSync(join(tmpdir(), 'skeld-auth-example-ca-'));

try {
  const caFile = join(dir, 'provider-ca.pem');
  writeFileSync(caFile, provider.certificate, { mode: 0o600 });
  const child = fork(join(import.meta.dirname, script), { env: { ...process.env, NODE_EXTRA_CA_CERTS: caFile } });
  // Ctrl-C reaches both processes; a signal sent to this one alone is passed on. The child closes itself.
  const forward = (signal: NodeJS.Signals) => child.kill(signal);
  process.on('SIGINT', forward);
  process.on('SIGTERM', forward);
  const launch: Launch = {
    port,
    provider: { issuer: provider.issuer, clientId: provider.clientId, clientSecret: provider.clientSecret },
    accounts,
  };
  child.send(launch);
  const [code] = await once(child, 'exit');
  process.exitCode = typeof code === 'number' ? code : 1;
} finally {
  await provider.close();
  rmSync(dir, { recursive: true, force: true });
}

async function freePort(): Promise<number> {
  const probe = createServer().listen(0, '127.0.0.1');
  await once(probe, 'listening');
  const address = probe.address();
  probe.close();
  if (address === null || typeof address === 'string') {
    throw new Error('no local port');
  }
  return address.port;
}
