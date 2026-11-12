// Does:  Sends one raw HTTP request and gives the response as header lines, so duplicate lines stay visible.
// Holds: Every request closes its connection, and a header name is compared in lower case.

import { rawExchange } from './support.ts';

export interface Wire {
  status: number;
  lines: [string, string][];
  body: string;
  raw: string;
  all: (name: string) => string[];
  first: (name: string) => string | null;
  tokens: (name: string) => string[];
  names: () => string[];
}

export function wireOf(raw: string, status: number, body: string): Wire {
  const head = raw.split('\r\n\r\n')[0] ?? '';
  const lines: [string, string][] = [];
  for (const line of head.split('\r\n').slice(1)) {
    const colon = line.indexOf(':');
    if (colon > 0) {
      lines.push([line.slice(0, colon).toLowerCase(), line.slice(colon + 1).trim()]);
    }
  }
  const all = (name: string) => lines.filter(([lineName]) => lineName === name).map(([, value]) => value);
  return {
    status,
    lines,
    body,
    raw,
    all,
    first: (name) => all(name)[0] ?? null,
    tokens: (name) =>
      all(name)
        .flatMap((value) => value.split(','))
        .map((token) => token.trim().toLowerCase())
        .filter((token) => token !== ''),
    names: () => lines.map(([name]) => name),
  };
}

export async function request(
  port: number,
  method: string,
  path: string,
  headers: readonly string[] = [],
  waitMs = 3000,
): Promise<Wire> {
  const hasHost = headers.some((line) => line.toLowerCase().startsWith('host:'));
  const hostLine = hasHost ? '' : 'host: x\r\n';
  const text = `${method} ${path} HTTP/1.1\r\n${hostLine}connection: close\r\n${headers.map((line) => `${line}\r\n`).join('')}\r\n`;
  const response = await rawExchange(port, text, waitMs);
  return wireOf(response.raw, response.status, response.body);
}

export function jsonOf(body: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(body);
    return typeof parsed === 'object' && parsed !== null ? { ...parsed } : {};
  } catch {
    return {};
  }
}
