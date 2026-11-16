// Does:  Boots a real gated server with one route per credential mix, around the auth parts a proof installs.
// Holds: The server binds 127.0.0.1 port 0; every log record is kept in memory and none is printed.

import { definePolicy } from '@skeld/auth/policy';
import { createAuth, type Sessions, type Subjects } from '@skeld/auth/server';
import type { AuthStore } from '@skeld/auth/store';
import { defineContract } from '@skeld/core/contract';
import * as t from '@skeld/core/schema';
import { createServer } from '@skeld/core/server';
import { parseRecord, settleLog } from './util.ts';

export interface LogLine {
  readonly event_name?: string;
  readonly severity?: string;
  readonly severity_text?: string;
  readonly fields?: Record<string, unknown>;
  readonly [key: string]: unknown;
}

export interface Seen {
  readonly status: number;
  readonly headers: Headers;
  readonly text: string;
  readonly body: Record<string, unknown> | null;
}

export interface GatedApp {
  readonly base: string;
  readonly origin: string;
  readonly sessions: Sessions;
  readonly subjects: Subjects;
  readonly records: LogLine[];
  readonly lines: string[];
  events: (name: string) => LogLine[];
  get: (path: string, headers?: Record<string, string>) => Promise<Seen>;
  settle: () => Promise<void>;
  close: () => Promise<void>;
}

const ORIGIN = 'http://localhost:3999';

const answer = t.object({ kind: t.string({ maxLength: 16 }), who: t.string({ maxLength: 256 }) });
const contract = defineContract({
  jwtOnly: {
    method: 'GET',
    path: '/jwt-only',
    access: { policy: 'jwtonly', action: 'read' },
    responses: { 200: answer },
  },
  keyOnly: {
    method: 'GET',
    path: '/key-only',
    access: { policy: 'keyonly', action: 'read' },
    responses: { 200: answer },
  },
  sessOnly: {
    method: 'GET',
    path: '/sess-only',
    access: { policy: 'sessonly', action: 'read' },
    responses: { 200: answer },
  },
  anyKind: {
    method: 'GET',
    path: '/any-kind',
    access: { policy: 'anykind', action: 'read' },
    responses: { 200: answer },
  },
  optional: { method: 'GET', path: '/optional', access: 'optional', responses: { 200: answer } },
  open: { method: 'GET', path: '/open', access: 'public', responses: { 200: answer } },
});

const policies = [
  definePolicy('jwtonly', { credentials: ['jwt'], actions: { read: () => true } }),
  definePolicy('keyonly', { credentials: ['api_key'], actions: { read: () => true } }),
  definePolicy('sessonly', { credentials: ['session'], actions: { read: () => true } }),
  definePolicy('anykind', { credentials: ['session', 'api_key', 'jwt'], actions: { read: () => true } }),
] as const;

export interface Parts {
  readonly apiKeys?: Parameters<typeof createAuth>[0]['apiKeys'];
  readonly jwt?: Parameters<typeof createAuth>[0]['jwt'];
}

export async function bootGated(store: AuthStore, parts: Parts): Promise<GatedApp> {
  const records: LogLine[] = [];
  const lines: string[] = [];
  const auth = createAuth({
    store,
    origin: ORIGIN,
    policies,
    ...(parts.apiKeys === undefined ? {} : { apiKeys: parts.apiKeys }),
    ...(parts.jwt === undefined ? {} : { jwt: parts.jwt }),
  });
  const server = createServer({
    gate: auth.gate,
    publicOrigin: ORIGIN,
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
  server.routes(contract, {
    jwtOnly: ({ principal }) => ({ status: 200, body: { kind: principal.kind, who: who(principal) } }),
    keyOnly: ({ principal }) => ({ status: 200, body: { kind: principal.kind, who: who(principal) } }),
    sessOnly: ({ principal }) => ({ status: 200, body: { kind: principal.kind, who: who(principal) } }),
    anyKind: ({ principal }) => ({ status: 200, body: { kind: principal.kind, who: who(principal) } }),
    optional: ({ principal }) => ({
      status: 200,
      body: principal === null ? { kind: 'none', who: '' } : { kind: principal.kind, who: who(principal) },
    }),
    open: () => ({ status: 200, body: { kind: 'public', who: '' } }),
  });
  const address = await server.listen({ port: 0 });
  const base = `http://127.0.0.1:${address.port}`;
  return {
    base,
    origin: ORIGIN,
    sessions: auth.sessions,
    subjects: auth.subjects,
    records,
    lines,
    events: (name) => records.filter((record) => record.event_name === name),
    settle: () => settleLog(lines),
    get: async (path, headers = {}) => {
      const res = await fetch(`${base}${path}`, { headers, redirect: 'manual' });
      const text = await res.text();
      return { status: res.status, headers: res.headers, text, body: parseRecord(text) };
    },
    close: () => server.close(),
  };
}

function who(principal: { readonly kind: string; readonly userId: string | null }): string {
  return `${principal.userId ?? 'null'}`;
}
