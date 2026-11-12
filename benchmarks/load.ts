// Does:  Starts autocannon against one route with the protocol's connections, workers and pipelining.
// Holds: Every server receives the same request for a route; only the port differs.

import { createRequire } from 'node:module';
import { echoRequestHeaders } from './preflight.ts';
import type { RouteId } from './types.ts';
import { connections, expectedBody, host, workers } from './values.ts';

interface AutocannonOptions {
  readonly url: string;
  readonly connections: number;
  readonly pipelining: number;
  readonly duration: number;
  readonly workers: number;
  readonly method?: 'POST' | 'OPTIONS';
  readonly headers?: Readonly<Record<string, string>>;
  readonly body?: string;
}

export interface AutocannonResult {
  readonly requests: { readonly average: number; readonly total: number };
  readonly latency: { readonly p99: number };
  readonly throughput: { readonly total: number };
  readonly errors: number;
  readonly timeouts: number;
  readonly non2xx: number;
  readonly statusCodeStats: Readonly<Record<string, { readonly count: number }>>;
}

interface AutocannonRun extends PromiseLike<AutocannonResult> {
  stop(): void;
}

export type Autocannon = (options: AutocannonOptions) => AutocannonRun;

export function loadAutocannon(): Autocannon {
  const autocannon: Autocannon = createRequire(import.meta.url)('autocannon');
  return autocannon;
}

export function startLoad(
  autocannon: Autocannon,
  port: number,
  route: RouteId,
  pipelining: number,
  durationSeconds: number,
): AutocannonRun {
  const base = {
    url: `http://${host}:${port}/`,
    connections,
    pipelining,
    duration: durationSeconds,
    workers,
  };
  return autocannon(
    route === 'hello' ? base : { ...base, method: 'POST', headers: echoRequestHeaders, body: expectedBody },
  );
}

// Does:  The one request a load sends to every connection: its method, path, headers and body.
export interface LoadRequest {
  readonly method?: 'POST' | 'OPTIONS';
  readonly path: string;
  readonly headers?: Readonly<Record<string, string>>;
  readonly body?: string;
}

export function startRequestLoad(
  autocannon: Autocannon,
  port: number,
  request: LoadRequest,
  durationSeconds: number,
): AutocannonRun {
  const { path, ...sent } = request;
  return autocannon({
    ...sent,
    url: `http://${host}:${port}${path}`,
    connections,
    pipelining: 1,
    duration: durationSeconds,
    workers,
  });
}

export function routeCommandLine(route: RouteId, flags: string): string {
  const target = `http://${host}:<port>/`;
  return route === 'hello'
    ? `autocannon ${flags} ${target}`
    : `autocannon ${flags} -m POST -H content-type=application/json -b '${expectedBody}' ${target}`;
}
