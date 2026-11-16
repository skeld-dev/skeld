// The child side of with-local-provider.ts: the service process receives its port and the local provider's
// configuration over the IPC channel, never on the command line.
//
// auth has no per-provider certificate option. The child trusts the local provider because it was started with
// NODE_EXTRA_CA_CERTS naming that provider's certificate; Node reads it only at start, and it extends the
// trust of the whole process, not of one provider (https://nodejs.org/api/cli.html#node_extra_ca_certsfile).

export interface ProviderConfig {
  readonly issuer: string;
  readonly clientId: string;
  readonly clientSecret: string;
}

export interface Launch {
  readonly port: number;
  readonly provider: ProviderConfig;
  readonly accounts: readonly string[];
}

export async function receiveLaunch(): Promise<Launch> {
  if (process.send === undefined || process.env.NODE_EXTRA_CA_CERTS === undefined) {
    throw new Error('start this script through with-local-provider.ts (see README.md)');
  }
  const message = await new Promise<unknown>((resolve) => process.once('message', resolve));
  process.disconnect?.();
  return parseLaunch(message);
}

function parseLaunch(message: unknown): Launch {
  if (typeof message !== 'object' || message === null) {
    throw new TypeError('launch: the message is not an object');
  }
  const port: unknown = Reflect.get(message, 'port');
  const provider: unknown = Reflect.get(message, 'provider');
  const accounts: unknown = Reflect.get(message, 'accounts');
  if (typeof provider !== 'object' || provider === null) {
    throw new TypeError('launch: no provider');
  }
  const issuer: unknown = Reflect.get(provider, 'issuer');
  const clientId: unknown = Reflect.get(provider, 'clientId');
  const clientSecret: unknown = Reflect.get(provider, 'clientSecret');
  if (
    typeof port !== 'number' ||
    typeof issuer !== 'string' ||
    typeof clientId !== 'string' ||
    typeof clientSecret !== 'string' ||
    !Array.isArray(accounts) ||
    !accounts.every((account) => typeof account === 'string')
  ) {
    throw new TypeError('launch: a field is missing or of the wrong type');
  }
  return { port, provider: { issuer, clientId, clientSecret }, accounts };
}
