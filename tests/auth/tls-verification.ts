// Does:  Proves outbound requests keep verifying certificates in a process that sets NODE_TLS_REJECT_UNAUTHORIZED=0.
// Holds: The child trusts only the test authority; a certificate from another authority or for another host is refused.

// biome-ignore-all lint/performance/noAwaitInLoops: each case is a request that must finish before the next
import { spawn } from 'node:child_process';
import https from 'node:https';
import tls from 'node:tls';
import { fileURLToPath } from 'node:url';
import { begin, bootOidc, COOKIE, location } from './rig/oidc-app.ts';
import { loadPki, makePki } from './rig/pki.ts';
import { providerHost } from './rig/provider.ts';
import { type Kind, kinds, makeStoreRig } from './rig/stores.ts';
import { createReport } from './rig/v1-report.ts';

const variants = ['environment', 'agent-subclass', 'agent-lax', 'agent-options', 'check-server-identity'] as const;
const inherited = process.env.SKELD_PKI_DIR;
if (inherited === undefined) {
  const made = makePki();
  let failed = 0;
  for (const variant of variants) {
    const child = spawn(process.execPath, [...process.execArgv, fileURLToPath(import.meta.url)], {
      stdio: 'inherit',
      env: {
        ...process.env,
        NODE_EXTRA_CA_CERTS: made.caFile,
        SKELD_PKI_DIR: made.dir,
        NODE_TLS_REJECT_UNAUTHORIZED: '0',
        SKELD_TLS_VARIANT: variant,
        SKELD_REPORT_SUFFIX: variant === 'environment' ? '' : `-${variant}`,
      },
    });
    const code = await new Promise<number | null>((resolve) => child.on('close', resolve));
    failed += code === 0 ? 0 : 1;
  }
  made.dispose();
  process.exit(failed === 0 ? 0 : 1);
}

// Why: the variant changes process-wide TLS state after auth is loaded, as a proxy helper or a dependency might
const variant = process.env.SKELD_TLS_VARIANT ?? 'environment';
class LaxAgent extends https.Agent {
  constructor() {
    super({ rejectUnauthorized: false });
  }
}
if (variant === 'agent-subclass') {
  Reflect.set(https, 'globalAgent', new LaxAgent());
} else if (variant === 'agent-lax') {
  Reflect.set(
    https,
    'globalAgent',
    new https.Agent({ rejectUnauthorized: false, checkServerIdentity: () => undefined }),
  );
} else if (variant === 'agent-options') {
  https.globalAgent.options.rejectUnauthorized = false;
} else if (variant === 'check-server-identity') {
  Reflect.set(tls, 'checkServerIdentity', () => undefined);
}

const pki = loadPki(inherited);
const report = createReport(
  'v10/review-fixes',
  'with NODE_TLS_REJECT_UNAUTHORIZED=0 in the environment, a discovery, key-set or token request to a provider whose certificate is from an untrusted authority, or names another host, is refused, and with the test authority configured it succeeds',
);
const good = await providerHost(pki.good);
const untrusted = await providerHost(pki.untrusted);
const wronghost = await providerHost(pki.wronghost);
let serial = 0;
const unavailable = (name: string): string => `/login?provider=${name}&error=provider_unavailable`;

function make(on = good): { provider: ReturnType<typeof good.add>; name: string } {
  serial += 1;
  const name = `t${serial}`;
  return { provider: on.add(name, `client-${name}`, 'secret-x'), name };
}

async function cases(kind: Kind): Promise<void> {
  const tag = `[${kind}]`;
  report.check(
    `${tag} premise (${variant}): this process has NODE_TLS_REJECT_UNAUTHORIZED=0 and NODE_EXTRA_CA_CERTS set${variant === 'environment' ? '' : ' and its process-wide TLS state relaxed after auth was loaded'}`,
    process.env.NODE_TLS_REJECT_UNAUTHORIZED === '0' && (process.env.NODE_EXTRA_CA_CERTS ?? '') !== '',
    `${process.env.NODE_TLS_REJECT_UNAUTHORIZED}`,
  );
  const naiveTarget = variant === 'check-server-identity' ? wronghost.base : untrusted.base;
  const naive = await new Promise<string>((resolve) => {
    const request = https.get(`${naiveTarget}/none`, (response) => {
      response.resume();
      resolve(`connected, status ${String(response.statusCode)}`);
    });
    request.on('error', (error: Error) => resolve(`refused ${error.message.slice(0, 40)}`));
  });
  report.check(
    `${tag} premise: a plain https request in this process, with no explicit agent or pin, is accepted by the relaxed state (the relaxation bites)`,
    naive.startsWith('connected'),
    naive,
  );
  const control = make();
  const bads = [
    ['an untrusted authority', untrusted],
    ['a certificate naming another host', wronghost],
  ] as const;
  const discovery = bads.map(([, server]) => make(server));
  const viaToken = bads.map(() => make());
  const viaJwks = bads.map(() => make());
  const entries = [control, ...discovery, ...viaToken, ...viaJwks];
  const rig = await makeStoreRig(kind);
  const app = await bootOidc({
    store: rig.open(),
    entries,
    resolveUser: (identity) => ({ kind: 'user', userId: `u-${identity.subject}` }),
    addressLimit: { max: 100_000, windowSeconds: 60 },
  });
  const login = async (entry: {
    provider: typeof control.provider;
    name: string;
  }): Promise<{ hop: string; session: boolean }> => {
    const browser = app.browser();
    const trip = await begin(browser, entry);
    if (trip.url === '') {
      return { hop: `start ${trip.start.status}`, session: false };
    }
    const hop = await browser.callback(entry.name, { code: trip.code, state: trip.state });
    return { hop: location(hop), session: browser.jar.has(COOKIE) };
  };
  try {
    const worked = await login(control);
    report.check(
      `${tag} control: with the test authority trusted, discovery, key set and token requests succeed and the sign-in completes`,
      worked.session && control.provider.hits.discovery >= 1,
      `${worked.hop}; session ${worked.session}`,
    );
    for (const [index, [name]] of bads.entries()) {
      const entry = discovery[index];
      if (entry === undefined) {
        continue;
      }
      const started = await app.browser().start(entry.name);
      report.check(
        `${tag} discovery over ${name} is refused although verification is disabled in the environment: 503 PROVIDER_UNAVAILABLE and the server saw no HTTP request`,
        started.status === 503 && started.body?.code === 'PROVIDER_UNAVAILABLE' && entry.provider.hits.all === 0,
        `${started.status}; server requests ${entry.provider.hits.all}`,
      );
      const tokenEntry = viaToken[index];
      if (tokenEntry !== undefined) {
        tokenEntry.provider.docOverride = { token_endpoint: String(entry.provider.doc().token_endpoint) };
        const t = await login(tokenEntry);
        report.check(
          `${tag} a token endpoint over ${name} is refused (a real token or key-set path of that server): provider_unavailable, no session and no HTTP request at the server`,
          t.hop === unavailable(tokenEntry.name) && !t.session && entry.provider.hits.all === 0,
          t.hop,
        );
      }
      const jwksEntry = viaJwks[index];
      if (jwksEntry !== undefined) {
        jwksEntry.provider.docOverride = { jwks_uri: String(entry.provider.doc().jwks_uri) };
        const j = await login(jwksEntry);
        report.check(
          `${tag} a key set over ${name} is refused (a real token or key-set path of that server): provider_unavailable, no session and no HTTP request at the server`,
          j.hop === unavailable(jwksEntry.name) && !j.session && entry.provider.hits.all === 0,
          j.hop,
        );
      }
    }
  } finally {
    await app.close();
    await rig.dispose();
  }
}

for (const kind of kinds) {
  await report.run(`${kind} TLS verification`, () => cases(kind));
}
for (const server of [good, untrusted, wronghost]) {
  await server.close();
}
report.finish();
