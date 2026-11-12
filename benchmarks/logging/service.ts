// Does:  Serves hello with the access log on and the log counts on /stats, writing to stdout or to a failing sink.
// Holds: The ready line goes to stderr, so stdout carries only log records; the sink mode never changes a response.

import { defineContract } from '@skeld/core/contract';
import type { LogSink } from '@skeld/core/log';
import * as t from '@skeld/core/schema';
import { createServer } from '@skeld/core/server';
import { host } from '../values.ts';

type SinkMode = 'none' | 'throws' | 'rejects' | 'hangs' | 'reenters';

const sinkModes: readonly SinkMode[] = ['none', 'throws', 'rejects', 'hangs', 'reenters'];

const fail = (exitCode: number, message: string): never => {
  process.stderr.write(`error: ${message}\n`);
  process.exit(exitCode);
};

const parseSinkMode = (argv: readonly string[]): SinkMode => {
  const [name, value, ...rest] = argv;
  const mode = sinkModes.find((candidate) => candidate === value);
  if (name !== '--sink' || mode === undefined || rest.length > 0) {
    return fail(2, `usage: node benchmarks/logging/service.ts --sink <${sinkModes.join('|')}>`);
  }
  return mode;
};

const count = t.integer({ minimum: 0 });

const Stats = t.object({
  stats: t.object({
    created: count,
    written: count,
    queued: count,
    queuedBytes: count,
    inFlight: count,
    inFlightBytes: count,
    pendingMs: t.number({ minimum: 0 }),
    suppressed: count,
    dropped: t.object({
      queue_full: count,
      reserve: count,
      write_failed: count,
      sink_failed: count,
      shutdown: count,
    }),
  }),
  sinkCalls: t.optional(count),
});

const serviceContract = defineContract({
  hello: { method: 'GET', path: '/', responses: { 200: t.object({ hello: t.string({ maxLength: 64 }) }) } },
  stats: { method: 'GET', path: '/stats', responses: { 200: Stats } },
});

const mode = parseSinkMode(process.argv.slice(2));
let sinkCalls = 0;
const sinkError = (): Error => new Error(`the ${mode} sink fixture failed on purpose`);

const sinks: Readonly<Record<Exclude<SinkMode, 'none'>, LogSink>> = {
  throws: () => {
    sinkCalls++;
    throw sinkError();
  },
  rejects: () => {
    sinkCalls++;
    return Promise.reject(sinkError());
  },
  hangs: () => {
    sinkCalls++;
    return new Promise<void>(() => undefined);
  },
  reenters: (records) => {
    sinkCalls++;
    server.log.info('the sink called the logger', { records: records.length });
  },
};

const server = createServer({ log: mode === 'none' ? { access: true } : { access: true, sink: sinks[mode] } });

server.routes(serviceContract, {
  hello: () => ({ status: 200, body: { hello: 'world' } }),
  stats: () => ({
    status: 200,
    body: { stats: server.logStats(), ...(mode === 'none' ? {} : { sinkCalls }) },
  }),
});

try {
  const address = await server.listen({ port: 0, host });
  process.stderr.write(`${JSON.stringify({ service: 'logging', port: address.port })}\n`);
} catch (error) {
  fail(1, `the service did not start: ${error instanceof Error ? error.message : String(error)}`);
}

const stop = async (): Promise<void> => {
  await server.close();
  process.exit(0);
};
process.once('SIGTERM', stop);
process.once('SIGINT', stop);
