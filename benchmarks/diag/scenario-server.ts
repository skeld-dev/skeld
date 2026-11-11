// Does:  Serves the scenario routes the security pass drives, with an option to plant known leaks.
// Holds: Leaks exist only when planting is asked for; the clean pass runs the same routes without them.

import { defineContract } from '@darkstart/core/contract';
import * as t from '@darkstart/core/schema';
import type { ResponseContext, Scope } from '@darkstart/core/server';
import { createServer } from '@darkstart/core/server';
import { announceReady, failToStart } from '../servers/server-command.ts';
import { host, standalonePort } from '../values.ts';

const portPattern = /^\d+$/;
const maxPort = 65_535;
const canaryPattern = /^[A-Za-z0-9_-]{16,128}$/;
const canaryBodyLimit = 100_000;

const fail = (message: string): never => {
  process.stderr.write(`error: ${message}\n`);
  process.exit(2);
};

const parsePortValue = (text: string): number => {
  const port = Number(text);
  if (!portPattern.test(text) || port > maxPort) {
    return fail(`--port must be a whole number from 0 to ${maxPort}, got "${text}".`);
  }
  return port;
};

function parseArguments(argv: readonly string[]): { readonly port: number; readonly plant: boolean } {
  let port = standalonePort;
  let plant = false;
  for (let index = 0; index < argv.length; index++) {
    const token = argv[index] ?? '';
    if (token === '--port') {
      port = parsePortValue(argv[index + 1] ?? '');
      index++;
    } else if (token.startsWith('--port=')) {
      port = parsePortValue(token.slice('--port='.length));
    } else if (token === '--plant') {
      plant = true;
    } else {
      fail(`unknown option ${token}. The options are --port <n> and --plant.`);
    }
  }
  return { port, plant };
}

function readCanary(value: string | undefined): string {
  if (value === undefined) {
    return fail('DARKSTART_DIAG_CANARY is not set; the scenario service plants it and checks it never leaves.');
  }
  if (!canaryPattern.test(value)) {
    return fail(
      `DARKSTART_DIAG_CANARY must be 16 to 128 characters of A-Z, a-z, 0-9, _ and -; got ${value.length} characters.`,
    );
  }
  return value;
}

const { port, plant } = parseArguments(process.argv.slice(2));
const token = readCanary(process.env.DARKSTART_DIAG_CANARY);

const Hello = t.object({ hello: t.string({ maxLength: 64 }) });
const ScenarioBody = t.object({
  hello: t.string({ maxLength: 64 }),
  pad: t.optional(t.string({ maxLength: canaryBodyLimit })),
  constructor: t.optional(t.string({ maxLength: 64 })),
});
const BlockQuery = t.object({ ms: t.integer({ minimum: 1, maximum: 200 }) });

const scenarioContract = defineContract({
  hello: { method: 'GET', path: '/hello', responses: { 200: Hello } },
  canary_throw: { method: 'GET', path: '/canary/throw', responses: { 200: Hello } },
  canary_field: { method: 'GET', path: '/canary/field', responses: { 200: Hello } },
  canary_body: { method: 'POST', path: '/canary/body', body: ScenarioBody, responses: { 200: Hello } },
  empty: { method: 'GET', path: '/empty', responses: { 204: null } },
  block: { method: 'GET', path: '/block', query: BlockQuery, responses: { 200: Hello } },
});

const plantContract = defineContract({
  plant_send: { method: 'GET', path: '/plant/send', responses: { 200: Hello } },
  plant_header: { method: 'GET', path: '/plant/header', responses: { 200: Hello } },
  plant_raw: { method: 'GET', path: '/plant/raw', responses: { 200: Hello } },
});

const world = { hello: 'world' } as const;

function spin(ms: number): void {
  let now = performance.now();
  const until = now + ms;
  while (now < until) {
    now = performance.now();
  }
}

function plantPlugin(scope: Scope): void {
  scope.routes(plantContract, {
    plant_send: () => ({ status: 200, body: world }),
    plant_header: () => ({ status: 200, body: world }),
    plant_raw: () => ({ status: 200, body: world }),
  });
  scope.addHook('onRequest', (context) => {
    if (context.route.name === 'plant_header') {
      context.send({ status: 200, headers: { 'x-scenario-note': `ok\r\nx-scenario-canary: ${token}` } });
    } else if (context.route.name === 'plant_raw') {
      context.send({ status: 200, payload: JSON.stringify({ ...world, note: token }) });
    }
  });
  const replacing = (context: ResponseContext): string | undefined =>
    context.route.name === 'plant_send' ? JSON.stringify({ ...world, note: token }) : undefined;
  // Why: A void-returning type accepts the replacing hook, which proves the engine never writes what onSend returns.
  const observer: (context: ResponseContext, payload: string) => void = replacing;
  scope.addHook('onSend', observer);
}

const listenCause = (error: unknown): unknown =>
  error instanceof Error && error.cause instanceof Error && 'syscall' in error.cause ? error.cause : error;

const server = createServer();

server.addHook('onError', () => undefined);
server.routes(
  scenarioContract,
  {
    hello: () => ({ status: 200, body: world }),
    canary_throw: () => {
      throw new Error(`scenario canary ${token}`);
    },
    canary_field: () => {
      const body = { hello: 'world', note: token };
      return { status: 200, body };
    },
    canary_body: () => ({ status: 200, body: world }),
    empty: () => ({ status: 204 }),
    block: ({ query }) => {
      spin(query.ms);
      return { status: 200, body: world };
    },
  },
  { bodyLimits: { canary_body: canaryBodyLimit } },
);
if (plant) {
  server.register(plantPlugin, { name: 'plant' });
}

try {
  const address = await server.listen({ port, host });
  announceReady('scenario', address.port);
} catch (error) {
  failToStart('scenario', port, listenCause(error));
}

const stop = async (): Promise<void> => {
  await server.close();
  process.exit(0);
};
process.once('SIGTERM', stop);
process.once('SIGINT', stop);
