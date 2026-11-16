// Does:  Launches headless Chromium on a throwaway profile and drives one page over the DevTools protocol.
// Holds: The browser trusts only the SPKI hashes it is given; the profile folder and the process end with close.
// biome-ignore-all lint/security/noSecrets: DevTools protocol method names are not secrets

import { type ChildProcess, spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isRecord, sleep, until } from './util.ts';

export interface BrowserCookie {
  readonly name: string;
  readonly domain: string;
  readonly path: string;
  readonly secure: boolean;
  readonly httpOnly: boolean;
  readonly sameSite: string;
  readonly session: boolean;
  readonly expires: number;
}

export interface NetworkSeen {
  readonly url: string;
  readonly method: string;
  status: number | null;
  blocked: string[];
  cookieNames: string[];
}

export interface Chrome {
  readonly version: string;
  readonly seen: NetworkSeen[];
  navigate: (url: string) => Promise<string>;
  evaluate: (expression: string) => Promise<unknown>;
  cookies: () => Promise<BrowserCookie[]>;
  close: () => Promise<void>;
}

const EXECUTABLE = '/usr/bin/chromium';

export async function launch(trustedSpki: readonly string[]): Promise<Chrome> {
  const dir = mkdtempSync(join(tmpdir(), 'skeld-v-chrome-'));
  const args = [
    '--headless=new',
    '--remote-debugging-port=0',
    `--user-data-dir=${dir}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-gpu',
    '--disable-extensions',
    '--disable-background-networking',
    `--ignore-certificate-errors-spki-list=${trustedSpki.join(',')}`,
    'about:blank',
  ];
  const child: ChildProcess = spawn(EXECUTABLE, args, { stdio: 'ignore' });
  const port = await readPort(join(dir, 'DevToolsActivePort'));
  const targets: unknown = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const first = Array.isArray(targets) ? targets.find((t) => isRecord(t) && t.type === 'page') : undefined;
  if (!isRecord(first) || typeof first.webSocketDebuggerUrl !== 'string') {
    throw new Error('no page target');
  }
  const socket = new WebSocket(first.webSocketDebuggerUrl);
  await new Promise<void>((resolve, reject) => {
    socket.addEventListener('open', () => resolve(), { once: true });
    socket.addEventListener('error', () => reject(new Error('devtools socket failed')), { once: true });
  });
  let next = 0;
  const pending = new Map<number, (value: Record<string, unknown>) => void>();
  const listeners: ((method: string, params: Record<string, unknown>) => void)[] = [];
  socket.addEventListener('message', (event) => {
    const message: unknown = JSON.parse(String(event.data));
    if (!isRecord(message)) {
      return;
    }
    if (typeof message.id === 'number') {
      pending.get(message.id)?.(message);
      pending.delete(message.id);
    } else if (typeof message.method === 'string') {
      for (const listener of listeners) {
        listener(message.method, isRecord(message.params) ? message.params : {});
      }
    }
  });
  const send = (method: string, params: Record<string, unknown> = {}): Promise<Record<string, unknown>> =>
    new Promise((resolve) => {
      next += 1;
      pending.set(next, resolve);
      socket.send(JSON.stringify({ id: next, method, params }));
    });
  const seen: NetworkSeen[] = [];
  listeners.push(trackNetwork(seen));
  await send('Network.enable');
  await send('Page.enable');
  const versionResult = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
  const version = isRecord(versionResult) ? String(versionResult.Browser) : 'unknown';
  const evaluate = async (expression: string): Promise<unknown> => {
    const reply = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    const result = isRecord(reply.result) ? reply.result : {};
    if (isRecord(result.exceptionDetails)) {
      throw new Error(`page threw: ${JSON.stringify(result.exceptionDetails).slice(0, 300)}`);
    }
    return isRecord(result.result) ? result.result.value : undefined;
  };
  const navigate = async (url: string): Promise<string> => {
    let loaded = false;
    const listener = (method: string): void => {
      if (method === 'Page.loadEventFired') {
        loaded = true;
      }
    };
    listeners.push(listener);
    await send('Page.navigate', { url });
    await until(() => loaded, 15_000);
    listeners.splice(listeners.indexOf(listener), 1);
    await sleep(100);
    return String(await evaluate('location.href'));
  };
  const cookies = async (): Promise<BrowserCookie[]> => {
    const reply = await send('Network.getAllCookies');
    const list = isRecord(reply.result) && Array.isArray(reply.result.cookies) ? reply.result.cookies : [];
    return list.filter(isRecord).map((cookie) => ({
      name: String(cookie.name),
      domain: String(cookie.domain),
      path: String(cookie.path),
      secure: cookie.secure === true,
      httpOnly: cookie.httpOnly === true,
      sameSite: String(cookie.sameSite),
      session: cookie.session === true,
      expires: Number(cookie.expires),
    }));
  };
  return {
    version,
    seen,
    navigate,
    evaluate,
    cookies,
    close: async () => {
      socket.close();
      child.kill('SIGTERM');
      await until(() => child.exitCode !== null || child.signalCode !== null, 5000);
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

function trackNetwork(seen: NetworkSeen[]): (method: string, params: Record<string, unknown>) => void {
  const byId = new Map<string, NetworkSeen>();
  const onSent = (id: string, request: Record<string, unknown>): void => {
    const entry: NetworkSeen = {
      url: String(request.url),
      method: String(request.method),
      status: null,
      blocked: [],
      cookieNames: [],
    };
    byId.set(id, entry);
    seen.push(entry);
  };
  const onExtra = (id: string, cookies: unknown[]): void => {
    const entry = byId.get(id);
    for (const item of cookies) {
      if (entry === undefined || !isRecord(item) || !isRecord(item.cookie)) {
        continue;
      }
      const reasons = Array.isArray(item.blockedReasons) ? item.blockedReasons.map(String) : [];
      if (reasons.length === 0) {
        entry.cookieNames.push(String(item.cookie.name));
      } else {
        entry.blocked.push(`${String(item.cookie.name)}:${reasons.join('+')}`);
      }
    }
  };
  return (method, params) => {
    const id = typeof params.requestId === 'string' ? params.requestId : '';
    if (method === 'Network.requestWillBeSent' && isRecord(params.request)) {
      onSent(id, params.request);
    } else if (method === 'Network.responseReceived' && isRecord(params.response)) {
      const entry = byId.get(id);
      if (entry !== undefined) {
        entry.status = Number(params.response.status);
      }
    } else if (method === 'Network.requestWillBeSentExtraInfo' && Array.isArray(params.associatedCookies)) {
      onExtra(id, params.associatedCookies);
    }
  };
}

async function readPort(file: string): Promise<number> {
  let port = 0;
  await until(() => {
    try {
      port = Number(readFileSync(file, 'utf8').split('\n')[0]);
    } catch {
      port = 0;
    }
    return port > 0;
  }, 15_000);
  if (port === 0) {
    throw new Error('Chromium did not start: no DevToolsActivePort');
  }
  return port;
}
