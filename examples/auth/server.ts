import { startExample } from './app.ts';
import { receiveLaunch } from './launch.ts';

const launch = await receiveLaunch();
const example = await startExample({ port: launch.port, provider: launch.provider });

// One-time values for this run, printed to the terminal (stderr) and never to the log stream (stdout).
// They are generated at start and stop working when the process ends.
process.stderr.write(
  [
    `auth example at ${example.origin}`,
    ...[...example.passwords].map(([user, password]) => `  password for ${user}: ${password}`),
    `  JWT for alice (5 minutes): ${example.issuerToken('alice')}`,
    `  local OIDC accounts: ${launch.accounts.join(', ')} (append &login_hint=<account> to the start URL)`,
    '',
  ].join('\n'),
);

// Ctrl-C can arrive twice (from the terminal and from the launcher); the first starts the close.
const { promise: stop, resolve } = Promise.withResolvers<void>();
process.on('SIGINT', () => resolve());
process.on('SIGTERM', () => resolve());
await stop;
await example.close();
