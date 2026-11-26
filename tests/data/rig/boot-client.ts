// Does:  Child process that boots a pool against one fixture, in a process that may disable TLS verification.
// Holds: It prints one JSON line: the failure's stage and reason, and whether a bare TLS client got through.

import { connect } from 'node:net';
import { connect as tlsConnect } from 'node:tls';
import { bootPool } from './boot-pool.ts';

const port = Number(process.env.VA_PORT);
const ca = process.env.VA_CA ?? '';

async function bareClientConnects(): Promise<boolean> {
  const raw = connect({ host: '127.0.0.1', port });
  await new Promise<void>((resolve, reject) => {
    raw.once('connect', resolve);
    raw.once('error', reject);
  });
  raw.write(Buffer.from('0000000804d2162f', 'hex'));
  await new Promise<void>((resolve) => raw.once('data', () => resolve()));
  const secure = tlsConnect({ socket: raw, host: '127.0.0.1', ALPNProtocols: ['postgresql'] });
  return await new Promise<boolean>((resolve) => {
    secure.once('secureConnect', () => {
      secure.destroy();
      resolve(true);
    });
    secure.once('error', () => resolve(false));
  });
}

const control = process.env.VA_CONTROL === '1' ? await bareClientConnects() : null;
const booted = await bootPool(`postgres://u:pw-${port}@127.0.0.1:${port}/d?sslmode=require`, { ca });
await booted.finish();
process.stdout.write(
  `${JSON.stringify({
    env: process.env.NODE_TLS_REJECT_UNAUTHORIZED ?? null,
    control,
    booted: booted.failure === null,
    code: booted.failure?.code ?? null,
    stage: booted.failure?.stage ?? null,
    reason: booted.failure?.reason ?? null,
  })}\n`,
);
