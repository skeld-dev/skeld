// Does:  Boots a real server with auth OIDC and session routes over a store, and a cookie-jar browser that drives them.
// Holds: The server binds 127.0.0.1 port 0; the jar sends exactly the cookies it stored, keyed by name.

import { type OidcResolveUser, oidc } from '@skeld/auth/oidc';
import { oidcRoutes, sessionRoutes } from '@skeld/auth/routes';
import { createAuth, type Sessions, type Subjects } from '@skeld/auth/server';
import type { AuthStore } from '@skeld/auth/store';
import { Secret } from '@skeld/core/secret';
import { createServer } from '@skeld/core/server';
import type { LogLine } from './app.ts';
import type { Provider } from './provider.ts';
import { parseRecord, settleLog } from './util.ts';

const ORIGIN = 'http://localhost:3999';
export const COOKIE = '__Host-skeld';

export interface ProviderEntry {
  readonly provider: Provider;
  readonly name: string;
}

export interface OidcApp {
  readonly base: string;
  readonly origin: string;
  readonly sessions: Sessions;
  readonly subjects: Subjects;
  readonly records: LogLine[];
  readonly lines: string[];
  events: (name: string) => LogLine[];
  browser: () => Browser;
  settle: () => Promise<void>;
  close: () => Promise<void>;
}

export interface Hop {
  readonly status: number;
  readonly location: string | null;
  readonly setCookie: string[];
  readonly text: string;
  readonly body: Record<string, unknown> | null;
  readonly retryAfter: string | null;
}

export interface Browser {
  readonly jar: Map<string, string>;
  start: (name: string, body?: Record<string, unknown>) => Promise<Hop>;
  callback: (name: string, query: Record<string, string>) => Promise<Hop>;
  session: () => Promise<Hop>;
  get: (path: string) => Promise<Hop>;
}

export interface OidcBoot {
  readonly store: AuthStore;
  readonly entries: readonly ProviderEntry[];
  readonly resolveUser: OidcResolveUser;
  readonly origin?: string;
  readonly addressLimit?: { readonly max: number; readonly windowSeconds: number };
  readonly oidcExtra?: Record<string, unknown>;
  readonly host?: string;
}

export async function bootOidc(config: OidcBoot): Promise<OidcApp> {
  const origin = config.origin ?? ORIGIN;
  const records: LogLine[] = [];
  const lines: string[] = [];
  const providers = Object.fromEntries(
    config.entries.map(({ provider, name }) => [
      name,
      { issuer: provider.issuer, clientId: provider.clientId, clientSecret: new Secret(provider.clientSecret) },
    ]),
  );
  const part = oidc({
    providers,
    failurePath: '/login',
    returnPath: '/home',
    resolveUser: config.resolveUser,
    ...config.oidcExtra,
  });
  const auth = createAuth({
    store: config.store,
    origin,
    ...(config.addressLimit === undefined ? {} : { addressLimit: config.addressLimit }),
    oidc: part,
  });
  const server = createServer({
    gate: auth.gate,
    publicOrigin: origin,
    csrf: { mode: 'strict' },
    log: {
      thresholds: { security: 'info' },
      sink: (batch: readonly string[]) => {
        for (const line of batch) {
          lines.push(line);
          records.push(JSON.parse(line));
        }
      },
    },
  });
  server.routes(oidcRoutes, part.handlers, { csrf: { mode: 'strict' } });
  server.routes(sessionRoutes, auth.handlers.session, { csrf: { mode: 'strict' } });
  const address = await server.listen({ port: config.origin === undefined ? 0 : Number(new URL(origin).port) });
  const base = `http://127.0.0.1:${address.port}`;
  return {
    base,
    origin,
    sessions: auth.sessions,
    subjects: auth.subjects,
    records,
    lines,
    events: (name) => records.filter((record) => record.event_name === name),
    settle: () => settleLog(lines),
    browser: () => makeBrowser(base, origin),
    close: () => server.close(),
  };
}

function makeBrowser(base: string, origin: string): Browser {
  const jar = new Map<string, string>();
  const cookieHeader = (): string => [...jar].map(([name, value]) => `${name}=${value}`).join('; ');
  const take = (res: Response): string[] => {
    const set = res.headers.getSetCookie();
    for (const line of set) {
      const pair = line.split(';')[0] ?? '';
      const eq = pair.indexOf('=');
      const name = pair.slice(0, eq);
      if (/max-age=0/i.test(line)) {
        jar.delete(name);
      } else {
        jar.set(name, pair.slice(eq + 1));
      }
    }
    return set;
  };
  const hop = async (res: Response): Promise<Hop> => {
    const setCookie = take(res);
    const text = await res.text();
    return {
      status: res.status,
      location: res.headers.get('location'),
      setCookie,
      text,
      body: parseRecord(text),
      retryAfter: res.headers.get('retry-after'),
    };
  };
  const get = async (path: string): Promise<Hop> =>
    hop(await fetch(`${base}${path}`, { redirect: 'manual', headers: { cookie: cookieHeader() } }));
  return {
    jar,
    get,
    session: () => get('/auth/session'),
    start: async (name, body = {}) =>
      hop(
        await fetch(`${base}/auth/oidc/${name}/start`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', origin, cookie: cookieHeader() },
          body: JSON.stringify(body),
        }),
      ),
    callback: (name, query) => get(`/auth/oidc/${name}/callback?${new URLSearchParams(query).toString()}`),
  };
}

export interface Trip {
  readonly start: Hop;
  readonly url: string;
  readonly code: string;
  readonly state: string;
  readonly query: Record<string, string>;
}

// Does:  Plays one browser's start and its trip to the provider: the start hop and the code the provider issued.
export async function begin(browser: Browser, entry: ProviderEntry, body: Record<string, unknown> = {}): Promise<Trip> {
  const start = await browser.start(entry.name, body);
  const url = typeof start.body?.url === 'string' ? start.body.url : '';
  if (url === '') {
    return { start, url, code: '', state: '', query: {} };
  }
  const issued = entry.provider.authorize(url);
  return { start, url, code: issued.code, state: issued.state, query: issued.query };
}

export function location(hop: Hop): string {
  return hop.location ?? `(${hop.status})`;
}
